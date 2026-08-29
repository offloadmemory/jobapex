import { describe, expect, it } from "vitest";
import { toThreadMessage } from "./to-thread-message";
import type { TranscriptEntry } from "./chat-store";

describe("toThreadMessage", () => {
  it("maps a user entry to a user message", () => {
    const e: TranscriptEntry = { id: 1, kind: "user", text: "hi", depth: 0 };
    expect(toThreadMessage(e)).toEqual({ role: "user", content: [{ type: "text", text: "hi" }] });
  });

  it("maps an assistant entry with thinking to reasoning + text parts", () => {
    const e: TranscriptEntry = { id: 2, kind: "assistant", text: "answer", thinking: "reason", depth: 0 };
    expect(toThreadMessage(e)).toEqual({
      role: "assistant",
      content: [
        { type: "reasoning", text: "reason" },
        { type: "text", text: "answer" },
      ],
    });
  });

  it("maps a tool entry to a prefixed text part", () => {
    const e: TranscriptEntry = { id: 3, kind: "tool", text: "write_file {}", depth: 0 };
    expect(toThreadMessage(e)).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "🔧 write_file {}" }],
    });
  });
});