import type { HITLRequestWire, ThreadHistoryMessage, Todo, WireEvent, WireMsg } from "@shared/wire";

export type EntryKind =
  | "user"
  | "assistant"
  | "thinking"
  | "tool"
  | "toolResult"
  | "delegate"
  | "system"
  | "error";

export interface TranscriptEntry {
  id: number;
  kind: EntryKind;
  text: string;
  depth: number;
  thinking?: string;
  isError?: boolean;
}

export type Status = "idle" | "streaming" | "approval";

/**
 * Human-friendly one-liner for a terminal run error, shown inline in the
 * transcript. Connection failures to the model daemon get an actionable hint;
 * anything else surfaces the raw error string as-is (it already arrives as
 * `name: message` from the main process).
 */
export function friendlyError(raw: string): string {
  if (/ECONNREFUSED|Connection refused|fetch failed|ENOTFOUND|ECONNRESET/i.test(raw)) {
    return `Can't reach the model server — is Ollama running? (${raw})`;
  }
  return raw;
}

/** Most recent entry of a kind — the retry target for a failed run. */
export function lastEntryOf(entries: TranscriptEntry[], kind: EntryKind): TranscriptEntry | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry && entry.kind === kind) return entry;
  }
  return null;
}

export interface ApprovalState {
  runId: string;
  request: HITLRequestWire;
}

/** Checkpointer roles map onto the transcript kinds the Thread renderer knows. */
const HISTORY_KINDS: Record<ThreadHistoryMessage["role"], EntryKind> = {
  user: "user",
  assistant: "assistant",
  tool: "toolResult",
  system: "system",
};

export class ChatStore {
  entries: TranscriptEntry[] = [];
  todos: Todo[] = [];
  status: Status = "idle";
  live: { thinking: string; text: string; depth: number } | null = null;
  approval: ApprovalState | null = null;
  private version = 0;
  private listeners = new Set<() => void>();
  private nextId = 1;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): number => this.version;

  private emit(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  addEntry(kind: EntryKind, text: string, depth = 0, isError = false): void {
    this.entries = [
      ...this.entries,
      { id: this.nextId++, kind, text, depth, ...(isError ? { isError: true } : {}) },
    ];
    this.emit();
  }

  setTodos(todos: Todo[]): void {
    this.todos = todos;
    this.emit();
  }

  setStatus(s: Status): void {
    if (this.status === s) return;
    this.status = s;
    this.emit();
  }

  clearApproval(): void {
    this.approval = null;
    this.emit();
  }

  /** Replay a stored thread's history into the transcript (resume from Threads). */
  loadHistory(messages: ThreadHistoryMessage[]): void {
    this.entries = messages
      .filter((message) => message.content.trim().length > 0)
      .map((message) => ({
        id: this.nextId++,
        kind: HISTORY_KINDS[message.role],
        text: message.content,
        depth: 0,
      }));
    this.todos = [];
    this.live = null;
    this.approval = null;
    this.status = "idle";
    this.emit();
  }

  /** Wipe everything and return to a blank idle thread ("New thread"). */
  reset(): void {
    this.entries = [];
    this.todos = [];
    this.live = null;
    this.approval = null;
    this.status = "idle";
    this.emit();
  }

  consume(ev: WireEvent): void {
    switch (ev.type) {
      case "token":
        this.consumeToken(ev.msg, ev.depth);
        break;
      case "update":
        this.consumeUpdate(ev.msg, ev.depth);
        break;
      case "todos":
        // A subagent (depth > 0) keeps its own plan; only the main thread's
        // plan may drive the TodoPanel, otherwise a subagent's list would
        // replace the user's view of the run.
        if (ev.depth === 0) this.setTodos(ev.todos);
        break;
      case "drain":
        this.flushLive();
        break;
      case "approval":
        this.approval = { runId: ev.runId, request: ev.request };
        this.setStatus("approval");
        // setStatus early-returns when status is already "approval" (e.g. after
        // clearApproval(), which does not reset status), so emit unconditionally
        // to guarantee subscribers see the new request.
        this.emit();
        break;
      case "done": {
        // A terminal done for a run that was already torn down (e.g. the
        // cancelled orphan run's done landing after "New thread" reset the
        // store) arrives while idle with nothing buffered. Treat it as a
        // no-op so a stale run can never mutate a fresh thread.
        if (this.status === "idle" && !this.live && !this.approval) return;
        this.flushLive();
        // Surface the terminal outcome inline:
        //  - an error entry whenever the run failed (runtime's result.error);
        //    note a genuine user cancel from runtime arrives as
        //    cancelled:true with NO error, so an error+cancelled combination
        //    can only be chat.ts's unexpected-failure catch, which must not
        //    be masked as a clean "task cancelled".
        //  - a plain "task cancelled" note for a user-initiated cancel.
        //  - a subtle memory note for a successful post-turn consolidation.
        if (ev.error) {
          this.addEntry("error", friendlyError(ev.error));
        } else if (ev.cancelled) {
          this.addEntry("system", "task cancelled");
        }
        const remembered = ev.rememberedNotes ?? 0;
        if (remembered > 0) {
          this.addEntry("system", `remembered ${remembered} note${remembered === 1 ? "" : "s"}`);
        }
        this.setStatus("idle");
        // A terminal done while the approval card is up (e.g. the run failed
        // and chat.ts emitted done with the interrupt promise still pending)
        // tears down the run: drop the dead card too, or the user would answer
        // a dialog for a run that no longer exists and resolve()'s
        // setStatus("streaming") would strand the UI forever.
        this.approval = null;
        break;
      }
    }
  }

  private consumeToken(msg: WireMsg, depth: number): void {
    if (msg.type !== "ai") return;
    if (!msg.reasoning && !msg.content) return;
    if (!this.live) this.live = { thinking: "", text: "", depth };
    if (this.live.depth !== depth) {
      this.flushLive();
      this.live = { thinking: "", text: "", depth };
    }
    if (msg.reasoning) this.live.thinking += msg.reasoning;
    if (msg.content) this.live.text += msg.content;
    this.emit();
  }

  private consumeUpdate(msg: WireMsg, depth: number): void {
    if (msg.type === "ai") {
      const toolCalls = msg.toolCalls ?? [];
      if (toolCalls.length > 0) {
        this.flushLive();
        for (const tc of toolCalls) {
          if (tc.name === "write_todos") continue;
          if (tc.name === "task") {
            const args = tc.args as { subagent_type?: string; description?: string };
            this.addEntry(
              "delegate",
              `delegate → ${args.subagent_type ?? "general-purpose"} — ${String(args.description ?? "")}`,
              depth
            );
          } else {
            this.addEntry("tool", `${tc.name} ${JSON.stringify(tc.args ?? {})}`, depth);
          }
        }
      }
    } else if (msg.type === "tool") {
      this.flushLive();
      if (msg.content.startsWith("Updated todo list")) return;
      this.addEntry("toolResult", msg.content, depth, msg.isError);
    }
  }

  flushLive(): void {
    if (!this.live) return;
    const { thinking, text, depth } = this.live;
    this.live = null;
    if (thinking.trim() || text.trim()) {
      this.entries = [
        ...this.entries,
        {
          id: this.nextId++,
          kind: "assistant",
          text: text.trim(),
          depth,
          ...(thinking.trim() ? { thinking: thinking.trim() } : {}),
        },
      ];
      this.emit();
    }
  }
}