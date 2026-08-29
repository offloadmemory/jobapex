/**
 * Observable UI state for the Ink REPL. Interprets the same StreamEvent
 * seam render.ts consumes — the store owns state transitions, React only
 * renders. No React imports; App re-renders via useSyncExternalStore.
 */

import type { HITLRequest, HITLResponse } from "langchain";
import { contentToString, type StreamEvent, type Todo } from "../stream-events.js";

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
  isError?: boolean;
}

export type Status = "idle" | "streaming" | "approval";

export interface ApprovalState {
  request: HITLRequest;
  resolve: (r: HITLResponse) => void;
}

export class UIStore {
  /** Completed log, rendered once via <Static>. */
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

  /** Version counter — the snapshot useSyncExternalStore compares. */
  getSnapshot = (): number => this.version;

  private emit(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  addEntry(kind: EntryKind, text: string, depth = 0, isError = false): void {
    // Copy-on-write: <Static> memoizes on array identity, so in-place pushes
    // never re-render the transcript.
    this.entries = [
      ...this.entries,
      {
        id: this.nextId++,
        kind,
        text,
        depth,
        ...(isError ? { isError: true } : {}),
      },
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

  /** Consume one parsed stream event (token or node update). Mirrors
   * render.ts's lineState transitions, but into state. */
  consume(ev: StreamEvent): void {
    if (ev.kind === "token") {
      this.consumeToken(ev.msg, ev.depth);
      return;
    }
    for (const [key, nodeUpdate] of Object.entries(ev.update ?? {})) {
      if (key === "__interrupt__") continue; // approval interrupts are handled by the caller
      if (nodeUpdate && typeof nodeUpdate === "object") {
        this.consumeNodeUpdate(nodeUpdate as Record<string, unknown>, ev.depth);
      }
    }
  }

  private consumeToken(msg: Record<string, any>, depth: number): void {
    if ((msg.getType?.() ?? msg.type) !== "ai") return;
    const reasoning = msg.additional_kwargs?.reasoning_content as string | undefined;
    const text = contentToString(msg.content);
    if (!reasoning && !text) return;
    if (!this.live) this.live = { thinking: "", text: "", depth };
    // A depth change means render.ts starts a new line (and re-indents), so
    // the live block must break there too — otherwise tokens from both sides
    // of the boundary merge into one entry flushed at the last-seen depth.
    if (this.live.depth !== depth) {
      this.flushLive();
      this.live = { thinking: "", text: "", depth };
    }
    if (reasoning) this.live.thinking += reasoning;
    if (text) this.live.text += text;
    this.emit(); // React batches; a depth boundary may emit several times
  }

  /** Consume one state-update chunk from a node ("model", "tools", ...). */
  private consumeNodeUpdate(update: Record<string, unknown>, depth: number): void {
    const messages = (update.messages ?? []) as Array<Record<string, any>>;
    for (const msg of messages) {
      const type = msg.getType?.() ?? msg.type;
      if (type === "ai") {
        const toolCalls = (msg.tool_calls ?? []) as Array<Record<string, any>>;
        if (toolCalls.length > 0) {
          this.flushLive();
          for (const tc of toolCalls) {
            if (tc.name === "write_todos") continue; // rendered from state below
            if (tc.name === "task") {
              const sub = tc.args?.subagent_type ?? "general-purpose";
              this.addEntry(
                "delegate",
                `delegate → ${sub} — ${String(tc.args?.description ?? "")}`,
                depth
              );
            } else {
              this.addEntry("tool", `${tc.name} ${JSON.stringify(tc.args ?? {})}`, depth);
            }
          }
        }
        // ai text with no tool_calls: tokens already streamed; flushLive at
        // the end of the run captures it.
      } else if (type === "tool") {
        this.flushLive();
        const text = contentToString(msg.content);
        if (text.startsWith("Updated todo list")) continue; // 📋 renders from state
        this.addEntry("toolResult", text, depth, msg.status === "error");
      }
    }
    if (Array.isArray(update.todos)) this.setTodos(update.todos as Todo[]);
  }

  /** Flush the live block into transcript entries (call when a run ends). */
  flushLive(): void {
    if (!this.live) return;
    const { thinking, text, depth } = this.live;
    this.live = null;
    // Visual order: the thinking block streams above the answer text.
    if (thinking.trim()) this.addEntry("thinking", thinking.trim(), depth);
    if (text.trim()) this.addEntry("assistant", text.trim(), depth);
  }
}