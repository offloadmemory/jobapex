import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";

import type { NoteInfo } from "@shared/wire";
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
import { reportError, reportInfo } from "../lib/log";
import { cn } from "../lib/utils";

/** Main-process slug rule; the server re-validates. */
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEARCH_DEBOUNCE_MS = 200;

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

export function MemoryView() {
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<NoteInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const [noteText, setNoteText] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editSlug, setEditSlug] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  /** Slug the note had when the dialog opened; differs from editSlug after a rename. */
  const [originalSlug, setOriginalSlug] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  // Overlapping search requests resolve out of order; only the newest wins.
  const listSeq = useRef(0);
  const detailSeq = useRef(0);

  const loadNotes = useCallback(async (rawQuery: string) => {
    const seq = ++listSeq.current;
    const trimmed = rawQuery.trim();
    setError(null);
    const result = trimmed
      ? await hermes.memory.search(trimmed)
      : await hermes.memory.list();
    if (seq !== listSeq.current) return;
    if (result.ok) setNotes(result.data);
    else {
      setError(result.error.message);
      reportError("memory.list", result.error.message);
    }
  }, []);

  const loadNote = useCallback(async (slug: string) => {
    const seq = ++detailSeq.current;
    setDetailLoading(true);
    setDetailError(null);
    const result = await hermes.memory.read(slug);
    if (seq !== detailSeq.current) return;
    setDetailLoading(false);
    if (result.ok) setNoteText(result.data);
    else {
      setNoteText(null);
      setDetailError(result.error.message);
      reportError("memory.read", result.error.message);
    }
  }, []);

  // Empty query falls back to list(); typing is debounced.
  useEffect(() => {
    const timer = setTimeout(() => {
      void loadNotes(query);
    }, query.trim() ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [query, loadNotes]);

  useEffect(() => {
    if (!selected) {
      detailSeq.current += 1;
      setNoteText(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    void loadNote(selected);
  }, [selected, loadNote]);

  const slug = newSlug.trim();
  const slugInvalid = slug.length > 0 && !SLUG_RE.test(slug);
  const editSlugTrimmed = editSlug.trim();
  const editSlugInvalid = editSlugTrimmed.length > 0 && !SLUG_RE.test(editSlugTrimmed);

  function openDialog() {
    setNewSlug("");
    setNewTitle("");
    setNewContent("");
    setFormError(null);
    setSaving(false);
    setDialogOpen(true);
  }

  async function submitNewNote() {
    if (!SLUG_RE.test(slug)) {
      setFormError(
        "Slug must be kebab-case: lowercase letters and numbers joined by single hyphens (e.g. project-goals)."
      );
      return;
    }
    if (!newTitle.trim()) {
      setFormError("Title is required.");
      return;
    }
    setSaving(true);
    setFormError(null);
    const result = await hermes.memory.write({
      slug,
      title: newTitle.trim(),
      content: newContent,
    });
    setSaving(false);
    if (!result.ok) {
      setFormError(result.error.message);
      reportError("memory.write", result.error.message);
      return;
    }
    setDialogOpen(false);
    setSelected(slug);
    void loadNotes(query);
  }

  /** Seeds the edit form from the loaded source so it shows exactly what the file holds. */
  function openEdit() {
    if (!selected || noteText === null) return;
    const lines = noteText.split("\n");
    const heading = lines[0]?.replace(/^#\s*/, "").trim() ?? "";
    const listed = notes?.find((note) => note.slug === selected)?.title;
    setEditSlug(selected);
    setOriginalSlug(selected);
    setEditTitle(heading !== "" ? heading : (listed ?? selected));
    setEditContent(lines.slice(1).join("\n").replace(/^\n+/, "").replace(/\n+$/, ""));
    setEditError(null);
    setEditSaving(false);
    setEditOpen(true);
  }

  async function submitEdit() {
    const nextSlug = editSlugTrimmed;
    if (!SLUG_RE.test(nextSlug)) {
      setEditError(
        "Slug must be kebab-case: lowercase letters and numbers joined by single hyphens (e.g. project-goals)."
      );
      return;
    }
    if (!editTitle.trim()) {
      setEditError("Title is required.");
      return;
    }
    setEditSaving(true);
    setEditError(null);
    const renamed = nextSlug !== originalSlug;
    const result = await hermes.memory.write({
      slug: nextSlug,
      title: editTitle.trim(),
      content: editContent,
      // Main unlinks the old note file and rewrites index.md from this.
      previousSlug: renamed ? originalSlug : undefined,
    });
    setEditSaving(false);
    if (!result.ok) {
      setEditError(result.error.message);
      reportError("memory.write", result.error.message);
      return;
    }
    if (renamed) reportInfo("memory.rename", `Renamed note ${originalSlug} → ${nextSlug}.`);
    setEditOpen(false);
    setSelected(nextSlug);
    void loadNotes(query);
  }

  /**
   * Pruning is the memory page's other half: the note file goes away and
   * index.md is regenerated in main, so the agent stops being offered it.
   */
  async function submitDelete() {
    if (!selected) return;
    setDeleting(true);
    setDeleteError(null);
    const result = await hermes.memory.delete(selected);
    setDeleting(false);
    if (!result.ok) {
      setDeleteError(result.error.message);
      reportError("memory.delete", result.error.message);
      return;
    }
    setConfirmOpen(false);
    setSelected(null);
    void loadNotes(query);
  }

  const searching = query.trim().length > 0;
  const selectedTitle = notes?.find((note) => note.slug === selected)?.title ?? selected;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b px-4">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="text-sm font-semibold">Memory</h1>
          <div className="relative w-64 max-w-full">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search memory…"
              aria-label="Search memory"
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={openDialog}>
            <Plus className="size-3.5" />
            New note
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh notes"
            onClick={() => void loadNotes(query)}
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex w-72 shrink-0 flex-col border-r">
          {error ? (
            <div className="flex flex-col items-start gap-3 p-4">
              <p className="text-xs text-destructive">{error}</p>
              <Button variant="outline" size="sm" onClick={() => void loadNotes(query)}>
                Retry
              </Button>
            </div>
          ) : notes === null ? (
            <p className="p-4 text-xs text-muted-foreground">Loading…</p>
          ) : notes.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">
              {searching
                ? `No notes match "${query.trim()}"`
                : "No notes yet — the agent writes these as it learns about you."}
            </p>
          ) : (
            <ScrollArea className="h-full">
              <ul className="divide-y">
                {notes.map((note) => (
                  <li key={note.slug}>
                    <button
                      type="button"
                      onClick={() => setSelected(note.slug)}
                      className={cn(
                        "flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-muted",
                        selected === note.slug && "bg-muted"
                      )}
                    >
                      <span className="truncate text-sm font-medium text-foreground">
                        {note.title}
                      </span>
                      <span className="truncate font-mono text-[11px] text-muted-foreground">
                        {note.slug}
                      </span>
                      <span className="text-[11px] text-muted-foreground/70">
                        {formatRelative(note.updatedAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {!selected ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <FileText className="size-5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                Select a note to read its markdown source.
              </p>
            </div>
          ) : detailError ? (
            <div className="flex flex-col items-start gap-3 p-4">
              <p className="text-xs text-destructive">{detailError}</p>
              <Button variant="outline" size="sm" onClick={() => void loadNote(selected)}>
                Retry
              </Button>
            </div>
          ) : detailLoading ? (
            <p className="p-4 text-xs text-muted-foreground">Loading…</p>
          ) : noteText === null ? (
            <p className="p-4 text-xs text-muted-foreground">Note not found</p>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b px-4">
                <span className="truncate font-mono text-[11px] text-muted-foreground">
                  {selected}.md
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={openEdit}>
                    <Pencil className="size-3.5" />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      setDeleteError(null);
                      setConfirmOpen(true);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                    Delete
                  </Button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <ScrollArea className="h-full">
                  <pre className="whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed">
                    {noteText}
                  </pre>
                </ScrollArea>
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New note</DialogTitle>
            <DialogDescription>
              Saved to memory as a markdown file the agent can read later.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">Slug</span>
              <Input
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                placeholder="project-goals"
                className="font-mono text-xs"
              />
              {slugInvalid && (
                <span className="text-[11px] text-destructive">
                  Use lowercase kebab-case, e.g. project-goals.
                </span>
              )}
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">Title</span>
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Project goals"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">Content</span>
              <Textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="- Ships by Friday"
                rows={8}
                className="font-mono text-xs"
              />
            </label>
            {formError && <p className="text-[11px] text-destructive">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={saving} onClick={() => void submitNewNote()}>
              {saving ? "Saving…" : "Save note"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{selectedTitle}”?</DialogTitle>
            <DialogDescription>
              The note file is removed from memory and dropped from index.md, so the agent
              stops seeing it. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteError && <p className="text-[11px] text-destructive">{deleteError}</p>}
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={() => void submitDelete()}
            >
              {deleting ? "Deleting…" : "Delete note"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit note</DialogTitle>
            <DialogDescription>
              Renaming the slug moves the note: the old file is unlinked and index.md is
              rewritten with the new name only.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">Slug</span>
              <Input
                value={editSlug}
                onChange={(e) => setEditSlug(e.target.value)}
                placeholder="project-goals"
                className="font-mono text-xs"
              />
              {editSlugInvalid && (
                <span className="text-[11px] text-destructive">
                  Use lowercase kebab-case, e.g. project-goals.
                </span>
              )}
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">Title</span>
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Project goals"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">Content</span>
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                placeholder="- Ships by Friday"
                rows={8}
                className="font-mono text-xs"
              />
            </label>
            {editError && <p className="text-[11px] text-destructive">{editError}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={editSaving} onClick={() => void submitEdit()}>
              {editSaving ? "Saving…" : "Save note"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
