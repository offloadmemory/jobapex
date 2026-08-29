/**
 * UI-agnostic interpretation of streamed agent chunks. Both the readline
 * renderer and the future UI store consume this, so chunk-shape handling
 * lives in exactly one place. Knows nothing about the terminal.
 */

import type { HITLRequest } from "langchain";

export interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export function truncate(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * Subagent nesting level of a stream namespace. Model calls run in a
 * "model_request:<id>" sub-namespace even at the top level, so only
 * "tools:<id>" segments (the task tool running a nested agent) count.
 */
export function nestingDepth(namespace: string[]): number {
  return Math.min(namespace.filter((ns) => ns.startsWith("tools:")).length, 2);
}

export function contentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        typeof block === "string" ? block : (block as { text?: string }).text ?? ""
      )
      .join("");
  }
  return JSON.stringify(content);
}

export type StreamEvent =
  | { kind: "token"; msg: Record<string, any>; depth: number }
  | { kind: "update"; update: Record<string, Record<string, unknown>>; depth: number };

/**
 * Parse one streamed chunk (subgraphs: true) into events. Handles both
 * shapes: [namespace, update] and [namespace, mode, payload].
 */
export function parseChunk(chunk: unknown): StreamEvent[] {
  const parts = chunk as unknown[];
  if (parts.length === 3 && typeof parts[1] === "string") {
    const [namespace, mode, payload] = parts as [string[], string, unknown];
    const depth = nestingDepth(namespace);
    if (mode === "messages") {
      const [msg] = payload as [Record<string, any>, unknown];
      return [{ kind: "token", msg, depth }];
    } else if (mode === "updates") {
      return [{ kind: "update", update: payload as Record<string, Record<string, unknown>>, depth }];
    }
    return [];
  }
  const [namespace, update] = chunk as [string[], Record<string, Record<string, unknown>>];
  return [{ kind: "update", update, depth: nestingDepth(namespace) }];
}

/** Extract a pending human-in-the-loop interrupt from a stream chunk, if any. */
export function extractInterrupt(chunk: unknown): HITLRequest | null {
  // Chunks are [namespace, mode, payload] (multiple streamModes enabled).
  const [, mode, payload] = chunk as [string[], string, Record<string, unknown>];
  if (mode !== "updates") return null;
  const interrupts = payload?.["__interrupt__"] as Array<{ value?: HITLRequest }> | undefined;
  return interrupts?.[0]?.value ?? null;
}
