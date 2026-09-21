import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Pencil, RefreshCw, Search, Trash2, X } from "lucide-react";

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
import { cn } from "../lib/utils";
import { hermes } from "../lib/ipc";
import { reportError } from "../lib/log";
import type { ThreadSummary } from "@shared/wire";

export interface ThreadsViewProps {
  /** Highlighted in the list; App also uses it to drop the chat when it disappears. */
  activeThreadId: string;
  onOpenThread: (id: string) => void;
  onThreadRemoved: (id: string) => void;
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (!Number.isFinite(diff) || diff < 0) return new Date(ts).toLocaleDateString();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function messageLabel(count: number): string {
  return `${count} ${count === 1 ? "message" : "messages"}`;
}

export function ThreadsView({ activeThreadId, onOpenThread, onThreadRemoved }: ThreadsViewProps) {
  const [items, setItems] = useState<ThreadSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");

  /** Rename and delete failures surface here, under the header, never in a console. */
  const [actionError, setActionError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ThreadSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    setErrorCode(null);
    try {
      const r = await hermes.threads.list();
      if (r.ok) {
        setItems(r.data);
      } else {
        setError(r.error.message);
        setErrorCode(r.error.code);
        reportError("threads.list", `${r.error.code}: ${r.error.message}`);
      }
    } catch (err) {
      // A rejected invoke (transport failure) is not a Result envelope, so it
      // gets the same treatment: report it and show the retryable error pane.
      setError(err instanceof Error ? err.message : String(err));
      setErrorCode(null);
      reportError("threads.list", err);
    }
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Entering rename mode selects the current title so typing replaces it.
  useEffect(() => {
    if (renamingId) renameInputRef.current?.select();
  }, [renamingId]);

  const needle = query.trim().toLowerCase();
  const searching = needle.length > 0;
  const visible = useMemo(() => {
    if (!items) return null;
    if (!needle) return items;
    // A thread stays reachable by the id App puts in the URL-ish state even when
    // its title was renamed to something unrecognizable.
    return items.filter(
      (thread) =>
        thread.title.toLowerCase().includes(needle) || thread.id.toLowerCase().includes(needle)
    );
  }, [items, needle]);

  const inlineError = error && items !== null ? error : actionError;

  function startRename(thread: ThreadSummary) {
    setActionError(null);
    setDraft(thread.title);
    setRenamingId(thread.id);
  }

  /**
   * Blank and unchanged drafts both cancel: neither carries a change worth
   * writing, so the row just leaves edit mode.
   */
  async function submitRename(thread: ThreadSummary) {
    const title = draft.trim();
    if (!title || title === thread.title) {
      setRenamingId(null);
      return;
    }
    setSavingRename(true);
    try {
      const r = await hermes.threads.rename(thread.id, title);
      if (!r.ok) {
        reportError("threads.rename", `${r.error.code}: ${r.error.message}`);
        setActionError(`Could not rename “${thread.title}”: ${r.error.message}`);
        return; // keep the input open so the draft is not lost
      }
      setRenamingId(null);
      await load();
    } catch (err) {
      reportError("threads.rename", err);
      setActionError(
        `Could not rename “${thread.title}”: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setSavingRename(false);
    }
  }

  async function submitDelete() {
    const thread = pendingDelete;
    if (!thread) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const r = await hermes.threads.remove(thread.id);
      if (!r.ok) {
        reportError("threads.remove", `${r.error.code}: ${r.error.message}`);
        setDeleteError(r.error.message);
        setActionError(`Could not delete “${thread.title}”: ${r.error.message}`);
        return;
      }
    } catch (err) {
      reportError("threads.remove", err);
      const message = err instanceof Error ? err.message : String(err);
      setDeleteError(message);
      setActionError(`Could not delete “${thread.title}”: ${message}`);
      return;
    } finally {
      setDeleting(false);
    }
    setPendingDelete(null);
    if (renamingId === thread.id) setRenamingId(null);
    // App drops the chat when the deleted thread was the active one, so this
    // has to run before the refreshed list lands.
    onThreadRemoved(thread.id);
    await load();
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b px-4">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="text-sm font-medium text-foreground">Threads</h1>
          {items && items.length > 0 ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              {searching ? `${visible?.length ?? 0} of ${items.length}` : items.length}
            </span>
          ) : null}
          <div className="relative w-56 max-w-full">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search threads…"
              aria-label="Search threads"
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Refresh threads"
          onClick={() => void load()}
          disabled={refreshing}
          className="size-8 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          {error && items === null ? (
            <div className="flex flex-col items-start gap-3 p-4">
              <div className="text-sm text-destructive">
                <p className="font-medium">Could not load threads</p>
                <p className="text-xs">
                  {errorCode ? `${errorCode}: ` : ""}
                  {error}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void load()}
                disabled={refreshing}
              >
                <RefreshCw className="size-4" />
                Retry
              </Button>
            </div>
          ) : items === null ? (
            <p className="p-4 text-sm text-muted-foreground">Loading threads…</p>
          ) : (
            <div className="flex flex-col">
              {inlineError ? (
                <p className="border-b px-4 py-2 text-xs text-destructive" role="alert">
                  {inlineError}
                </p>
              ) : null}
              {items.length === 0 ? (
                <div className="flex flex-col gap-1 p-4">
                  <p className="text-sm text-muted-foreground">
                    No threads yet — start one in Chat.
                  </p>
                  <p className="text-xs text-muted-foreground/60">
                    Threads appear here after the agent runs a task.
                  </p>
                </div>
              ) : visible && visible.length === 0 ? (
                <div className="flex flex-col items-start gap-2 p-4">
                  <p className="text-sm text-muted-foreground">No threads match “{query.trim()}”.</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => setQuery("")}>
                    Clear search
                  </Button>
                </div>
              ) : (
                <ul className="flex flex-col gap-1 p-2">
                  {(visible ?? items).map((thread) => {
                    const isActive = thread.id === activeThreadId;
                    const isRenaming = renamingId === thread.id;
                    return (
                      <li
                        key={thread.id}
                        className={cn(
                          "flex items-center gap-1 rounded-md pr-1",
                          isActive && "bg-muted"
                        )}
                      >
                        {isRenaming ? (
                          <div className="flex min-w-0 flex-1 items-center gap-1 py-1 pl-2">
                            <Input
                              ref={renameInputRef}
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void submitRename(thread);
                                } else if (e.key === "Escape") {
                                  e.preventDefault();
                                  setRenamingId(null);
                                }
                              }}
                              disabled={savingRename}
                              maxLength={120}
                              aria-label={`Rename ${thread.title}`}
                              className="h-8 min-w-0 flex-1 text-sm"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label="Save title"
                              disabled={savingRename}
                              onClick={() => void submitRename(thread)}
                              className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
                            >
                              <Check className="size-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label="Cancel rename"
                              disabled={savingRename}
                              onClick={() => setRenamingId(null)}
                              className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
                            >
                              <X className="size-4" />
                            </Button>
                          </div>
                        ) : (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              aria-current={isActive ? "true" : undefined}
                              onClick={() => onOpenThread(thread.id)}
                              className="h-auto w-full min-w-0 flex-1 items-start justify-between gap-4 rounded-md px-3 py-2 text-left hover:bg-muted"
                            >
                              <span className="flex min-w-0 flex-col gap-0.5">
                                <span className="truncate text-sm font-medium text-foreground">
                                  {thread.title}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  <span title={new Date(thread.updatedAt).toLocaleString()}>
                                    {formatRelative(thread.updatedAt)}
                                  </span>
                                  {isActive ? (
                                    <span className="ml-2 text-foreground/70">current</span>
                                  ) : null}
                                </span>
                              </span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {messageLabel(thread.messageCount)}
                              </span>
                            </Button>
                            <div className="flex shrink-0 items-center">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Rename ${thread.title}`}
                                onClick={() => startRename(thread)}
                                className="size-8 text-muted-foreground hover:text-foreground"
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Delete ${thread.title}`}
                                onClick={() => {
                                  setActionError(null);
                                  setDeleteError(null);
                                  setPendingDelete(thread);
                                }}
                                className="size-8 text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </ScrollArea>
      </div>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{pendingDelete?.title}”?</DialogTitle>
            <DialogDescription>
              The thread and its saved checkpoints are removed from disk, so the transcript is
              gone for good. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteError && <p className="text-[11px] text-destructive">{deleteError}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={deleting}
              onClick={() => setPendingDelete(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={() => void submitDelete()}
            >
              {deleting ? "Deleting…" : "Delete thread"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
