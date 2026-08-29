/**
 * Shared stream loop for running one user task to completion, pausing on
 * approval gates via an injected requestApproval callback so any UI
 * (readline or Ink modal) can satisfy the HITL gate. No presentation —
 * callers own all printing.
 */

import { Command } from "@langchain/langgraph";
import type { HITLRequest, HITLResponse } from "langchain";
import { extractInterrupt, parseChunk, type StreamEvent } from "./stream-events.js";

export interface TaskCallbacks {
  /** One parsed stream event (token or node update). */
  onEvent(ev: StreamEvent): void;
  /** The run paused on an approval gate — resolve with the user's decision. */
  requestApproval(request: HITLRequest): Promise<HITLResponse>;
  /** A stream pass fully drained — the UI should close any open line
   * before an approval prompt (or the next pass) writes to it. */
  onDrain?(): void;
}

export interface TaskResult {
  /** Final thread messages, or null when the run errored/was cancelled. */
  messages: any[] | null;
  error: Error | null;
  cancelled: boolean;
}

/** Stream one user task to completion (pausing on approval gates via
 * requestApproval). The agent is a deepagents DeepAgent; typed loosely
 * because createDeepAgent's return type isn't exported stably. */
export async function runAgentTask(
  agent: any,
  prompt: string,
  threadId: string,
  callbacks: TaskCallbacks,
  signal?: AbortSignal
): Promise<TaskResult> {
  let input: Record<string, unknown> | Command = {
    messages: [{ role: "user", content: prompt }],
  };
  try {
    // Loop: each pass streams until the run finishes or pauses on an
    // approval interrupt; approvals resume the same checkpointed run.
    for (;;) {
      const stream = await agent.stream(input as never, {
        configurable: { thread_id: threadId },
        streamMode: ["updates", "messages"],
        subgraphs: true,
        signal,
        recursionLimit: 250,
      });
      let pending: HITLRequest | null = null;
      for await (const chunk of stream) {
        const interrupt = extractInterrupt(chunk);
        if (interrupt) pending = interrupt;
        else for (const ev of parseChunk(chunk)) callbacks.onEvent(ev);
      }
      callbacks.onDrain?.();
      if (!pending) break;
      input = new Command({ resume: await callbacks.requestApproval(pending) });
    }
    const state = await (agent as any).getState({ configurable: { thread_id: threadId } });
    return { messages: (state.values?.messages as any[]) ?? null, error: null, cancelled: false };
  } catch (err: unknown) {
    const e = err as Error;
    if (e.name === "AbortError" || /abort/i.test(e.message ?? "")) {
      return { messages: null, error: null, cancelled: true };
    }
    return { messages: null, error: e, cancelled: false };
  }
}
