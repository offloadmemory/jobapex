/**
 * Pretty-printing for the agent's streamed updates. Pure functions +
 * a small stateful renderer so the REPL stays thin. No dependency on the
 * terminal beyond ANSI escapes, so a future UI can replace this module.
 */

import {
  contentToString,
  nestingDepth,
  parseChunk,
  truncate,
  type StreamEvent,
} from "./stream-events.js";

export type { Todo } from "./stream-events.js";
import type { Todo } from "./stream-events.js";

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
};

const TODO_ICON: Record<Todo["status"], string> = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
};

export class StreamRenderer {
  /** Last todo list seen, so the REPL can re-print it on /todos */
  todos: Todo[] = [];
  /** What the current stdout line contains, so sections don't collide. */
  private lineState: "clean" | "thinking" | "text" = "clean";
  private streamDepth = 0;

  /**
   * @param streamTokens when true, assistant prose is expected to arrive
   * token-by-token via renderToken(), so renderNodeUpdate() skips it to
   * avoid printing everything twice.
   */
  constructor(private streamTokens = false) {}

  /** End any in-progress token line so block output starts clean. */
  finishLine(): void {
    if (this.lineState !== "clean") {
      process.stdout.write(`${ansi.reset}\n`);
      if (this.lineState === "text" && this.streamDepth === 0) process.stdout.write("\n");
      this.lineState = "clean";
    }
  }

  /** Stream one model chunk: thinking tokens dim with a 🧠 header, answer tokens plain. */
  renderToken(msg: Record<string, any>, depth: number): void {
    if ((msg.getType?.() ?? msg.type) !== "ai") return;
    const indent = "  ".repeat(depth);
    const reasoning = msg.additional_kwargs?.reasoning_content as string | undefined;
    if (reasoning) {
      if (this.lineState !== "thinking" || this.streamDepth !== depth) {
        this.finishLine();
        process.stdout.write(`${indent}${ansi.dim}🧠 `);
        this.lineState = "thinking";
        this.streamDepth = depth;
      }
      process.stdout.write(`${ansi.dim}${reasoning}`);
    }
    const text = contentToString(msg.content);
    if (text) {
      if (this.lineState !== "text" || this.streamDepth !== depth) {
        this.finishLine();
        if (depth > 0) process.stdout.write(`${indent}${ansi.dim}`);
        this.lineState = "text";
        this.streamDepth = depth;
      }
      process.stdout.write(depth > 0 ? `${ansi.dim}${text}` : text);
    }
  }

  renderTodos(todos: Todo[]): void {
    this.finishLine();
    this.todos = todos;
    console.log(`${ansi.yellow}${ansi.bold}📋 plan${ansi.reset}`);
    for (const t of todos) {
      const color = t.status === "completed" ? ansi.green : t.status === "in_progress" ? ansi.yellow : ansi.dim;
      console.log(`  ${color}${TODO_ICON[t.status]} ${t.content}${ansi.reset}`);
    }
  }

  /** Render one state-update chunk from a node ("model", "tools", ...). */
  renderNodeUpdate(update: Record<string, unknown>, depth: number): void {
    const indent = "  ".repeat(depth);
    const messages = (update.messages ?? []) as Array<Record<string, any>>;

    for (const msg of messages) {
      const type = msg.getType?.() ?? msg.type;
      if (type === "ai" || type === "tool") this.finishLine();

      if (type === "ai") {
        for (const tc of msg.tool_calls ?? []) {
          if (tc.name === "write_todos") continue; // rendered from state below
          if (tc.name === "task") {
            const sub = tc.args?.subagent_type ?? "general-purpose";
            console.log(
              `${indent}${ansi.magenta}${ansi.bold}🤖 delegate → ${sub}${ansi.reset}${ansi.dim} ${truncate(String(tc.args?.description ?? ""), 160)}${ansi.reset}`
            );
          } else {
            console.log(
              `${indent}${ansi.cyan}🔧 ${tc.name}${ansi.reset}${ansi.dim} ${truncate(JSON.stringify(tc.args ?? {}), 160)}${ansi.reset}`
            );
          }
        }
        const text = contentToString(msg.content);
        if (text.trim() && (msg.tool_calls ?? []).length === 0 && !this.streamTokens) {
          // Assistant prose. At depth 0 this is (part of) the final answer.
          // Skipped when prose is streamed token-by-token via renderToken().
          console.log(`${indent}${depth > 0 ? ansi.dim : ""}${text.trim()}${ansi.reset}\n`);
        }
      } else if (type === "tool") {
        const text = contentToString(msg.content);
        if (text.startsWith("Updated todo list")) continue; // 📋 renders from state
        const status = msg.status === "error" ? `${ansi.red}✗` : `${ansi.dim}↳`;
        console.log(`${indent}${status} ${truncate(text)}${ansi.reset}`);
      }
    }

    if (Array.isArray(update.todos)) {
      this.renderTodos(update.todos as Todo[]);
    }
  }

  /** Render one pre-parsed stream event (see stream-events.parseChunk). */
  renderEvent(ev: StreamEvent): void {
    if (ev.kind === "token") this.renderToken(ev.msg, ev.depth);
    else this.renderUpdate(ev.update, ev.depth);
  }

  /**
   * Render one streamed chunk (with subgraphs: true). Handles both shapes:
   * - single streamMode:   [namespace, update]
   * - multiple streamModes: [namespace, mode, payload] — "messages" payloads
   *   are [messageChunk, metadata] token deltas, "updates" are state updates.
   * Namespace depth indicates nesting inside subagents.
   */
  renderChunk(chunk: unknown): void {
    for (const ev of parseChunk(chunk)) this.renderEvent(ev);
  }

  private renderUpdate(update: Record<string, Record<string, unknown>>, depth: number): void {
    for (const [key, nodeUpdate] of Object.entries(update ?? {})) {
      if (key === "__interrupt__") continue; // approval interrupts are handled by the caller
      if (nodeUpdate && typeof nodeUpdate === "object") {
        this.renderNodeUpdate(nodeUpdate as Record<string, unknown>, depth);
      }
    }
  }
}

export const c = ansi;
