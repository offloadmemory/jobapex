import { ipcMain } from "electron";
import { providerIdSchema, providerSaveSchema, providerTargetSchema } from "@shared/schemas";
import type { ModelInfo, ProviderInfo, Result } from "@shared/wire";
import { discoverModels, validateProvider } from "../agent/discovery/index.js";
import { rebuildAgent } from "../agent/runtime.js";
import {
  clearProviderKey,
  deleteProvider,
  getProviderInfo,
  listProviders,
  resolveTarget,
  saveProvider,
  setDefaultProvider,
} from "../app/providers.js";
import { failResult, okResult } from "./errors.js";

export function registerProvidersIpc(): void {
  ipcMain.handle("providers:list", async (): Promise<Result<ProviderInfo[]>> => {
    try {
      return okResult(listProviders());
    } catch (err) {
      return failResult(err);
    }
  });

  ipcMain.handle("providers:save", async (_e, raw: unknown): Promise<Result<ProviderInfo>> => {
    const parsed = providerSaveSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    try {
      const saved = saveProvider(parsed.data);
      rebuildAgent(); // the next run uses the provider just saved
      return okResult(saved);
    } catch (err) {
      return failResult(err, "INVALID_PROVIDER");
    }
  });

  ipcMain.handle("providers:discover", async (_e, raw: unknown): Promise<Result<ModelInfo[]>> => {
    const parsed = providerTargetSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    try {
      return okResult(await discoverModels(resolveTarget(parsed.data)));
    } catch (err) {
      return failResult(err, "DISCOVERY_FAILED");
    }
  });

  ipcMain.handle("providers:validate", async (_e, raw: unknown): Promise<Result<null>> => {
    const parsed = providerTargetSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    const { id, model } = parsed.data;
    // Editing an existing provider without retyping the model still validates it.
    const effectiveModel = model?.trim() || (id ? (getProviderInfo(id)?.model ?? "") : "");
    try {
      await validateProvider(resolveTarget(parsed.data), effectiveModel);
      return okResult(null);
    } catch (err) {
      return failResult(err, "VALIDATION_FAILED");
    }
  });

  ipcMain.handle("providers:setDefault", async (_e, raw: unknown): Promise<Result<null>> => {
    const parsed = providerIdSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    try {
      setDefaultProvider(parsed.data.id);
      rebuildAgent();
      return okResult(null);
    } catch (err) {
      return failResult(err);
    }
  });

  ipcMain.handle("providers:delete", async (_e, raw: unknown): Promise<Result<null>> => {
    const parsed = providerIdSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    try {
      deleteProvider(parsed.data.id);
      rebuildAgent(); // the default may have moved to another row
      return okResult(null);
    } catch (err) {
      return failResult(err, "DELETE_FAILED");
    }
  });

  ipcMain.handle("providers:clearKey", async (_e, raw: unknown): Promise<Result<null>> => {
    const parsed = providerIdSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    try {
      clearProviderKey(parsed.data.id);
      rebuildAgent(); // drop the key the running model was built with
      return okResult(null);
    } catch (err) {
      return failResult(err, "CLEAR_KEY_FAILED");
    }
  });
}
