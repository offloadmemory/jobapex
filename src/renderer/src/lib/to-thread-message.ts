import type { ThreadMessageLike } from "@assistant-ui/react";
import type { TranscriptEntry } from "./chat-store";

type ThreadContentPart = Exclude<ThreadMessageLike["content"], string>[number];

export function toThreadMessage(entry: TranscriptEntry): ThreadMessageLike {
  switch (entry.kind) {
    case "user":
      return { role: "user", content: [{ type: "text", text: entry.text }] };
    case "system":
      return { role: "system", content: [{ type: "text", text: entry.text }] };
    case "assistant": {
      const parts: ThreadContentPart[] = [];
      if (entry.thinking) parts.push({ type: "reasoning", text: entry.thinking });
      if (entry.text) parts.push({ type: "text", text: entry.text });
      return { role: "assistant", content: parts };
    }
    case "thinking":
      return { role: "assistant", content: [{ type: "reasoning", text: entry.text }] };
    case "tool":
      return { role: "assistant", content: [{ type: "text", text: `🔧 ${entry.text}` }] };
    case "toolResult":
      return { role: "assistant", content: [{ type: "text", text: `↳ ${entry.text}` }] };
    case "delegate":
      return { role: "assistant", content: [{ type: "text", text: `🤖 ${entry.text}` }] };
    case "error":
      return { role: "assistant", content: [{ type: "text", text: `⚠ ${entry.text}` }] };
  }
}