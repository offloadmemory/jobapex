import type { HITLRequestWire, Todo, WireEvent, WireMsg } from "@shared/wire";

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

export interface ApprovalState {
  runId: string;
  request: HITLRequestWire;
}

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

  consume(ev: WireEvent): void {
    switch (ev.type) {
      case "token":
        this.consumeToken(ev.msg, ev.depth);
        break;
      case "update":
        this.consumeUpdate(ev.msg, ev.depth);
        break;
      case "todos":
        this.setTodos(ev.todos);
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
      case "done":
        this.flushLive();
        this.setStatus("idle");
        break;
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