import { ipcMain } from "electron";
import { skillDeleteSchema, skillReadSchema, skillWriteSchema } from "@shared/schemas";
import type { Result, SkillInfo } from "@shared/wire";
import { deleteSkillFile, listSkills, readSkill, writeSkillFile } from "../agent/skills/file.js";
import { failResult } from "./errors.js";

export function registerSkillsIpc(): void {
  ipcMain.handle("skills:list", async (): Promise<Result<SkillInfo[]>> => {
    try {
      return { ok: true, data: listSkills() };
    } catch (err) {
      return failResult(err);
    }
  });

  ipcMain.handle("skills:read", async (_e, raw: unknown): Promise<Result<string | null>> => {
    const parsed = skillReadSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    try {
      return { ok: true, data: readSkill(parsed.data.name) };
    } catch (err) {
      return failResult(err);
    }
  });

  ipcMain.handle("skills:write", async (_e, raw: unknown): Promise<Result<null>> => {
    const parsed = skillWriteSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    try {
      writeSkillFile(parsed.data);
      return { ok: true, data: null };
    } catch (err) {
      return failResult(err);
    }
  });

  ipcMain.handle("skills:delete", async (_e, raw: unknown): Promise<Result<null>> => {
    const parsed = skillDeleteSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    try {
      deleteSkillFile(parsed.data.name, parsed.data.source);
      return { ok: true, data: null };
    } catch (err) {
      return failResult(err);
    }
  });
}
