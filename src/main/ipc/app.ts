import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { writeFile } from "node:fs/promises";
import {
  exportTranscriptSchema,
  logSchema,
  settingsSchema,
  setupSchema,
  unlockSchema,
} from "@shared/schemas";
import type { AppInfo, AppSettings, Result } from "@shared/wire";
import { attemptUnlock, isLocked, lock } from "../app/auth.js";
import { clearSecretsKey, installSecretsKey } from "../app/secrets.js";
import { readSettings, resetSetup, runSetup, writeSettings } from "../app/settings.js";
import { getAppInfo, rebuildAgent } from "../agent/runtime.js";
import { logsDir } from "../agent/paths.js";
import { logError, logInfo, logWarn } from "../app/logger.js";
import { broadcastLocked, refreshAppMenu } from "../menu.js";
import { failResult, okResult } from "./errors.js";

export function registerAppIpc(): void {
  ipcMain.handle("app:getInfo", async (): Promise<Result<AppInfo>> => {
    try {
      // The runtime knows the config; only these two need Electron to answer.
      return okResult({ ...getAppInfo(), logDir: logsDir(), version: app.getVersion() });
    } catch (err) {
      // Rejecting instead would leave the window without its Info line at all.
      return failResult(err, "INFO_FAILED");
    }
  });

  ipcMain.handle("app:getSettings", async (): Promise<Result<AppSettings>> => {
    try {
      return okResult(readSettings());
    } catch (err) {
      return failResult(err, "SETTINGS_FAILED");
    }
  });

  ipcMain.handle("app:saveSettings", async (_e, raw: unknown): Promise<Result<null>> => {
    const parsed = settingsSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    try {
      writeSettings(parsed.data);
      rebuildAgent(); // the default provider may have changed
      refreshAppMenu(); // the MENU's Lock item tracks whether a PIN is stored
      return okResult(null);
    } catch (err) {
      return failResult(err);
    }
  });

  ipcMain.handle("app:isLocked", async (): Promise<Result<boolean>> => {
    try {
      return okResult(isLocked());
    } catch (err) {
      // The boot sequence waits on this one; a rejection would strand it.
      return failResult(err, "LOCK_STATE_FAILED");
    }
  });

  ipcMain.handle("app:lock", async (): Promise<Result<null>> => {
    clearSecretsKey(); // the PIN-derived key is per session: never outlive the lock
    lock();
    logInfo("app", "locked by the renderer");
    // A reloaded or second window must gate too, and only main can tell it.
    broadcastLocked();
    return okResult(null);
  });

  ipcMain.handle("app:unlock", async (_e, raw: unknown): Promise<Result<null>> => {
    const parsed = unlockSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    const result = attemptUnlock(parsed.data.pin);
    if (!result.ok) {
      // The one auth failure worth a durable record: it explains a lockout later.
      logWarn("app.unlock", "PIN rejected", { retryInMs: result.retryInMs });
      return { ok: false, error: { code: "LOCKED", message: result.message } };
    }
    try {
      // Verifies the PIN against secrets.bin, then arms the agent with the keys
      // that were unreadable while locked (the boot build had none).
      installSecretsKey(parsed.data.pin);
      rebuildAgent();
      return okResult(null);
    } catch (err) {
      return failResult(err);
    }
  });

  ipcMain.handle("app:setup", async (_e, raw: unknown): Promise<Result<null>> => {
    const parsed = setupSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    try {
      runSetup(parsed.data);
      rebuildAgent();
      refreshAppMenu(); // the wizard may have stored a PIN
      return okResult(null);
    } catch (err) {
      return failResult(err, "SETUP_FAILED");
    }
  });

  ipcMain.handle("app:log", async (_e, raw: unknown): Promise<Result<null>> => {
    const parsed = logSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    const { level, message } = parsed.data;
    // Renderer failures never reach a terminal; they land next to the main ones.
    if (level === "error") logError("renderer", new Error(message));
    else if (level === "warn") logWarn("renderer", message);
    else logInfo("renderer", message);
    return okResult(null);
  });

  ipcMain.handle(
    "app:exportTranscript",
    async (event, raw: unknown): Promise<Result<{ path: string } | null>> => {
      const parsed = exportTranscriptSchema.safeParse(raw);
      if (!parsed.success) {
        return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
      }
      try {
        const win = BrowserWindow.fromWebContents(event.sender);
        const options = { defaultPath: parsed.data.suggestedName };
        // Attach the sheet to the asking window when it still exists.
        const chosen = win
          ? await dialog.showSaveDialog(win, options)
          : await dialog.showSaveDialog(options);
        if (chosen.canceled || !chosen.filePath) return okResult(null);
        await writeFile(chosen.filePath, parsed.data.content, "utf8");
        logInfo("app.exportTranscript", "transcript exported", { path: chosen.filePath });
        return okResult({ path: chosen.filePath });
      } catch (err) {
        return failResult(err, "EXPORT_FAILED");
      }
    }
  );

  ipcMain.handle("app:revealLog", async (): Promise<Result<null>> => {
    try {
      shell.showItemInFolder(logsDir());
      return okResult(null);
    } catch (err) {
      return failResult(err, "REVEAL_FAILED");
    }
  });

  ipcMain.handle("app:resetSetup", async (): Promise<Result<null>> => {
    try {
      // Providers, notes, skills, the PIN and the theme all survive the re-run.
      resetSetup();
      return okResult(null);
    } catch (err) {
      return failResult(err, "RESET_FAILED");
    }
  });
}
