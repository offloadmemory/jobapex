import fs from "node:fs";
import path from "node:path";
import { shell } from "electron";

import type { FileEntry, StagedFile } from "@shared/wire";
import { workspaceDirPath } from "../agent/config.js";
import { logError } from "./logger.js";

/**
 * Workspace filesystem access for the Files page.
 *
 * Every path that crosses the IPC boundary is *relative to the workspace root*
 * and is re-validated here: the renderer is a convenience, not a trust
 * boundary, and the agent's own tools are jailed separately. Two checks guard
 * each path — a lexical one (absolute paths and `..` never pass) and a real-path
 * one (the deepest existing ancestor is resolved through symlinks and must stay
 * inside the root), because a symlink planted in the workspace would otherwise
 * turn a harmless-looking relative path into a door out of it.
 */

const MAX_LIST_DEPTH = 4;
const MAX_LIST_ENTRIES = 2000;
const MAX_READ_BYTES = 1024 * 1024;
const MAX_WRITE_BYTES = 4 * 1024 * 1024;
const UPLOADS_DIR = "uploads";

/** Directories that are never useful in a picker and are large to walk. */
const SKIP_DIRS = new Set([".git", "node_modules"]);

/** A rejected path is caller input, not a server failure (see ipc/files.ts). */
export class WorkspacePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePathError";
  }
}

/** Absolute workspace root, created on first touch so callers can always write. */
function workspaceRoot(): string {
  const root = path.resolve(workspaceDirPath());
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/** Deepest existing ancestor of `target` (target itself when it exists). */
function existingAncestor(target: string): string {
  let probe = target;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  return probe;
}

function realPathOf(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

/** True when `abs` resolves outside `root` once symlinks are followed. */
function escapesRoot(root: string, abs: string): boolean {
  const realRoot = realPathOf(existingAncestor(root));
  const real = realPathOf(existingAncestor(abs));
  return real !== realRoot && !real.startsWith(realRoot + path.sep);
}

/** Split a wire path into clean segments, refusing absolutes and `..`. */
function toSegments(input: string): string[] {
  if (input.includes("\0")) {
    throw new WorkspacePathError("path contains a NUL byte");
  }
  if (path.isAbsolute(input) || /^[A-Za-z]:/.test(input) || input.startsWith("\\\\")) {
    throw new WorkspacePathError(`"${input}" is absolute; workspace paths are relative`);
  }
  // Windows separators are accepted as separators on every platform: the wire
  // format is POSIX, so a backslash is far more likely to be a stray separator
  // than an intentional filename character.
  const segments = input.split(/[\\/]+/).filter((segment) => segment !== "" && segment !== ".");
  if (segments.includes("..")) {
    throw new WorkspacePathError(`"${input}" climbs out of the workspace`);
  }
  return segments;
}

/**
 * Resolve a workspace-relative path to an absolute one, or throw. `allowRoot`
 * is for callers that legitimately mean "the workspace directory itself".
 */
function resolveInWorkspace(relative: string, allowRoot = false): string {
  const root = workspaceRoot();
  const segments = toSegments(relative);
  if (segments.length === 0 && !allowRoot) {
    throw new WorkspacePathError("a file path is required");
  }
  const abs = path.resolve(root, ...segments);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new WorkspacePathError(`"${relative}" is outside the workspace`);
  }
  if (escapesRoot(root, abs)) {
    throw new WorkspacePathError(`"${relative}" escapes the workspace through a link`);
  }
  return abs;
}

const toPosix = (relative: string): string => relative.split(path.sep).join("/");

interface Child {
  name: string;
  isDir: boolean;
  size: number;
  updatedAt: number;
  abs: string;
}

/** Directories first, then case-insensitive name (raw name breaks case ties). */
function byDirThenName(a: Child, b: Child): number {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
  const byName = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  return byName !== 0 ? byName : a.name.localeCompare(b.name);
}

function readChildren(absDir: string, root: string): Child[] {
  const children: Child[] = [];
  for (const dirent of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(dirent.name)) continue;
    const abs = path.join(absDir, dirent.name);
    let stats: fs.Stats;
    try {
      stats = fs.statSync(abs); // follows links: a link to a directory still lists
    } catch {
      continue; // broken link or unreadable entry — skip rather than fail the listing
    }
    // A link pointing outside the root is omitted: listing it only invites a
    // click that the read path would reject anyway.
    if (dirent.isSymbolicLink() && escapesRoot(root, abs)) continue;
    children.push({
      name: dirent.name,
      isDir: stats.isDirectory(),
      size: stats.isDirectory() ? 0 : stats.size,
      updatedAt: stats.mtimeMs,
      abs,
    });
  }
  return children.sort(byDirThenName);
}

/** Recursive listing (depth <= 4, <= 2000 entries) of the workspace or a subdirectory. */
export function listFiles(dir?: string): FileEntry[] {
  const root = workspaceRoot();
  const startAbs = dir && dir.trim() ? resolveInWorkspace(dir, true) : root;
  if (!fs.existsSync(startAbs) || !fs.statSync(startAbs).isDirectory()) {
    throw new WorkspacePathError(`"${dir || "."}" is not a directory`);
  }
  const entries: FileEntry[] = [];
  const queue: Array<{ abs: string; rel: string; depth: number }> = [
    { abs: startAbs, rel: toPosix(path.relative(root, startAbs)), depth: 0 },
  ];
  while (queue.length > 0 && entries.length < MAX_LIST_ENTRIES) {
    const current = queue.shift() as { abs: string; rel: string; depth: number };
    // Entries live at most MAX_LIST_DEPTH levels below the listed directory, so a
    // directory sitting at the cap is listed but never descended into.
    if (current.depth >= MAX_LIST_DEPTH) continue;
    for (const child of readChildren(current.abs, root)) {
      if (entries.length >= MAX_LIST_ENTRIES) break;
      const rel = current.rel ? `${current.rel}/${child.name}` : child.name;
      entries.push({
        path: rel,
        name: child.name,
        isDir: child.isDir,
        size: child.size,
        updatedAt: child.updatedAt,
      });
      if (child.isDir && current.depth < MAX_LIST_DEPTH) {
        queue.push({ abs: child.abs, rel, depth: current.depth + 1 });
      }
    }
  }
  return entries;
}

/** UTF-8 text of a workspace file; binary and oversized files are refused. */
export function readFile(relative: string): string {
  const abs = resolveInWorkspace(relative);
  if (!fs.existsSync(abs)) {
    throw new WorkspacePathError(`"${relative}" does not exist`);
  }
  const stats = fs.statSync(abs);
  if (!stats.isFile()) {
    throw new WorkspacePathError(`"${relative}" is not a file`);
  }
  if (stats.size > MAX_READ_BYTES) {
    throw new WorkspacePathError(
      `"${relative}" is ${Math.round(stats.size / 1024)} KiB; the viewer caps files at 1 MiB`
    );
  }
  const bytes = fs.readFileSync(abs);
  // Editors treat a NUL byte as "not text"; the renderer would render mojibake.
  if (bytes.includes(0)) {
    throw new WorkspacePathError(`"${relative}" looks binary (contains a NUL byte)`);
  }
  return bytes.toString("utf8");
}

export function writeFile(relative: string, content: string): void {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_WRITE_BYTES) {
    throw new WorkspacePathError(
      `refusing to write ${Math.round(bytes / 1024)} KiB; the editor caps saves at 4 MB`
    );
  }
  const abs = resolveInWorkspace(relative);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

/** Reveal a workspace path in the OS file manager; no path means the root. */
export function revealPath(relative?: string): void {
  const root = workspaceRoot();
  if (!relative || !relative.trim()) {
    openDir(root);
    return;
  }
  const abs = resolveInWorkspace(relative);
  if (!fs.existsSync(abs)) {
    throw new WorkspacePathError(`"${relative}" does not exist`);
  }
  if (fs.statSync(abs).isDirectory()) openDir(abs);
  else shell.showItemInFolder(abs);
}

/** Finder cannot "select" a directory, so open it instead of revealing it. */
function openDir(abs: string): void {
  void shell.openPath(abs).then((message) => {
    if (message) logError("files.reveal", new Error(message));
  });
}

function stamp(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/** Attachment names come from the host filesystem: keep one path-free leaf. */
function sanitizeName(name: string): string {
  const base = path.basename(name.trim()).replace(/[\u0000-\u001f\u007f]/g, "");
  const cleaned = base
    .replace(/[^\w.\- ]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[\s.\-]+|[\s.\-]+$/g, "")
    .slice(0, 100);
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : "file";
}

/** Same-second attachments with the same name must not clobber each other. */
function uniquePath(dir: string, stem: string): string {
  const ext = path.extname(stem);
  const base = stem.slice(0, stem.length - ext.length);
  let candidate = path.join(dir, stem);
  for (let n = 2; fs.existsSync(candidate); n++) {
    candidate = path.join(dir, `${base}-${n}${ext}`);
  }
  return candidate;
}

/** Copy an attachment into <root>/uploads and report its prompt-ready path. */
export function stageFile(name: string, data: Uint8Array): StagedFile {
  const root = workspaceRoot();
  const safeName = sanitizeName(name);
  const dir = path.join(root, UPLOADS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const dest = uniquePath(dir, `${stamp()}-${safeName}`);
  fs.writeFileSync(dest, data);
  return {
    name: safeName,
    relativePath: toPosix(path.join(UPLOADS_DIR, path.basename(dest))),
    bytes: data.byteLength,
  };
}
