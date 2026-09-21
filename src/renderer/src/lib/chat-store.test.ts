import { describe, expect, it } from "vitest";
import { ChatStore, friendlyError } from "./chat-store";
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
        request: { actionRequests: [{ name: "execute", args: { command: "ls" }, allowedDecisions: ["approve", "reject"] }] },
      },
    ]);
    expect(s.status).toBe("approval");
    expect(s.approval?.runId).toBe("r1");
  });

  it("updates todos from a todos event", () => {
    const s = storeWith([{ type: "todos", depth: 0, todos: [{ content: "x", status: "pending" }] }]);
    expect(s.todos).toEqual([{ content: "x", status: "pending" }]);
  });

  it("ignores a subagent plan so it cannot overwrite the main todo panel", () => {
    const s = storeWith([
      { type: "todos", depth: 0, todos: [{ content: "main", status: "pending" }] },
      { type: "todos", depth: 1, todos: [{ content: "sub", status: "completed" }] },
    ]);
    expect(s.todos).toEqual([{ content: "main", status: "pending" }]);
  });

  it("emits a visible snapshot for a second approval after clearApproval", () => {
    const s = new ChatStore();
    s.consume({
      type: "approval",
      runId: "r1",
      request: { actionRequests: [{ name: "execute", args: { command: "ls" }, allowedDecisions: ["approve", "reject"] }] },
    });
    s.clearApproval();
    const before = s.getSnapshot();
    s.consume({
      type: "approval",
      runId: "r2",
      request: { actionRequests: [{ name: "execute", args: { command: "pwd" }, allowedDecisions: ["approve", "reject"] }] },
    });
    expect(s.approval?.runId).toBe("r2");
    expect(s.getSnapshot()).toBeGreaterThan(before);
  });

  it("reset clears all state back to an idle blank thread", () => {
    const s = storeWith([
      { type: "token", depth: 0, msg: { type: "ai", content: "hi", reasoning: "think" } },
      { type: "todos", depth: 0, todos: [{ content: "x", status: "pending" }] },
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

  it("clears a pending approval when a terminal done arrives while the gate is open", () => {
    // Realistic race: runAgentTask rejects while the interrupt promise is
    // pending, chat.ts's catch emits done, and the runtime tears down the
    // pending approval. The store must drop the dead card — otherwise the user
    // answers a dialog for a run that no longer exists and resolve()'s
    // setStatus("streaming") would strand the UI at "streaming" forever.
    const s = storeWith([
      { type: "done", cancelled: false },
      {
        type: "approval",
        runId: "r1",
        request: { actionRequests: [{ name: "execute", args: { command: "ls" }, allowedDecisions: ["approve", "reject"] }] },
      },
      { type: "done", cancelled: false },
    ]);
    expect(s.status).toBe("idle");
    expect(s.approval).toBeNull();
    // And a subsequent flow cannot resurrect the dead card's state: the
    // approval slot is genuinely empty, so a fresh gate is required to render.
    s.setStatus("streaming");
    expect(s.status).toBe("streaming");
    expect(s.approval).toBeNull();
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

  describe("done outcome entries", () => {
    // A done consumed from a fresh store hits the stale-done guard (idle,
    // nothing buffered), so seed a token to make the store "in a run".
    const inRun = (events: WireEvent[]): ChatStore =>
      storeWith([
        { type: "token", depth: 0, msg: { type: "ai", content: "hi", reasoning: "" } },
        ...events,
      ]);

    it("adds an error entry with the friendly message on a failed run", () => {
      const s = inRun([
        {
          type: "done",
          cancelled: false,
          error: "Error: connect ECONNREFUSED 127.0.0.1:11434",
        },
      ]);
      expect(s.status).toBe("idle");
      const err = s.entries.find((e) => e.kind === "error");
      expect(err).toBeDefined();
      expect(err?.text).toContain("is Ollama running?");
      expect(err?.text).toContain("connect ECONNREFUSED 127.0.0.1:11434");
    });

    it("maps a connection-refused error to the Ollama hint (friendlyError)", () => {
      expect(friendlyError("Error: connect ECONNREFUSED 127.0.0.1:11434")).toBe(
        "Can't reach the model server — is Ollama running? (Error: connect ECONNREFUSED 127.0.0.1:11434)"
      );
    });

    it("leaves a generic error string unchanged (friendlyError)", () => {
      expect(friendlyError("Error: model exploded on turn 2")).toBe(
        "Error: model exploded on turn 2"
      );
    });

    it("adds a system entry on a user-cancelled run (and sets idle)", () => {
      const s = inRun([{ type: "done", cancelled: true }]);
      expect(s.status).toBe("idle");
      expect(s.entries.at(-1)).toMatchObject({ kind: "system", text: "task cancelled" });
    });

    it("prefers the error entry when a done carries both error and cancelled", () => {
      // chat.ts's unexpected-failure catch emits done with cancelled:true AND
      // an error string; that is an abort mid-run, not a clean user cancel, so
      // it must surface as an error (a real user cancel carries no error).
      const s = inRun([{ type: "done", cancelled: true, error: "Error: boom" }]);
      expect(s.entries.at(-1)).toMatchObject({ kind: "error" });
    });

    it("adds a remembered-notes system entry after a successful run", () => {
      const s = inRun([{ type: "done", cancelled: false, rememberedNotes: 2 }]);
      expect(s.status).toBe("idle");
      expect(s.entries.at(-1)).toMatchObject({ kind: "system", text: "remembered 2 notes" });
    });

    it("does not add a memory note when no notes were remembered", () => {
      const s = inRun([
        { type: "done", cancelled: false, rememberedNotes: 0 },
      ]);
      expect(s.entries.some((e) => e.text.includes("remembered"))).toBe(false);
      // And a fully clean done (success, nothing remembered, no cancel/error)
      // still tears the run down.
      const s2 = inRun([{ type: "done", cancelled: false }]);
      expect(s2.status).toBe("idle");
      expect(s2.approval).toBeNull();
    });
  });
});