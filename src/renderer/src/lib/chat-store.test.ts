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

  it("emits a visible snapshot for a second approval after clearApproval", () => {
    const s = new ChatStore();
    s.consume({
      type: "approval",
      runId: "r1",
      request: { actionRequests: [{ name: "execute", args: { command: "ls" } }] },
    });
    s.clearApproval();
    const before = s.getSnapshot();
    s.consume({
      type: "approval",
      runId: "r2",
      request: { actionRequests: [{ name: "execute", args: { command: "pwd" } }] },
    });
    expect(s.approval?.runId).toBe("r2");
    expect(s.getSnapshot()).toBeGreaterThan(before);
  });

  it("reset clears all state back to an idle blank thread", () => {
    const s = storeWith([
      { type: "token", depth: 0, msg: { type: "ai", content: "hi", reasoning: "think" } },
      { type: "todos", todos: [{ content: "x", status: "pending" }] },
      { type: "approval", runId: "r1", request: { actionRequests: [] } },
    ]);
    s.addEntry("user", "hello");

    s.reset();

    expect(s.entries).toEqual([]);
    expect(s.todos).toEqual([]);
    expect(s.live).toBeNull();
    expect(s.approval).toBeNull();
    expect(s.status).toBe("idle");
  });

  it("reset bumps the snapshot and notifies subscribers", () => {
    const s = storeWith([{ type: "token", depth: 0, msg: { type: "ai", content: "hi", reasoning: "" } }]);
    const before = s.getSnapshot();
    let calls = 0;
    const unsubscribe = s.subscribe(() => {
      calls += 1;
    });

    s.reset();

    expect(s.getSnapshot()).toBeGreaterThan(before);
    expect(calls).toBe(1);
    unsubscribe();
  });

  it("ignores a stale done event when already idle with nothing pending", () => {
    const s = new ChatStore();
    const before = s.getSnapshot();

    s.consume({ type: "done", cancelled: true });

    expect(s.getSnapshot()).toBe(before);
    expect(s.status).toBe("idle");
    expect(s.entries).toEqual([]);
  });

  it("flushes the previous depth live when a token arrives at a new depth", () => {
    const s = storeWith([
      { type: "token", depth: 0, msg: { type: "ai", content: "main", reasoning: "" } },
      { type: "token", depth: 1, msg: { type: "ai", content: "sub", reasoning: "" } },
    ]);
    expect(s.live?.text).toBe("sub");
    expect(s.live?.depth).toBe(1);
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0]).toMatchObject({ kind: "assistant", text: "main" });
  });
});