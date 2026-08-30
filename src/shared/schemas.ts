import { z } from "zod";

export const chatRunSchema = z.object({
  prompt: z.string().min(1),
  threadId: z.string().min(1),
});

export const cancelSchema = z.object({
  threadId: z.string().min(1),
});

export const resolveApprovalSchema = z.object({
  runId: z.string().min(1),
  decision: z.object({
    decisions: z.array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("approve") }),
        z.object({ type: z.literal("reject"), message: z.string().optional() }),
        z.object({
          type: z.literal("edit"),
          editedAction: z.object({
            name: z.string(),
            args: z.record(z.string(), z.unknown()),
          }),
        }),
      ])
    ),
  }),
});