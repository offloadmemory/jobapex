import { ipcMain } from "electron";
import { fileListSchema, fileReadSchema, fileStageSchema, fileWriteSchema } from "@shared/schemas";
import type { FileEntry, Result, StagedFile } from "@shared/wire";
import {
  WorkspacePathError,
  listFiles,
  readFile,
  revealPath,
  stageFile,
  writeFile,
} from "../app/files.js";
import { failResult } from "./errors.js";

/** Reveal takes the same workspace path as read, but omitting it means the root. */
const revealSchema = fileReadSchema.partial();

/** A rejected workspace path is caller input, so it reports as BAD_REQUEST. */
function failed(err: unknown): Result<never> {
  return failResult(err, err instanceof WorkspacePathError ? "BAD_REQUEST" : "FAILED");
}

export function registerFilesIpc(): void {
  ipcMain.handle("files:list", async (_e, raw: unknown): Promise<Result<FileEntry[]>> => {
    const parsed = fileListSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    try {
      return { ok: true, data: listFiles(parsed.data.dir) };
    } catch (err) {
      return failed(err);
    }
  });

  ipcMain.handle("files:read", async (_e, raw: unknown): Promise<Result<string>> => {
    const parsed = fileReadSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    try {
      return { ok: true, data: readFile(parsed.data.path) };
    } catch (err) {
      return failed(err);
    }
  });

  ipcMain.handle("files:write", async (_e, raw: unknown): Promise<Result<null>> => {
    const parsed = fileWriteSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    try {
      writeFile(parsed.data.path, parsed.data.content);
      return { ok: true, data: null };
    } catch (err) {
      return failed(err);
    }
  });

  ipcMain.handle("files:stage", async (_e, raw: unknown): Promise<Result<StagedFile>> => {
    const parsed = fileStageSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    try {
      return { ok: true, data: stageFile(parsed.data.name, parsed.data.data) };
    } catch (err) {
      return failed(err);
    }
  });

  ipcMain.handle("files:reveal", async (_e, raw: unknown): Promise<Result<null>> => {
    const parsed = revealSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    try {
      revealPath(parsed.data.path);
      return { ok: true, data: null };
    } catch (err) {
      return failed(err);
    }
  });
}
