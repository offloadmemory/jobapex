import { randomUUID } from "node:crypto";
import type { ProviderInfo, ProviderInput, ProviderType } from "../../shared/wire.js";
import { getDb } from "./db.js";
import { clearSecret, getSecret, hasSecret, setSecret } from "./secrets.js";

/** Shown as the base URL placeholder and used when a provider has none stored. */
export const DEFAULT_BASE_URL: Record<ProviderType, string> = {
  ollama: "http://localhost:11434",
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
};

export interface ResolvedProvider {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  model: string;
  /** Decrypted in the main process only; null when no key is stored. */
  apiKey: string | null;
}

interface ProviderRow {
  id: string;
  name: string;
  type: string;
  baseUrl: string | null;
  model: string;
  isDefault: number;
  createdAt: number;
  updatedAt: number;
}

function rowById(id: string): ProviderRow | null {
  const row = getDb().prepare(`SELECT * FROM providers WHERE id = ?`).get(id) as
    | ProviderRow
    | undefined;
  return row ?? null;
}

function toInfo(row: ProviderRow): ProviderInfo {
  const type = row.type as ProviderType;
  return {
    id: row.id,
    name: row.name,
    type,
    baseUrl: row.baseUrl ?? DEFAULT_BASE_URL[type],
    model: row.model,
    isDefault: row.isDefault === 1,
    credentialsConfigured: hasSecret(row.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listProviders(): ProviderInfo[] {
  const rows = getDb()
    .prepare(`SELECT * FROM providers ORDER BY isDefault DESC, createdAt ASC`)
    .all() as unknown as ProviderRow[];
  return rows.map(toInfo);
}

export function getProviderInfo(id: string): ProviderInfo | null {
  const row = rowById(id);
  return row ? toInfo(row) : null;
}

/** Rejects a syntactically invalid URL up front; the trailing slash is noise downstream. */
function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`"${value}" is not a valid URL — include the scheme, e.g. http://localhost:11434`);
  }
  return url.toString().replace(/\/$/, "");
}

/**
 * Base URL + key for discovery/validation. The typed values win, then the stored
 * row, then the type's default — so the user can test edits before saving and
 * can validate an existing provider without re-entering its key.
 */
export interface TargetInput {
  /** Present when testing edits to an existing provider. */
  id?: string;
  type: ProviderType;
  baseUrl?: string;
  apiKey?: string;
}

export function resolveTarget(input: TargetInput): {
  type: ProviderType;
  baseUrl: string;
  apiKey: string | null;
} {
  const stored = input.id ? rowById(input.id) : null;
  const type = input.type;
  return {
    type,
    baseUrl: normalizeBaseUrl(input.baseUrl?.trim() || stored?.baseUrl || DEFAULT_BASE_URL[type]),
    apiKey: input.apiKey?.trim() || (input.id ? getSecret(input.id) : null),
  };
}

/** Create or update a provider. The first provider saved becomes the default. */
export function saveProvider(input: ProviderInput): ProviderInfo {
  const model = input.model?.trim();
  if (!model) throw new Error("A model is required — pick one from the provider's model list.");
  const baseUrl = normalizeBaseUrl(input.baseUrl?.trim() || DEFAULT_BASE_URL[input.type]);
  const id = input.id ?? randomUUID();
  const now = Date.now();
  const existing = rowById(id);
  const count = getDb().prepare(`SELECT COUNT(*) AS n FROM providers`).get() as { n: number };
  const isDefault = existing ? existing.isDefault : count.n === 0 ? 1 : 0;

  getDb()
    .prepare(
      `INSERT INTO providers (id, name, type, baseUrl, model, isDefault, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         type = excluded.type,
         baseUrl = excluded.baseUrl,
         model = excluded.model,
         updatedAt = excluded.updatedAt`
    )
    .run(id, input.name.trim(), input.type, baseUrl, model, isDefault, existing?.createdAt ?? now, now);

  const apiKey = input.apiKey?.trim();
  if (input.type !== "ollama" && !apiKey && !hasSecret(id)) {
    throw new Error(`Add an API key — the ${input.type} provider cannot run without one.`);
  }
  if (apiKey) setSecret(id, apiKey); // blank on update keeps the stored key

  const saved = rowById(id);
  if (!saved) throw new Error("Provider save failed.");
  return toInfo(saved);
}

/**
 * The default pointer lives in the settings table, which settings.ts owns. This
 * module cannot call back into it — settings.ts already imports this one — so
 * the one row it needs to maintain is written here.
 */
function writeDefaultProviderSetting(id: string | null): void {
  const db = getDb();
  if (id === null) {
    db.prepare(`DELETE FROM settings WHERE key = 'defaultProviderId'`).run();
    return;
  }
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('defaultProviderId', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(id);
}

export function setDefaultProvider(id: string): ProviderInfo {
  if (!rowById(id)) throw new Error(`No provider with id ${id}.`);
  const db = getDb();
  db.prepare(`UPDATE providers SET isDefault = 0`).run();
  db.prepare(`UPDATE providers SET isDefault = 1, updatedAt = ? WHERE id = ?`).run(Date.now(), id);
  const row = rowById(id);
  if (!row) throw new Error(`No provider with id ${id}.`);
  return toInfo(row);
}

/**
 * Remove a provider: its stored key, its row, and — when it was the default —
 * the default it was holding, which moves to the oldest remaining row.
 */
export function deleteProvider(id: string): void {
  const row = rowById(id);
  if (!row) throw new Error(`No provider with id ${id}.`);
  // Before the row: a locked secret store refuses the write, and a row without
  // its key can be fixed by re-entering one, while a key without its row never can.
  clearSecret(id);
  const db = getDb();
  db.prepare(`DELETE FROM providers WHERE id = ?`).run(id);

  const stored = db
    .prepare(`SELECT value FROM settings WHERE key = 'defaultProviderId'`)
    .get() as { value: string } | undefined;
  // The flag and the setting can disagree (setDefaultProvider moves the flag
  // alone), so the default is repaired when either one names the removed row.
  if (row.isDefault !== 1 && stored?.value !== id) return;

  const oldest = db
    .prepare(`SELECT id FROM providers ORDER BY createdAt ASC LIMIT 1`)
    .get() as { id: string } | undefined;
  if (!oldest) {
    writeDefaultProviderSetting(null); // no rows left: nothing can be the default
    return;
  }
  // Clear first: the promotion has to leave exactly one default even if the table
  // arrived here with two flagged (setDefaultProvider is what normally holds that).
  db.prepare(`UPDATE providers SET isDefault = 0`).run();
  db.prepare(`UPDATE providers SET isDefault = 1, updatedAt = ? WHERE id = ?`).run(
    Date.now(),
    oldest.id
  );
  writeDefaultProviderSetting(oldest.id);
}

/** Drop the stored key but keep the row, which then needs a new one to run. */
export function clearProviderKey(id: string): void {
  if (!rowById(id)) throw new Error(`No provider with id ${id}.`);
  clearSecret(id);
  getDb().prepare(`UPDATE providers SET updatedAt = ? WHERE id = ?`).run(Date.now(), id);
}

/** The default row (or the oldest provider when none is flagged), else null. */
export function resolveActiveProvider(): ResolvedProvider | null {
  const row = getDb()
    .prepare(`SELECT * FROM providers ORDER BY isDefault DESC, createdAt ASC LIMIT 1`)
    .get() as ProviderRow | undefined;
  if (!row) return null;
  const type = row.type as ProviderType;
  return {
    id: row.id,
    name: row.name,
    type,
    baseUrl: row.baseUrl ?? DEFAULT_BASE_URL[type],
    model: row.model,
    apiKey: getSecret(row.id),
  };
}
