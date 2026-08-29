import { ipcMain, BrowserWindow } from "electron";
import { chatRunSchema, cancelSchema, resolveApprovalSchema } from "@shared/schemas";
import type { Result, WireEvent } from "@shared/wire";
import { runTask, resolveApproval, cancel, isRunning } from "../agent/runtime.js";

function sendToAll(ev: WireEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("chat:event", ev);
  }
}

export function registerChatIpc(): void {
  ipcMain.handle("chat:run", async (_e, raw: unknown): Promise<Result<{ runId: string }>> => {
    const parsed = chatRunSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    if (isRunning()) {
      return {
        ok: false,
        error: { code: "BUSY", message: "A task is already running." },
      };
    }
    const { prompt, threadId } = parsed.data;
    void runTask(prompt, threadId, sendToAll).catch(() => {});
    return { ok: true, data: { runId: threadId } };
  });

  ipcMain.handle("chat:cancel", async (_e, raw: unknown): Promise<Result<null>> => {
    const parsed = cancelSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    cancel();
    return { ok: true, data: null };
  });

  ipcMain.handle(
    "chat:resolveApproval",
    async (_e, raw: unknown): Promise<Result<null>> => {
      const parsed = resolveApprovalSchema.safeParse(raw);
      if (!parsed.success) {
        return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
      }
      resolveApproval(parsed.data.runId, parsed.data.decision);
      return { ok: true, data: null };
    }
  );
}