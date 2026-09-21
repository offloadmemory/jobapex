import type { ThreadMessageLike } from "@assistant-ui/react";
import type { TranscriptEntry } from "./chat-store";

type ThreadContentPart = Exclude<ThreadMessageLike["content"], string>[number];

type DataPartName = "toolCall" | "toolResult" | "delegate" | "error" | "systemNote";

function dataPart(name: DataPartName, data: unknown): ThreadContentPart {
  return { type: "data", name, data };
}

interface ToolCallData {
  name: string;
  args: unknown;
}
interface ToolResultData {
  content: string;
  isError: boolean;
}

/** Depth carried by {@link toThreadMessage}; 0 for main-thread messages. */
export function messageDepth(message: {
  metadata?: { custom?: Record<string, unknown> } | undefined;
}): number {
  const depth = message.metadata?.custom?.["depth"];
  return typeof depth === "number" ? depth : 0;
}

/**
 * Map transcript entries to assistant-ui messages. Structured events
 * (tool calls, results, delegation, errors) become typed data parts so the
 * Thread can register purpose-built components for each instead of rendering
 * raw text lines.
 *
 * The entry's depth rides on `metadata.custom` — the one field assistant-ui
 * copies through `fromThreadMessageLike` untouched and still exposes on the
 * message state — so nested (subagent) output stays distinguishable from the
 * main thread's own messages once it reaches the Thread.
 */
export function toThreadMessage(entry: TranscriptEntry): ThreadMessageLike {
  const message = toBaseMessage(entry);
  return entry.depth > 0
    ? { ...message, metadata: { custom: { depth: entry.depth } } }
    : message;
}

function toBaseMessage(entry: TranscriptEntry): ThreadMessageLike {
  switch (entry.kind) {
    case "user":
      return { role: "user", content: [{ type: "text", text: entry.text }] };
    case "system":
      return {
        role: "assistant",
        content: [dataPart("systemNote", { text: entry.text })],
      };
    case "assistant": {
      const parts: ThreadContentPart[] = [];
      if (entry.thinking) parts.push({ type: "reasoning", text: entry.thinking });
      if (entry.text) parts.push({ type: "text", text: entry.text });
      if (parts.length === 0) parts.push({ type: "text", text: "" });
      return { role: "assistant", content: parts };
    }
    case "thinking":
      return { role: "assistant", content: [{ type: "reasoning", text: entry.text }] };
    case "tool": {
      const { name, args } = parseToolLine(entry.text);
      return { role: "assistant", content: [dataPart("toolCall", { name, args })] };
    }
    case "toolResult":
      return {
        role: "assistant",
        content: [dataPart("toolResult", { content: entry.text, isError: !!entry.isError } as ToolResultData)],
      };
    case "delegate":
      return { role: "assistant", content: [dataPart("delegate", { text: entry.text })] };
    case "error":
      return { role: "assistant", content: [dataPart("error", { text: entry.text })] };
  }
}

/**
 * ChatStore serializes tool calls as `"<name> <json>"`; split that apart so
 * the UI can render the name as a chip label and the args as formatted JSON.
 */
function parseToolLine(line: string): ToolCallData {
  const brace = line.indexOf("{");
  if (brace === -1) return { name: line, args: null };
  try {
    return { name: line.slice(0, brace).trim(), args: JSON.parse(line.slice(brace)) };
  } catch {
    return { name: line.slice(0, brace).trim(), args: line.slice(brace) };
  }
}