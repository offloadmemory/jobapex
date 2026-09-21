import { ipcMain } from "electron";
import { threadHistorySchema, threadRenameSchema } from "@shared/schemas";
import type { Result, ThreadHistoryMessage, ThreadSummary } from "@shared/wire";
import { deleteThread, listThreads, renameThread, threadHistory } from "../app/threads.js";
import { failResult, okResult } from "./errors.js";

export function registerThreadsIpc(): void {
  ipcMain.handle("threads:list", async (): Promise<Result<ThreadSummary[]>> => {
    try {
      return okResult(await listThreads());
    } catch (err) {
      return failResult(err);
    }
  });

  ipcMain.handle(
    "threads:history",
    async (_e, raw: unknown): Promise<Result<ThreadHistoryMessage[]>> => {
      const parsed = threadHistorySchema.safeParse(raw);
      if (!parsed.success) {
        return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
      }
      try {
        return okResult(await threadHistory(parsed.data.threadId));
      } catch (err) {
        return failResult(err);
      }
    }
  );

  ipcMain.handle("threads:rename", async (_e, raw: unknown): Promise<Result<null>> => {
    const parsed = threadRenameSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    try {
      renameThread(parsed.data.threadId, parsed.data.title);
      return okResult(null);
    } catch (err) {
      return failResult(err);
    }
  });

  ipcMain.handle("threads:delete", async (_e, raw: unknown): Promise<Result<null>> => {
    // Delete only needs the thread id, so it reuses the history schema.
    const parsed = threadHistorySchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    try {
      await deleteThread(parsed.data.threadId);
      return okResult(null);
    } catch (err) {
      return failResult(err);
    }
  });
}
