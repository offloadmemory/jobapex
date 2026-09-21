import { ipcMain } from "electron";
import { memorySearchSchema, memoryWriteSchema, noteSlugSchema } from "@shared/schemas";
import type { NoteInfo, Result } from "@shared/wire";
import {
  deleteNote,
  listNotes,
  readNote,
  searchNotes,
  toNoteInfos,
  writeNote,
} from "../agent/memory/store.js";
import { failResult } from "./errors.js";

export function registerMemoryIpc(): void {
  ipcMain.handle("memory:list", async (): Promise<Result<NoteInfo[]>> => {
    try {
      return { ok: true, data: toNoteInfos(listNotes()) };
    } catch (err) {
      return failResult(err);
    }
  });

  ipcMain.handle("memory:search", async (_e, raw: unknown): Promise<Result<NoteInfo[]>> => {
    const parsed = memorySearchSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    const query = parsed.data.query.trim();
    try {
      return { ok: true, data: toNoteInfos(query ? searchNotes(query) : listNotes()) };
    } catch (err) {
      return failResult(err);
    }
  });

  ipcMain.handle("memory:read", async (_e, raw: unknown): Promise<Result<string | null>> => {
    const parsed = noteSlugSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    try {
      return { ok: true, data: readNote(parsed.data.slug) };
    } catch (err) {
      return failResult(err);
    }
  });

  ipcMain.handle("memory:write", async (_e, raw: unknown): Promise<Result<null>> => {
    const parsed = memoryWriteSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    try {
      writeNote(parsed.data);
      return { ok: true, data: null };
    } catch (err) {
      return failResult(err);
    }
  });

  ipcMain.handle("memory:delete", async (_e, raw: unknown): Promise<Result<null>> => {
    const parsed = noteSlugSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    try {
      // Deleting an already-absent note still reaches the requested end state.
      deleteNote(parsed.data.slug);
      return { ok: true, data: null };
    } catch (err) {
      return failResult(err);
    }
  });
}
