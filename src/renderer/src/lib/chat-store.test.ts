import { describe, expect, it } from "vitest";
import { ChatStore } from "./chat-store";
import type { WireEvent } from "@shared/wire";

function storeWith(events: WireEvent[]): ChatStore {
  const s = new ChatStore();
  for (const e of events) s.consume(e);
  return s;
}

describe("ChatStore", () => {
  it("accumulates streamed ai text into live", () => {
    const s = storeWith([
      { type: "token", depth: 0, msg: { type: "ai", content: "hel", reasoning: "" } },
      { type: "token", depth: 0, msg: { type: "ai", content: "lo", reasoning: "" } },
    ]);
    expect(s.live?.text).toBe("hello");
  });

  it("flushes live into an assistant entry on drain", () => {
    const s = storeWith([
      { type: "token", depth: 0, msg: { type: "ai", content: "hi", reasoning: "think" } },
      { type: "drain" },
    ]);
    expect(s.live).toBeNull();
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0]).toMatchObject({ kind: "assistant", text: "hi", thinking: "think" });
  });

  it("records tool calls and results", () => {
    const s = storeWith([
      {
        type: "update",
        depth: 0,
        msg: { type: "ai", content: "", toolCalls: [{ name: "write_file", args: { path: "/a" } }] },
      },
      { type: "update", depth: 0, msg: { type: "tool", content: "wrote /a", isError: false } },
    ]);
    expect(s.entries.map((e) => e.kind)).toEqual(["tool", "toolResult"]);
  });

  it("sets approval state on an approval event", () => {
    const s = storeWith([
      {
        type: "approval",
        runId: "r1",
        request: { actionRequests: [{ name: "execute", args: { command: "ls" } }] },
      },
    ]);
    expect(s.status).toBe("approval");
    expect(s.approval?.runId).toBe("r1");
  });

  it("updates todos from a todos event", () => {
    const s = storeWith([{ type: "todos", todos: [{ content: "x", status: "pending" }] }]);
    expect(s.todos).toEqual([{ content: "x", status: "pending" }]);
  });
});