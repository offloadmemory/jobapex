import { describe, expect, it } from "vitest";
import { chatRunSchema, resolveApprovalSchema } from "@shared/schemas";

describe("chatRunSchema", () => {
  it("accepts a valid run request", () => {
    const r = chatRunSchema.safeParse({ prompt: "hi", threadId: "t1" });
    expect(r.success).toBe(true);
  });

  it("rejects an empty prompt", () => {
    const r = chatRunSchema.safeParse({ prompt: "", threadId: "t1" });
    expect(r.success).toBe(false);
  });
});

describe("resolveApprovalSchema", () => {
  it("accepts an approve decision", () => {
    const r = resolveApprovalSchema.safeParse({
      runId: "r1",
      decision: { decisions: [{ type: "approve" }] },
    });
    expect(r.success).toBe(true);
  });

  it("accepts an edit decision", () => {
    const r = resolveApprovalSchema.safeParse({
      runId: "r1",
      decision: {
        decisions: [
          { type: "edit", editedAction: { name: "execute", args: { command: "ls" } } },
        ],
      },
    });
    expect(r.success).toBe(true);
  });
});