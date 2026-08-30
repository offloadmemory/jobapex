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

  it("maps a tool entry to a typed toolCall data part", () => {
    const e: TranscriptEntry = { id: 3, kind: "tool", text: 'write_file {"path":"a.txt"}', depth: 0 };
    expect(toThreadMessage(e)).toEqual({
      role: "assistant",
      content: [{ type: "data", name: "toolCall", data: { name: "write_file", args: { path: "a.txt" } } }],
    });
  });

  it("maps an error entry to a typed error data part", () => {
    const e: TranscriptEntry = { id: 4, kind: "error", text: "boom", depth: 0 };
    expect(toThreadMessage(e)).toEqual({
      role: "assistant",
      content: [{ type: "data", name: "error", data: { text: "boom" } }],
    });
  });

  it("keeps an empty assistant entry renderable during streaming", () => {
    const e: TranscriptEntry = { id: 5, kind: "assistant", text: "", depth: 0 };
    expect(toThreadMessage(e)).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "" }],
    });
  });
});