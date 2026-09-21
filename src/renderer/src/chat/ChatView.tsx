import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AlertCircle, Download, Loader2, Paperclip, Plus, X } from "lucide-react";

import type { StagedFile } from "@shared/wire";
import { Button } from "../components/ui/button";
import { lastEntryOf, type ChatStore, type TranscriptEntry } from "../lib/chat-store";
import { hermes } from "../lib/ipc";
import { reportError, reportWarn } from "../lib/log";
import { sendPrompt, ChatRuntimeProvider } from "./runtime";
import { TodoPanel } from "./TodoPanel";
import { ApprovalCard } from "./ApprovalCard";
import { Thread } from "../components/assistant-ui/thread";

interface AppInfoLite {
  model: string;
  baseUrl: string;
  /** null means no saved provider row: the run uses config/env defaults. */
  providerName: string | null;
}

const EMPTY_SUGGESTIONS = [
  "Introduce yourself",
  "What tools do you have?",
  "Plan a task for me",
];

/** Chip label for an attachment; the exact byte count stays in the tooltip. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Transcript → markdown for the export save dialog. Tool rows keep their
 * name+args on one line so a long transcript stays skimmable; subagent
 * (depth > 0) rows are indented under the message that spawned them.
 */
function transcriptMarkdown(assistantName: string, entries: TranscriptEntry[]): string {
  const lines: string[] = [`# ${assistantName}`, ""];
  const row = (entry: TranscriptEntry, prefix: string) =>
    lines.push(`${"  ".repeat(entry.depth)}${prefix}${entry.text}`);
  for (const entry of entries) {
    switch (entry.kind) {
      case "user":
        lines.push("**User**", "", entry.text, "");
        break;
      case "assistant":
        lines.push(`**${assistantName}**`, "", entry.text, "");
        if (entry.thinking) {
          lines.push("<details><summary>Thinking</summary>", "", entry.thinking, "", "</details>", "");
        }
        break;
      case "thinking":
        row(entry, "> ");
        break;
      case "tool":
        row(entry, "- `tool` ");
        break;
      case "toolResult":
        row(entry, entry.isError ? "- `result` (error) " : "- `result` ");
        break;
      case "delegate":
        row(entry, "- `delegate` ");
        break;
      case "system":
        row(entry, "> ");
        break;
      case "error":
        row(entry, "> **Error:** ");
        break;
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/**
 * Subscribe to the store's version-integer snapshot before reading field
 * values, so every store emit re-renders with fresh data (no memoized reads
 * over mutable fields).
 */
function useChatSnapshot(store: ChatStore) {
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  return {
    todos: store.todos,
    approval: store.approval,
    entries: store.entries,
    status: store.status,
  };
}

export function ChatView({
  store,
  threadId,
  onNewThread,
  onOpenSettings,
  onCommand,
}: {
  store: ChatStore;
  threadId: string;
  onNewThread: () => void;
  /** Wired to the sidebar's Settings page (the error banner links there). */
  onOpenSettings: () => void;
  /** Handles composer slash commands; true when the draft was one. */
  onCommand: (draft: string) => boolean;
}) {
  const [info, setInfo] = useState<AppInfoLite | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [infoLoading, setInfoLoading] = useState(true);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const { todos, entries, status } = useChatSnapshot(store);
  // Only the transcript's *latest* failure is actionable: it is the run the
  // user can retry, and the row disappears as soon as that retry starts. The
  // message itself already sits in the transcript, so this stays an action row.
  const latest = entries.at(-1) ?? null;
  const failed = status === "idle" && latest?.kind === "error";
  const retryText = failed ? lastEntryOf(entries, "user")?.text ?? null : null;

  // The store and its event subscription live in App so a run keeps streaming
  // while another view is on screen; the header's model chip is chat-local and
  // re-read on every visit because the provider can change in Settings.
  const loadInfo = useCallback(async () => {
    setInfoLoading(true);
    const result = await hermes.app.getInfo();
    setInfoLoading(false);
    if (result.ok) {
      setInfo({
        model: result.data.model,
        baseUrl: result.data.baseUrl,
        providerName: result.data.providerName,
      });
      setInfoError(null);
      return;
    }
    // Kept inline (not just in the log) so the header can offer a retry instead
    // of sitting on a dead "connecting…" forever.
    setInfoError(result.error.message);
    reportError("chat.getInfo", result.error.message);
  }, []);

  useEffect(() => {
    void loadInfo();
  }, [loadInfo]);

  /**
   * Attachments are copied into the workspace up front: every tool the agent
   * gets sees workspace-relative paths, never a browser File. One bad file
   * must not drop the rest of a multi-file drop or the whole batch.
   */
  const stageFiles = async (files: File[]) => {
    for (const file of files) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const result = await hermes.files.stage(file.name, bytes);
        if (result.ok) {
          setStaged((prev) => [...prev, result.data]);
          continue;
        }
        store.addEntry("error", `Couldn't attach ${file.name}: ${result.error.message}`);
        reportError("chat.files.stage", result.error.message);
      } catch (err) {
        store.addEntry("error", `Couldn't attach ${file.name}.`);
        reportError("chat.files.stage", err);
      }
    }
  };

  const removeStaged = (relativePath: string) => {
    setStaged((prev) => prev.filter((file) => file.relativePath !== relativePath));
  };

  /**
   * Save-dialog export. The assistant name is read here rather than threaded
   * through props: it can be changed in Settings, and it also titles the
   * markdown header.
   */
  const exportTranscript = async () => {
    try {
      const settings = await hermes.app.getSettings();
      if (!settings.ok) {
        reportWarn("chat.exportTranscript", `getSettings failed: ${settings.error.message}`);
      }
      const name = settings.ok ? settings.data.assistantName : "hermes";
      const result = await hermes.app.exportTranscript(name, transcriptMarkdown(name, entries));
      if (!result.ok) {
        store.addEntry("error", `Couldn't export the transcript: ${result.error.message}`);
        reportError("chat.exportTranscript", result.error.message);
        return;
      }
      // null data means the user closed the save dialog — a cancel is not an error.
      if (result.data) store.addEntry("system", "Transcript saved to " + result.data.path);
    } catch (err) {
      store.addEntry("error", "Couldn't export the transcript.");
      reportError("chat.exportTranscript", err);
    }
  };

  return (
    <ChatRuntimeProvider
      store={store}
      threadId={threadId}
      onCommand={onCommand}
      stagedPaths={staged.map((file) => file.relativePath)}
      onStagedConsumed={() => setStaged([])}
    >
      <div
        className="relative flex h-full flex-col"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const files = Array.from(event.dataTransfer.files);
          if (files.length > 0) void stageFiles(files);
        }}
      >
        {dragging ? (
          <div className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-lg border-2 border-dashed border-primary/50 bg-background/85 text-sm font-medium text-primary">
            Drop files to attach
          </div>
        ) : null}
        <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4">
          {info ? (
            <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-2.5 py-1 font-mono text-[11px] font-medium text-foreground">
                {info.model}
              </span>
              {info.providerName === null ? (
                <span
                  className="shrink-0 rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground/70"
                  title="No provider saved in Settings — using config/env defaults."
                >
                  defaults
                </span>
              ) : null}
              <span className="truncate text-muted-foreground/60">via {info.baseUrl}</span>
            </div>
          ) : infoLoading ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/60">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              loading model info…
            </span>
          ) : (
            <div className="flex min-w-0 items-center gap-2 text-xs text-destructive">
              <AlertCircle className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{infoError ?? "Couldn't read the model info."}</span>
              <Button variant="outline" size="sm" onClick={() => void loadInfo()}>
                Retry
              </Button>
            </div>
          )}
          <div className="flex shrink-0 items-center gap-1">
            <button
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              disabled={entries.length === 0}
              onClick={() => void exportTranscript()}
            >
              <Download className="size-3.5" />
              Export
            </button>
            <button
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={onNewThread}
            >
              <Plus className="size-3.5" />
              New thread
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">
          <Thread
            footerExtra={
              <>
                {failed ? (
                  <div className="mb-2 flex w-full items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    <AlertCircle className="size-4 shrink-0" aria-hidden />
                    <span className="flex-1">Last run failed.</span>
                    <div className="flex shrink-0 gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={retryText === null}
                        onClick={() => {
                          // No echo: the failed attempt's user turn is already in
                          // the transcript, and a second one would read as a new
                          // question.
                          if (retryText !== null) {
                            sendPrompt(store, threadId, retryText, { echo: false });
                          }
                        }}
                      >
                        Retry
                      </Button>
                      <Button variant="outline" size="sm" onClick={onOpenSettings}>
                        Provider settings
                      </Button>
                    </div>
                  </div>
                ) : null}
                <TodoPanel todos={todos} />
                {staged.length > 0 ? (
                  <div className="mb-2 flex w-full flex-wrap items-center gap-1.5">
                    {staged.map((file) => (
                      <span
                        key={file.relativePath}
                        className="inline-flex items-center gap-1.5 rounded-md border bg-muted/60 py-1 pl-2 pr-1 text-xs"
                      >
                        <Paperclip className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="font-mono text-[11px]" title={file.relativePath}>
                          {file.name}
                        </span>
                        <span
                          className="text-[11px] text-muted-foreground/60"
                          title={`${file.bytes} bytes`}
                        >
                          {formatBytes(file.bytes)}
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove ${file.name}`}
                          className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                          onClick={() => removeStaged(file.relativePath)}
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
              </>
            }
            suggestions={EMPTY_SUGGESTIONS}
            onSuggestion={(text) => sendPrompt(store, threadId, text)}
          />
        </div>
        <ApprovalCard store={store} threadId={threadId} />
      </div>
    </ChatRuntimeProvider>
  );
}
