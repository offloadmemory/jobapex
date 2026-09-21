import { z } from "zod";

import { ACCENT_COLORS } from "./wire.js";

export const chatRunSchema = z.object({
  prompt: z.string().min(1),
  threadId: z.string().min(1),
});

export const cancelSchema = z.object({
  threadId: z.string().min(1),
});

/** Skills use kebab-case names; memory notes use the same slug shape (see slugify). */
const slugSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must be kebab-case");

const providerInputSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  type: z.enum(["ollama", "openai", "anthropic"]),
  baseUrl: z.string().optional(),
  // Optional here: discover/validate run before the user picks a model. The
  // save handler requires it.
  model: z.string().optional(),
  // Blank/absent on update means "keep the stored key".
  apiKey: z.string().optional(),
});

const pinSchema = z.string().min(4).max(64);

export const threadHistorySchema = z.object({
  threadId: z.string().min(1),
});

export const threadRenameSchema = z.object({
  threadId: z.string().min(1),
  title: z.string().min(1).max(120),
});

export const skillReadSchema = z.object({
  name: slugSchema,
});

export const skillWriteSchema = z.object({
  name: slugSchema,
  description: z.string().min(1),
  content: z.string(),
  previousName: slugSchema.optional(),
});

/** Skills may be user-owned or project-owned; delete has to name which one. */
export const skillDeleteSchema = z.object({
  name: slugSchema,
  source: z.enum(["user", "project"]),
});

export const memorySearchSchema = z.object({
  query: z.string(),
});

/** Reads and deletes both address a single note by slug. */
export const noteSlugSchema = z.object({
  slug: slugSchema,
});

export const memoryWriteSchema = z.object({
  slug: slugSchema,
  title: z.string().min(1),
  content: z.string(),
  previousSlug: slugSchema.optional(),
});

export const providerSaveSchema = providerInputSchema;

/** Discover/validate run before the user has committed a name or model. */
export const providerTargetSchema = providerInputSchema.partial({ name: true });

export const providerIdSchema = z.object({
  id: z.string().min(1),
});

export const unlockSchema = z.object({
  pin: pinSchema,
});

export const settingsSchema = z.object({
  assistantName: z.string().min(1),
  idleLockMinutes: z.number().int().min(0).max(1440),
  defaultProviderId: z.string().min(1).nullable(),
  theme: z.enum(["system", "light", "dark"]),
  accent: z.enum(ACCENT_COLORS),
  pin: pinSchema.nullable().optional(),
});

export const setupSchema = z.object({
  assistantName: z.string().min(1),
  provider: providerInputSchema,
  pin: pinSchema.optional(),
});

/** Workspace paths are relative and may not climb out of the root (see app/files.ts). */
const workspacePathSchema = z.string().min(1).max(1024);

export const fileListSchema = z.object({
  dir: z.string().max(1024).optional(),
});

export const fileReadSchema = z.object({
  path: workspacePathSchema,
});

export const fileWriteSchema = z.object({
  path: workspacePathSchema,
  content: z.string().max(4_000_000),
});

export const fileStageSchema = z.object({
  name: z.string().min(1).max(255),
  /** Structured-cloned from the renderer; capped at 25 MiB. */
  data: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength <= 25 * 1024 * 1024, {
    message: "attachment is larger than 25 MiB",
  }),
});

export const logSchema = z.object({
  level: z.enum(["info", "warn", "error"]),
  message: z.string().min(1).max(8000),
});

export const exportTranscriptSchema = z.object({
  suggestedName: z.string().min(1).max(200),
  content: z.string().min(1).max(20_000_000),
});

export const resolveApprovalSchema = z.object({
  runId: z.string().min(1),
  decision: z.object({
    /** One decision per action request; an empty list would resume nothing. */
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
    ).min(1),
  }),
});