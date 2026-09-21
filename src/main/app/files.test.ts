import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The real shell would open Finder windows during the test run. */
const shell = vi.hoisted(() => ({
  openPath: vi.fn(async () => ""),
  showItemInFolder: vi.fn(),
}));

vi.mock("electron", () => ({ shell }));

import { WorkspacePathError, listFiles, readFile, revealPath, stageFile, writeFile } from "./files.js";

const originalHome = process.env.HOME;
const originalWorkspace = process.env.AGENT_WORKSPACE;

let root = "";
let home = "";
let outside = "";

function outsideDir(): string {
  const dir = path.join(outside, `outside-${fs.readdirSync(outside).length}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-files-root-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-files-home-"));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-files-outside-"));
  process.env.HOME = home;
  process.env.AGENT_WORKSPACE = root;
  shell.openPath.mockClear();
  shell.showItemInFolder.mockClear();
});

afterEach(() => {
  process.env.HOME = originalHome;
  if (originalWorkspace === undefined) delete process.env.AGENT_WORKSPACE;
  else process.env.AGENT_WORKSPACE = originalWorkspace;
  for (const dir of [root, home, outside]) fs.rmSync(dir, { recursive: true, force: true });
});

describe("listFiles", () => {
  it("lists directories first, then names case-insensitively", () => {
    fs.mkdirSync(path.join(root, "beta-dir"));
    fs.mkdirSync(path.join(root, "Alpha-dir"));
    for (const name of ["Zebra.txt", "apple.txt", "b.txt"]) {
      fs.writeFileSync(path.join(root, name), name, "utf8");
    }

    expect(listFiles().map((entry) => entry.path)).toEqual([
      "Alpha-dir",
      "beta-dir",
      "apple.txt",
      "b.txt",
      "Zebra.txt",
    ]);
  });

  it("reports nested paths with size, directory flag and mtime", () => {
    writeFile("notes/today.md", "hello");

    const entries = listFiles();
    expect(entries.find((entry) => entry.path === "notes")?.isDir).toBe(true);
    const file = entries.find((entry) => entry.path === "notes/today.md");
    expect(file).toMatchObject({ name: "today.md", isDir: false, size: 5 });
    expect(file?.updatedAt).toBeGreaterThan(0);
  });

  it("skips .git and node_modules entirely", () => {
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/main", "utf8");
    fs.mkdirSync(path.join(root, "node_modules"));
    fs.writeFileSync(path.join(root, "node_modules", "left-pad.js"), "", "utf8");
    writeFile("notes/keep.md", "kept");

    expect(listFiles().map((entry) => entry.path)).toEqual(["notes", "notes/keep.md"]);
  });

  it("lists directories at the depth cap but never descends past it", () => {
    fs.mkdirSync(path.join(root, "a", "b", "c", "d", "e"), { recursive: true });
    fs.writeFileSync(path.join(root, "a", "b", "c", "d", "e", "too-deep.txt"), "x", "utf8");

    const paths = listFiles().map((entry) => entry.path);
    expect(paths).toContain("a/b/c/d");
    expect(paths.some((entry) => entry.startsWith("a/b/c/d/"))).toBe(false);
  });

  it("lists a subdirectory on request, still relative to the workspace root", () => {
    writeFile("notes/today.md", "hello");
    writeFile("elsewhere.md", "elsewhere");

    expect(listFiles("notes").map((entry) => entry.path)).toEqual(["notes/today.md"]);
  });

  it("omits a symlink that points outside the workspace", () => {
    writeFile("kept.md", "kept");
    fs.symlinkSync(outsideDir(), path.join(root, "escape"));

    expect(listFiles().map((entry) => entry.path)).toEqual(["kept.md"]);
  });

  it("rejects a file path, a missing directory and a climbing path", () => {
    writeFile("notes/today.md", "hello");

    for (const dir of ["notes/today.md", "does-not-exist", "..", "../outside"]) {
      expect(() => listFiles(dir)).toThrow(WorkspacePathError);
    }
  });
});

describe("readFile", () => {
  it("returns the UTF-8 text of a workspace file", () => {
    writeFile("notes/unicode.md", "naïve — ok");

    expect(readFile("notes/unicode.md")).toBe("naïve — ok");
  });

  it("accepts a file exactly at the 1 MiB cap", () => {
    fs.writeFileSync(path.join(root, "at-cap.txt"), "a".repeat(1024 * 1024), "utf8");

    expect(readFile("at-cap.txt")).toHaveLength(1024 * 1024);
  });

  it("refuses a file over the 1 MiB cap", () => {
    fs.writeFileSync(path.join(root, "big.txt"), "a".repeat(1024 * 1024 + 1), "utf8");

    expect(() => readFile("big.txt")).toThrow(/caps files at 1 MiB/);
  });

  it("refuses a file that looks binary", () => {
    fs.writeFileSync(path.join(root, "binary.bin"), Buffer.from([0x61, 0x00, 0x62]));

    expect(() => readFile("binary.bin")).toThrow(/NUL byte/);
  });

  it("rejects a missing file and a directory", () => {
    writeFile("notes/today.md", "hello");

    expect(() => readFile("notes/missing.md")).toThrow(/does not exist/);
    expect(() => readFile("notes")).toThrow(/is not a file/);
  });
});

describe("writeFile", () => {
  it("creates parent directories and writes UTF-8", () => {
    writeFile("deep/nested/file.txt", "written");

    expect(fs.readFileSync(path.join(root, "deep", "nested", "file.txt"), "utf8")).toBe("written");
  });

  it("accepts content exactly at the 4 MB cap and refuses more", () => {
    writeFile("at-cap.txt", "a".repeat(4 * 1024 * 1024));
    expect(fs.statSync(path.join(root, "at-cap.txt")).size).toBe(4 * 1024 * 1024);

    expect(() => writeFile("too-big.txt", "a".repeat(4 * 1024 * 1024 + 1))).toThrow(/caps saves at 4 MB/);
    expect(fs.existsSync(path.join(root, "too-big.txt"))).toBe(false);
  });
});

describe("path guarding", () => {
  it("rejects absolute paths with the domain error", () => {
    expect(() => readFile("/etc/passwd")).toThrow(WorkspacePathError);
    expect(() => readFile("/etc/passwd")).toThrow(/is absolute/);
    expect(() => writeFile("/tmp/evil.txt", "x")).toThrow(/is absolute/);
  });

  it("rejects `..` segments, including ones buried in a longer path", () => {
    expect(() => readFile("../outside.txt")).toThrow(/climbs out of the workspace/);
    expect(() => readFile("notes/../../outside.txt")).toThrow(/climbs out of the workspace/);
    expect(() => writeFile("notes/../..", "x")).toThrow(WorkspacePathError);
  });

  it("rejects a NUL byte in the path", () => {
    expect(() => readFile("notes\u0000.md")).toThrow(/NUL byte/);
  });

  it("rejects reading and writing through a symlink that leaves the workspace", () => {
    const secretDir = outsideDir();
    fs.writeFileSync(path.join(secretDir, "secret.txt"), "secret", "utf8");
    fs.symlinkSync(secretDir, path.join(root, "link"));

    expect(() => readFile("link/secret.txt")).toThrow(/escapes the workspace through a link/);
    expect(() => writeFile("link/planted.txt", "x")).toThrow(WorkspacePathError);
    expect(fs.existsSync(path.join(secretDir, "planted.txt"))).toBe(false);
  });

  it("still follows a symlink that stays inside the workspace", () => {
    writeFile("real/inner.txt", "inside");
    fs.symlinkSync(path.join(root, "real"), path.join(root, "alias"));

    expect(readFile("alias/inner.txt")).toBe("inside");
  });
});

describe("revealPath", () => {
  it("opens the workspace root when no path is given", async () => {
    revealPath();

    await vi.waitFor(() => expect(shell.openPath).toHaveBeenCalledWith(root));
  });

  it("opens a directory and selects a file", () => {
    writeFile("notes/today.md", "hello");

    revealPath("notes");
    expect(shell.openPath).toHaveBeenCalledWith(path.join(root, "notes"));

    revealPath("notes/today.md");
    expect(shell.showItemInFolder).toHaveBeenCalledWith(path.join(root, "notes", "today.md"));
  });

  it("rejects a path that does not exist", () => {
    expect(() => revealPath("notes/missing.md")).toThrow(WorkspacePathError);
  });
});

describe("stageFile", () => {
  it("copies the attachment into uploads with a timestamped, sanitized name", () => {
    const data = new Uint8Array([1, 2, 3, 4]);

    const staged = stageFile("../../Q3 report (final).pdf", data);

    expect(staged).toMatchObject({ name: "Q3 report -final-.pdf", bytes: 4 });
    expect(staged.relativePath).toMatch(/^uploads\/\d{8}-\d{6}-Q3 report -final-\.pdf$/);
    expect(Array.from(fs.readFileSync(path.join(root, staged.relativePath)))).toEqual([1, 2, 3, 4]);
  });

  it("strips directory components from an attachment name", () => {
    const staged = stageFile("../../etc/passwd", new Uint8Array([1]));

    expect(staged.name).toBe("passwd");
    expect(path.basename(staged.relativePath)).toMatch(/^\d{8}-\d{6}-passwd$/);
  });

  it("falls back to a placeholder name for a blank one", () => {
    const staged = stageFile("   ", new Uint8Array([]));

    expect(staged.name).toBe("file");
    expect(staged.bytes).toBe(0);
  });

  it("keeps same-named attachments in the same second apart", () => {
    const first = stageFile("report.pdf", new Uint8Array([1]));
    const second = stageFile("report.pdf", new Uint8Array([2]));

    expect(second.relativePath).not.toBe(first.relativePath);
    expect(fs.existsSync(path.join(root, first.relativePath))).toBe(true);
    expect(fs.existsSync(path.join(root, second.relativePath))).toBe(true);
  });
});
