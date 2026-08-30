import { ipcMain } from "electron";
import type { AppInfo, Result } from "@shared/wire";
import { getAppInfo } from "../agent/runtime.js";

export function registerAppIpc(): void {
  ipcMain.handle("app:getInfo", async (): Promise<Result<AppInfo>> => {
    return { ok: true, data: getAppInfo() };
  });
}