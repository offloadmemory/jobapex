import { ipcMain, type WebContents } from "electron";
import { chatRunSchema, cancelSchema, resolveApprovalSchema } from "@shared/schemas";
import type { HITLRequestWire, Result, WireEvent } from "@shared/wire";
import {
  cancel,
  hasPendingApproval,
  isRunning,
  resolveApproval,
  runTask,
  runningThreadId,
} from "../agent/runtime.js";
import { isLocked } from "../app/auth.js";
import { logError } from "../app/logger.js";
import { failResult, okResult } from "./errors.js";

/** The window that started the in-flight run: its events go there, not to every window. */
let runOwner: WebContents | null = null;

/** Last gate each window was shown, so a reload can re-ask instead of losing it. */
const lastApprovals = new Map<number, { runId: string; request: HITLRequestWire }>();

function sendTo(win: WebContents, ev: WireEvent): void {
  // A window closed mid-run is still reachable until its "closed" flush;
  // sending to a destroyed webContents throws and would kill the run's loop.
  if (win.isDestroyed()) return;
  if (ev.type === "approval") lastApprovals.set(win.id, { runId: ev.runId, request: ev.request });
  win.send("chat:event", ev);
}

/**
 * Re-send the open gate after a reload: the runtime is still parked on it, but
 * the fresh renderer never saw the approval event that opened it.
 */
export function replayPendingApproval(win: WebContents): void {
  const entry = lastApprovals.get(win.id);
  if (!entry) return;
  if (!hasPendingApproval(entry.runId)) {
    lastApprovals.delete(win.id); // answered or cancelled while the window was gone
    return;
  }
  sendTo(win, { type: "approval", runId: entry.runId, request: entry.request });
}

/** A window that goes away must not leave its run parked on an unanswerable gate. */
export function cancelRunForWindow(win: WebContents): void {
  lastApprovals.delete(win.id);
  if (runOwner?.id === win.id) cancel();
}

export function registerChatIpc(): void {
  ipcMain.handle("chat:run", async (event, raw: unknown): Promise<Result<{ runId: string }>> => {
    const parsed = chatRunSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    if (isLocked()) {
      return {
        ok: false,
        error: { code: "LOCKED", message: "The app is locked. Enter your PIN to continue." },
      };
    }
    if (isRunning()) {
      // Naming the busy thread is what tells the user which view holds the run.
      const holder = runningThreadId();
      return {
        ok: false,
        error: {
          code: "BUSY",
          message: holder ? `Thread ${holder} is already running a task.` : "A task is already running.",
        },
      };
    }
    const { prompt, threadId } = parsed.data;
    const sender = event.sender;
    runOwner = sender;
    void runTask(prompt, threadId, (ev) => sendTo(sender, ev))
      .catch((err: unknown) => {
        // runTask normally emits its own terminal "done"; reaching this catch
        // means it failed before/unexpectedly, so emit one here or the UI
        // stays "running" forever.
        logError("chat.run", err);
        const e = err as { name?: string; message?: string } | undefined;
        const errString = `${e?.name ?? "Error"}: ${e?.message ?? String(err)}`;
        sendTo(sender, { type: "done", cancelled: true, error: errString });
      })
      .finally(() => {
        if (runOwner?.id === sender.id) runOwner = null;
      });
    return { ok: true, data: { runId: threadId } };
  });

  ipcMain.handle("chat:cancel", async (_e, raw: unknown): Promise<Result<null>> => {
    const parsed = cancelSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    cancel(parsed.data.threadId);
    return okResult(null);
  });

  ipcMain.handle("chat:resolveApproval", async (_e, raw: unknown): Promise<Result<null>> => {
    const parsed = resolveApprovalSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    const { runId, decision } = parsed.data;
    if (!resolveApproval(runId, decision)) {
      // The gate is gone: answered in another window, cancelled, or a stale id.
      return failResult(new Error("That approval is no longer active."), "NOT_FOUND");
    }
    for (const [id, entry] of lastApprovals) {
      if (entry.runId === runId) lastApprovals.delete(id);
    }
    return okResult(null);
  });
}
