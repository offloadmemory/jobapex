import { describe, expect, it } from "vitest";

import { ACCENT_COLORS } from "@shared/wire";
import {
  chatRunSchema,
  exportTranscriptSchema,
  fileListSchema,
  fileReadSchema,
  fileStageSchema,
  fileWriteSchema,
  logSchema,
  memoryWriteSchema,
  resolveApprovalSchema,
  settingsSchema,
  skillDeleteSchema,
  skillWriteSchema,
  threadRenameSchema,
} from "@shared/schemas";

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

describe("threadRenameSchema", () => {
  it("accepts a one-character title", () => {
    const r = threadRenameSchema.safeParse({ threadId: "t1", title: "x" });
    expect(r.success).toBe(true);
  });

  it("rejects a blank title", () => {
    const r = threadRenameSchema.safeParse({ threadId: "t1", title: "" });
    expect(r.success).toBe(false);
  });

  it("accepts 120 characters and rejects 121", () => {
    const at = threadRenameSchema.safeParse({ threadId: "t1", title: "a".repeat(120) });
    const over = threadRenameSchema.safeParse({ threadId: "t1", title: "a".repeat(121) });
    expect(at.success).toBe(true);
    expect(over.success).toBe(false);
  });

  it("rejects a missing threadId", () => {
    const r = threadRenameSchema.safeParse({ title: "renamed" });
    expect(r.success).toBe(false);
  });
});

describe("skillDeleteSchema", () => {
  it("accepts a user-owned and a project-owned skill", () => {
    expect(skillDeleteSchema.safeParse({ name: "demo-skill", source: "user" }).success).toBe(true);
    expect(skillDeleteSchema.safeParse({ name: "demo-skill", source: "project" }).success).toBe(true);
  });

  it("rejects a source that is neither user nor project", () => {
    const r = skillDeleteSchema.safeParse({ name: "demo-skill", source: "workspace" });
    expect(r.success).toBe(false);
  });

  it("rejects a name that is not a kebab-case slug", () => {
    const r = skillDeleteSchema.safeParse({ name: "Demo Skill", source: "user" });
    expect(r.success).toBe(false);
  });
});

describe("skillWriteSchema", () => {
  it("accepts a write with no previousName", () => {
    const r = skillWriteSchema.safeParse({ name: "demo-skill", description: "does a thing", content: "" });
    expect(r.success).toBe(true);
  });

  it("accepts a rename that carries the previousName", () => {
    const r = skillWriteSchema.safeParse({
      name: "demo-skill",
      description: "does a thing",
      content: "body",
      previousName: "old-skill",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a non-slug previousName", () => {
    const r = skillWriteSchema.safeParse({
      name: "demo-skill",
      description: "does a thing",
      content: "body",
      previousName: "Old Skill",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an empty description", () => {
    const r = skillWriteSchema.safeParse({ name: "demo-skill", description: "", content: "body" });
    expect(r.success).toBe(false);
  });
});

describe("memoryWriteSchema", () => {
  it("accepts a write with no previousSlug", () => {
    const r = memoryWriteSchema.safeParse({ slug: "qa-note", title: "QA note", content: "" });
    expect(r.success).toBe(true);
  });

  it("accepts a rename that carries the previousSlug", () => {
    const r = memoryWriteSchema.safeParse({
      slug: "qa-note",
      title: "QA note",
      content: "body",
      previousSlug: "old-note",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a non-slug previousSlug", () => {
    const r = memoryWriteSchema.safeParse({
      slug: "qa-note",
      title: "QA note",
      content: "body",
      previousSlug: "Old Note",
    });
    expect(r.success).toBe(false);
  });
});

describe("workspace file schemas", () => {
  // These schemas pin the *shape* of a wire path (present, bounded). Whether a
  // path is allowed to leave the workspace is decided by app/files.ts, and the
  // lexical/real-path refusals are covered in src/main/app/files.test.ts.
  it("fileListSchema accepts an omitted or relative dir and rejects an oversized one", () => {
    expect(fileListSchema.safeParse({}).success).toBe(true);
    expect(fileListSchema.safeParse({ dir: "notes/sub" }).success).toBe(true);
    expect(fileListSchema.safeParse({ dir: "a".repeat(1025) }).success).toBe(false);
  });

  it("fileReadSchema rejects an empty path and accepts a relative one", () => {
    expect(fileReadSchema.safeParse({ path: "notes/today.md" }).success).toBe(true);
    expect(fileReadSchema.safeParse({ path: "" }).success).toBe(false);
    expect(fileReadSchema.safeParse({ path: "a".repeat(1025) }).success).toBe(false);
  });

  it("fileWriteSchema rejects an empty path and accepts content at the size limit", () => {
    expect(fileWriteSchema.safeParse({ path: "notes/today.md", content: "hello" }).success).toBe(true);
    expect(fileWriteSchema.safeParse({ path: "", content: "hello" }).success).toBe(false);
    const atLimit = fileWriteSchema.safeParse({ path: "notes/big.md", content: "x".repeat(4_000_000) });
    expect(atLimit.success).toBe(true);
  });

  it("fileWriteSchema rejects content over 4 MB", () => {
    const r = fileWriteSchema.safeParse({ path: "notes/big.md", content: "x".repeat(4_000_001) });
    expect(r.success).toBe(false);
  });

  it("fileStageSchema accepts a Uint8Array at the 25 MiB cap", () => {
    const r = fileStageSchema.safeParse({
      name: "report.pdf",
      data: new Uint8Array(25 * 1024 * 1024),
    });
    expect(r.success).toBe(true);
  });

  it("fileStageSchema rejects data that is not a Uint8Array", () => {
    expect(fileStageSchema.safeParse({ name: "report.pdf", data: "not bytes" }).success).toBe(false);
    expect(fileStageSchema.safeParse({ name: "report.pdf", data: [1, 2, 3] }).success).toBe(false);
  });

  it("fileStageSchema rejects data over 25 MiB", () => {
    const r = fileStageSchema.safeParse({
      name: "report.pdf",
      data: new Uint8Array(25 * 1024 * 1024 + 1),
    });
    expect(r.success).toBe(false);
  });

  it("fileStageSchema rejects an empty or oversized name", () => {
    expect(fileStageSchema.safeParse({ name: "", data: new Uint8Array(1) }).success).toBe(false);
    expect(
      fileStageSchema.safeParse({ name: "a".repeat(256), data: new Uint8Array(1) }).success
    ).toBe(false);
  });
});

describe("logSchema", () => {
  it("accepts each of the three levels", () => {
    for (const level of ["info", "warn", "error"]) {
      expect(logSchema.safeParse({ level, message: "hello" }).success).toBe(true);
    }
  });

  it("rejects an unknown level", () => {
    const r = logSchema.safeParse({ level: "debug", message: "hello" });
    expect(r.success).toBe(false);
  });

  it("rejects an empty and an oversized message", () => {
    expect(logSchema.safeParse({ level: "info", message: "" }).success).toBe(false);
    expect(logSchema.safeParse({ level: "info", message: "x".repeat(8001) }).success).toBe(false);
  });
});

describe("exportTranscriptSchema", () => {
  it("accepts a suggested name and content", () => {
    const r = exportTranscriptSchema.safeParse({
      suggestedName: "jobapex-thread.md",
      content: "# Transcript\n",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an empty suggested name or empty content", () => {
    expect(exportTranscriptSchema.safeParse({ suggestedName: "", content: "x" }).success).toBe(false);
    expect(exportTranscriptSchema.safeParse({ suggestedName: "t.md", content: "" }).success).toBe(false);
  });

  it("rejects a suggested name over 200 characters", () => {
    const r = exportTranscriptSchema.safeParse({
      suggestedName: `${"a".repeat(201)}.md`,
      content: "# Transcript\n",
    });
    expect(r.success).toBe(false);
  });
});

describe("settingsSchema", () => {
  const valid = {
    assistantName: "hermes",
    idleLockMinutes: 15,
    defaultProviderId: null,
    theme: "dark",
    accent: "neutral",
  };

  it("accepts a full settings payload for each theme", () => {
    for (const theme of ["system", "light", "dark"]) {
      expect(settingsSchema.safeParse({ ...valid, theme }).success).toBe(true);
    }
  });

  it("accepts every accent color and rejects ones it does not know", () => {
    for (const accent of ACCENT_COLORS) {
      expect(settingsSchema.safeParse({ ...valid, accent }).success).toBe(true);
    }
    expect(settingsSchema.safeParse({ ...valid, accent: "chartreuse" }).success).toBe(false);
  });

  it("rejects a missing theme or accent", () => {
    const { theme, accent, ...withoutAppearance } = valid;
    expect(theme).toBe("dark");
    expect(accent).toBe("neutral");
    expect(settingsSchema.safeParse({ ...withoutAppearance, theme }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...valid, accent: undefined }).success).toBe(false);
  });

  it("rejects an unknown theme", () => {
    const r = settingsSchema.safeParse({ ...valid, theme: "midnight" });
    expect(r.success).toBe(false);
  });

  it("rejects an empty assistant name and an out-of-range idleLockMinutes", () => {
    expect(settingsSchema.safeParse({ ...valid, assistantName: "" }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...valid, idleLockMinutes: -1 }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...valid, idleLockMinutes: 1441 }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...valid, idleLockMinutes: 1.5 }).success).toBe(false);
  });

  it("accepts a PIN at the bounds and no PIN at all", () => {
    expect(settingsSchema.safeParse({ ...valid, pin: "1234" }).success).toBe(true);
    expect(settingsSchema.safeParse({ ...valid, pin: null }).success).toBe(true);
    expect(settingsSchema.safeParse({ ...valid, pin: "123" }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...valid, pin: "1".repeat(65) }).success).toBe(false);
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

  it("accepts a reject decision with a message", () => {
    const r = resolveApprovalSchema.safeParse({
      runId: "r1",
      decision: { decisions: [{ type: "reject", message: "not now" }] },
    });
    expect(r.success).toBe(true);
  });

  it("rejects an empty decisions list", () => {
    const r = resolveApprovalSchema.safeParse({ runId: "r1", decision: { decisions: [] } });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown decision type and a missing runId", () => {
    expect(
      resolveApprovalSchema.safeParse({ runId: "r1", decision: { decisions: [{ type: "skip" }] } })
        .success
    ).toBe(false);
    expect(resolveApprovalSchema.safeParse({ decision: { decisions: [{ type: "approve" }] } }).success).toBe(
      false
    );
  });
});
