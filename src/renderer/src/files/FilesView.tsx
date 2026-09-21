import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  FilePlus2,
  FileText,
  Folder,
  FolderSearch,
  RefreshCw,
  Save,
} from "lucide-react";

import type { FileEntry } from "@shared/wire";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { ScrollArea } from "../components/ui/scroll-area";
import { Textarea } from "../components/ui/textarea";
import { hermes } from "../lib/ipc";
import { reportError, reportWarn } from "../lib/log";
import { cn } from "../lib/utils";

/** The agent's durable wiki; shown as its own section when the folder exists. */
const KB_DIR = "openwiki";

/** Mirrors the main-process save cap so an oversized edit fails visibly, not silently. */
const MAX_EDIT_BYTES = 4 * 1024 * 1024;

/** Indent per nesting level in the flattened listing. */
const INDENT_PX = 12;

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

/** Renderer-side mirror of the main-process path rules, for instant feedback. */
function pathProblem(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return "Enter a path relative to the workspace root.";
  if (trimmed.length > 1024) return "That path is too long (the limit is 1024 characters).";
  if (trimmed.startsWith("/") || /^[A-Za-z]:/.test(trimmed)) {
    return "Use a path relative to the workspace root, not an absolute path.";
  }
  if (trimmed.split(/[\\/]+/).includes("..")) return "The path cannot climb out of the workspace.";
  if (trimmed.endsWith("/") || trimmed.endsWith("\\")) return "Include a file name.";
  return null;
}

const depthOf = (path: string): number => Math.min(path.split("/").length - 1, 4);

/** The knowledge-base section lists notes only; index.md is one of them on purpose. */
const isMarkdown = (entry: FileEntry): boolean =>
  !entry.isDir && entry.name.toLowerCase().endsWith(".md");

export function FilesView() {
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [dir, setDir] = useState("");
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [readError, setReadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);

  const [kbNotes, setKbNotes] = useState<FileEntry[]>([]);

  const [newOpen, setNewOpen] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [newError, setNewError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Listings and reads race on rapid navigation; only the newest answer lands.
  const listSeq = useRef(0);
  const fileSeq = useRef(0);

  useEffect(() => {
    void (async () => {
      const info = await hermes.app.getInfo();
      if (info.ok) setWorkspace(info.data.workspaceDir);
      else reportError("files.info", info.error.message);
    })();
  }, []);

  const loadKb = useCallback(async (present: boolean) => {
    if (!present) {
      setKbNotes([]);
      return;
    }
    const result = await hermes.files.list(KB_DIR);
    if (!result.ok) {
      // The wiki is optional: a folder that vanished between the two listings
      // is a warning, not a page-level failure.
      reportWarn("files.kb", result.error.message);
      setKbNotes([]);
      return;
    }
    setKbNotes(result.data.filter(isMarkdown));
  }, []);

  const loadDir = useCallback(
    async (target: string) => {
      const seq = ++listSeq.current;
      setListError(null);
      const result = await hermes.files.list(target || undefined);
      if (seq !== listSeq.current) return;
      if (!result.ok) {
        reportError("files.list", result.error.message);
        setEntries(null);
        setListError(result.error.message);
        return;
      }
      setEntries(result.data);
      if (target === "") {
        void loadKb(result.data.some((entry) => entry.isDir && entry.name === KB_DIR));
      }
    },
    [loadKb]
  );

  useEffect(() => {
    void loadDir(dir);
  }, [dir, loadDir]);

  const openFile = useCallback(async (target: string) => {
    const seq = ++fileSeq.current;
    setSelected(target);
    setLoadingFile(true);
    setReadError(null);
    setSaveError(null);
    setSaveNote(null);
    const result = await hermes.files.read(target);
    if (seq !== fileSeq.current) return;
    setLoadingFile(false);
    if (!result.ok) {
      reportError("files.read", result.error.message);
      setContent("");
      setSavedContent("");
      setReadError(result.error.message);
      return;
    }
    setContent(result.data);
    setSavedContent(result.data);
  }, []);

  const dirty = content !== savedContent;
  // UTF-8 characters are never shorter than their bytes, so the real byte count
  // is only worth computing once the cheap char count is over the cap.
  const oversizedBytes = useMemo(
    () => (content.length > MAX_EDIT_BYTES ? new TextEncoder().encode(content).byteLength : 0),
    [content]
  );
  const oversized = oversizedBytes > MAX_EDIT_BYTES;

  const saveFile = useCallback(async () => {
    if (!selected || content === savedContent) return;
    setSaving(true);
    setSaveError(null);
    setSaveNote(null);
    const result = await hermes.files.write(selected, content);
    setSaving(false);
    if (!result.ok) {
      reportError("files.write", result.error.message);
      setSaveError(result.error.message);
      return;
    }
    setSavedContent(content);
    setSaveNote("Saved");
    void loadDir(dir);
  }, [content, dir, loadDir, savedContent, selected]);

  // ⌘S / Ctrl+S mirrors the Save button; the app menu owns every other chord.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      if (!selected) return;
      event.preventDefault();
      void saveFile();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveFile, selected]);

  async function reveal(target?: string) {
    const result = await hermes.files.reveal(target);
    if (!result.ok) reportError("files.reveal", result.error.message);
  }

  function openNewDialog() {
    setNewPath(dir ? `${dir}/` : "");
    setNewError(null);
    setCreating(false);
    setNewOpen(true);
  }

  async function submitNewFile() {
    const target = newPath.trim().replace(/^\.\//, "");
    const problem = pathProblem(target);
    if (problem) {
      setNewError(problem);
      return;
    }
    // The visible listing is depth-capped, so ask the parent directory directly:
    // creating a file must never silently truncate one that already exists.
    const slash = target.lastIndexOf("/");
    const parent = slash === -1 ? "" : target.slice(0, slash);
    const siblings = await hermes.files.list(parent || undefined);
    if (
      siblings.ok &&
      siblings.data.some((entry) => entry.path === target && !entry.isDir)
    ) {
      setNewError("That file already exists — open it from the list instead.");
      return;
    }
    setCreating(true);
    setNewError(null);
    const result = await hermes.files.write(target, "");
    setCreating(false);
    if (!result.ok) {
      reportError("files.write", result.error.message);
      setNewError(result.error.message);
      return;
    }
    setNewOpen(false);
    await openFile(target);
    void loadDir(dir);
  }

  const crumbs = dir ? dir.split("/") : [];

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b px-4">
        <div className="flex min-w-0 flex-col">
          <h1 className="text-sm font-semibold">Files</h1>
          <span
            className="max-w-[46ch] truncate font-mono text-[11px] text-muted-foreground"
            title={workspace ?? undefined}
          >
            {workspace ?? "resolving workspace…"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={openNewDialog}>
            <FilePlus2 className="size-3.5" />
            New file
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh listing"
            onClick={() => void loadDir(dir)}
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex w-80 shrink-0 flex-col border-r">
          <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b px-3 text-[11px]">
            <button
              type="button"
              onClick={() => setDir("")}
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 font-mono transition-colors hover:bg-muted",
                dir === "" ? "text-foreground" : "text-muted-foreground"
              )}
            >
              workspace
            </button>
            {crumbs.map((segment, index) => {
              const target = crumbs.slice(0, index + 1).join("/");
              const current = index === crumbs.length - 1;
              return (
                <span key={target} className="flex shrink-0 items-center gap-1">
                  <span className="text-muted-foreground/50">/</span>
                  <button
                    type="button"
                    onClick={() => setDir(target)}
                    className={cn(
                      "rounded px-1.5 py-0.5 font-mono transition-colors hover:bg-muted",
                      current ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {segment}
                  </button>
                </span>
              );
            })}
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {listError ? (
              <div className="flex flex-col items-start gap-3 p-4">
                <p className="text-xs text-destructive">{listError}</p>
                <Button variant="outline" size="sm" onClick={() => void loadDir(dir)}>
                  Retry
                </Button>
              </div>
            ) : entries === null ? (
              <p className="p-4 text-xs text-muted-foreground">Loading…</p>
            ) : entries.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">
                This folder is empty — the agent writes its artifacts here.
              </p>
            ) : (
              <ScrollArea className="h-full">
                <ul className="py-1">
                  {entries.map((entry) => (
                    <li key={entry.path}>
                      <button
                        type="button"
                        onClick={() => (entry.isDir ? setDir(entry.path) : void openFile(entry.path))}
                        style={{ paddingLeft: INDENT_PX + depthOf(entry.path) * INDENT_PX }}
                        className={cn(
                          "flex w-full items-center gap-2 py-1.5 pr-3 text-left transition-colors hover:bg-muted",
                          selected === entry.path && "bg-muted"
                        )}
                      >
                        {entry.isDir ? (
                          <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-xs",
                            entry.isDir ? "font-medium" : "text-foreground/90"
                          )}
                        >
                          {entry.name}
                        </span>
                        {entry.isDir ? null : (
                          <span className="shrink-0 text-[10px] text-muted-foreground/70">
                            {formatBytes(entry.size)}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </div>

          {kbNotes.length > 0 && (
            <div className="shrink-0 border-t">
              <div className="flex h-8 items-center gap-2 px-3">
                <BookOpen className="size-3.5 text-muted-foreground" />
                <span className="text-[11px] font-medium">Knowledge base</span>
                <span className="text-[10px] text-muted-foreground/70">
                  {KB_DIR} · {kbNotes.length} note{kbNotes.length === 1 ? "" : "s"}
                </span>
              </div>
              <ScrollArea className="max-h-56">
                <ul className="pb-2">
                  {kbNotes.map((note) => (
                    <li key={note.path}>
                      <button
                        type="button"
                        onClick={() => void openFile(note.path)}
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-muted",
                          selected === note.path && "bg-muted"
                        )}
                      >
                        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                          {note.path.slice(KB_DIR.length + 1)}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground/70">
                          {formatRelative(note.updatedAt)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {!selected ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <FileText className="size-5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                Select a file to read or edit it. Text files up to 1 MiB open here; binary files
                are refused.
              </p>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b px-4">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-mono text-[11px] text-muted-foreground">
                    {selected}
                  </span>
                  {dirty && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
                  {saveNote && !dirty && (
                    <span className="shrink-0 text-[11px] text-muted-foreground">{saveNote}</span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void reveal(selected)}
                    title="Show in the system file manager"
                  >
                    <FolderSearch className="size-3.5" />
                    Reveal
                  </Button>
                  <Button
                    size="sm"
                    disabled={!dirty || saving || oversized}
                    onClick={() => void saveFile()}
                  >
                    <Save className="size-3.5" />
                    {saving ? "Saving…" : "Save"}
                  </Button>
                </span>
              </div>

              {readError ? (
                <div className="flex flex-col items-start gap-3 p-4">
                  <p className="text-xs text-destructive">{readError}</p>
                  <Button variant="outline" size="sm" onClick={() => void openFile(selected)}>
                    Retry
                  </Button>
                </div>
              ) : loadingFile ? (
                <p className="p-4 text-xs text-muted-foreground">Loading…</p>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col">
                  {saveError && (
                    <p className="shrink-0 border-b bg-destructive/5 px-4 py-2 text-[11px] text-destructive">
                      {saveError}
                    </p>
                  )}
                  {oversized && (
                    <p className="shrink-0 border-b bg-destructive/5 px-4 py-2 text-[11px] text-destructive">
                      {formatBytes(oversizedBytes)} exceeds the 4 MB save limit — trim it before
                      saving.
                    </p>
                  )}
                  <Textarea
                    value={content}
                    spellCheck={false}
                    aria-label={`Contents of ${selected}`}
                    onChange={(event) => setContent(event.target.value)}
                    className="h-full min-h-0 flex-1 resize-none rounded-none border-0 bg-background p-4 font-mono text-xs leading-relaxed focus-visible:ring-0"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New file</DialogTitle>
            <DialogDescription>
              Created inside the workspace with the path you give it; the agent sees the same
              relative path.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">Path</span>
              <Input
                value={newPath}
                onChange={(event) => setNewPath(event.target.value)}
                placeholder="notes/todo.md"
                className="font-mono text-xs"
                autoFocus
              />
              <span className="text-[11px] text-muted-foreground">
                Relative to the workspace root. Missing folders are created.
              </span>
            </label>
            {newError && <p className="text-[11px] text-destructive">{newError}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={creating} onClick={() => void submitNewFile()}>
              {creating ? "Creating…" : "Create file"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
