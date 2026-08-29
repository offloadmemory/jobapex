import { describe, expect, it } from "vitest";
import { toWireEvents } from "./runtime.js";
import type { StreamEvent } from "./stream-events.js";

describe("toWireEvents", () => {
  it("converts an ai token event", () => {
    const ev: StreamEvent = {
      kind: "token",
      depth: 0,
      msg: {
        getType: () => "ai",
        content: "hello",
        additional_kwargs: { reasoning_content: "thinking..." },
      } as any,
    };
    const out = toWireEvents(ev);
    expect(out).toEqual([
      { type: "token", depth: 0, msg: { type: "ai", content: "hello", reasoning: "thinking..." } },
    ]);
  });

  it("converts an ai update with tool calls", () => {
    const ev: StreamEvent = {
      kind: "update",
      depth: 0,
      update: {
        model: {
          messages: [
            {
              getType: () => "ai",
              content: "",
              tool_calls: [{ name: "write_file", args: { path: "/a.txt" } }],
            },
          ],
        },
      },
    };
    const out = toWireEvents(ev);
    expect(out).toEqual([
      {
        type: "update",
        depth: 0,
        msg: {
          type: "ai",
          content: "",
          toolCalls: [{ name: "write_file", args: { path: "/a.txt" } }],
        },
      },
    ]);
  });

  it("emits a todos event from a node update", () => {
    const ev: StreamEvent = {
      kind: "update",
      depth: 0,
      update: {
        model: { todos: [{ content: "do it", status: "in_progress" }] },
      },
    };
    const out = toWireEvents(ev);
    expect(out).toEqual([
      { type: "todos", todos: [{ content: "do it", status: "in_progress" }] },
    ]);
  });

  it("skips __interrupt__ keys", () => {
    const ev: StreamEvent = {
      kind: "update",
      depth: 0,
      update: { __interrupt__: [{ value: {} }] } as any,
    };
    expect(toWireEvents(ev)).toEqual([]);
  });
});