import fs from "node:fs";
import type { AppSettings, SettingsInput, SetupInput } from "../../shared/wire.js";
import { isAccentColor } from "../../shared/wire.js";
import { renderDefaultAgentMd } from "../agent/identity.js";
import { AGENT_NAME, agentMdPath } from "../agent/paths.js";
import { clearPin, hasPin, markUnlocked, setPin } from "./auth.js";
import { getDb } from "./db.js";
import { installSecretsKey, releaseSecretsKey } from "./secrets.js";
import {
  getProviderInfo,
  resolveActiveProvider,
  saveProvider,
  setDefaultProvider,
} from "./providers.js";

const DEFAULT_IDLE_LOCK_MINUTES = 15;

function readMap(): Map<string, string> {
  const rows = getDb().prepare(`SELECT key, value FROM settings`).all() as unknown as Array<{
    key: string;
    value: string;
  }>;
  return new Map(rows.map((row) => [row.key, row.value]));
}

function writeSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
}

export function readSettings(): AppSettings {
  const stored = readMap();
  const minutes = Number(stored.get("idleLockMinutes"));
  // Anything unrecognised reads as "system": a corrupt row must not fail the read.
  const theme = stored.get("theme");
  const accent = stored.get("accent");
  return {
    assistantName: stored.get("assistantName") ?? AGENT_NAME,
    idleLockMinutes: Number.isFinite(minutes) ? minutes : DEFAULT_IDLE_LOCK_MINUTES,
    defaultProviderId: stored.get("defaultProviderId") ?? resolveActiveProvider()?.id ?? null,
    theme: theme === "light" || theme === "dark" ? theme : "system",
    accent: isAccentColor(accent) ? accent : "neutral",
    pinConfigured: hasPin(),
    setupComplete: stored.get("setupComplete") === "1",
  };
}

/** The assistant name is display metadata; the prompt-facing identity is agent.md. */
export function writeSettings(input: SettingsInput): AppSettings {
  writeSetting("assistantName", input.assistantName.trim());
  writeSetting("idleLockMinutes", String(input.idleLockMinutes));
  writeSetting("theme", input.theme);
  writeSetting("accent", input.accent);
  // secrets.bin follows the PIN: cleared → back under the OS keyring (before the
  // PIN is gone, so a failure leaves it readable), set → under the PIN-derived key.
  if (input.pin === null) {
    releaseSecretsKey();
    clearPin();
  } else if (typeof input.pin === "string") {
    setPin(input.pin);
    markUnlocked(); // setting a PIN must not lock the user out of the session they set it in
    installSecretsKey(input.pin);
  }
  if (input.defaultProviderId) {
    const target = getProviderInfo(input.defaultProviderId);
    if (!target) throw new Error(`No provider with id ${input.defaultProviderId}.`);
    // Re-flagging the current default would bump its updatedAt on every save.
    if (!target.isDefault) setDefaultProvider(target.id);
    writeSetting("defaultProviderId", target.id);
  } else {
    getDb().prepare(`DELETE FROM settings WHERE key = 'defaultProviderId'`).run();
  }
  return readSettings();
}

/** First-run wizard: provider + assistant name + optional PIN, in one transaction-like step. */
export function runSetup(input: SetupInput): AppSettings {
  const provider = saveProvider(input.provider);
  // Re-running setup must not drag the user back to the default appearance.
  const appearance = readSettings();
  writeSettings({
    assistantName: input.assistantName,
    idleLockMinutes: DEFAULT_IDLE_LOCK_MINUTES,
    defaultProviderId: provider.id,
    theme: appearance.theme,
    accent: appearance.accent,
  });
  // Rewriting agent.md here would discard a hand-edited identity, so only the
  // untouched default template is replaced with the chosen name.
  try {
    const current = fs.readFileSync(agentMdPath(), "utf8");
    if (current === renderDefaultAgentMd(AGENT_NAME)) {
      fs.writeFileSync(agentMdPath(), renderDefaultAgentMd(input.assistantName.trim()));
    }
  } catch {
    fs.writeFileSync(agentMdPath(), renderDefaultAgentMd(input.assistantName.trim()));
  }
  writeSetting("setupComplete", "1");
  if (input.pin) {
    setPin(input.pin);
    markUnlocked();
    installSecretsKey(input.pin); // migrates any v1 key just saved under the new PIN
  }
  return readSettings();
}

/**
 * Hand the app back to the first-run wizard: only the marker goes, so providers,
 * notes, skills, the PIN and the chosen theme all survive a re-run.
 */
export function resetSetup(): AppSettings {
  getDb().prepare(`DELETE FROM settings WHERE key = 'setupComplete'`).run();
  return readSettings();
}
