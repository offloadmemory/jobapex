/**
 * Live test of the Settings surface: provider discovery/validation/save/default
 * selection, the assistant/idle-lock settings row, and PIN set/keep/remove through
 * saveSettings — the exact domain calls the app:* and providers:* IPC handlers wrap,
 * ending with the model the agent would actually build from the saved provider.
 * The gate itself (lock, wrong PIN, backoff, setup wizard) is scripts/auth-test.ts.
 *
 * Run: npm run settings:test  (HOME is redirected there, see lib/isolated-home)
 * Ollama must be reachable at http://localhost:11434.
 */
import fs from "node:fs";

import { requireIsolatedHome } from "./lib/isolated-home.js";
import { loadConfig } from "../src/main/agent/config.js";
import { discoverModels, validateProvider } from "../src/main/agent/discovery/index.js";
import { activeModelSpec } from "../src/main/agent/model-factory.js";
import { getDb } from "../src/main/app/db.js";
import {
  getProviderInfo,
  listProviders,
  resolveTarget,
  saveProvider,
} from "../src/main/app/providers.js";
import { readSettings, writeSettings } from "../src/main/app/settings.js";
import type { ProviderInput } from "../src/shared/wire.js";

const home = requireIsolatedHome();
const OLLAMA_URL = "http://localhost:11434";

/** Returns the thrown Error, or null when the call did not throw. */
function captureThrow(run: () => unknown): Error | null {
  try {
    run();
    return null;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

if (listProviders().length !== 0) {
  throw new Error("FAIL: the isolated app home already has providers — the temp HOME was not honoured");
}

// 1. Discovery + validation: the "Discover models" and "Test connection" buttons.
const target = resolveTarget({ type: "ollama", baseUrl: OLLAMA_URL });
const models = await discoverModels(target);
const first = models[0];
if (!first) throw new Error("FAIL: discovery returned no Ollama models");
await validateProvider(target, first.id);
console.log(`[discover] ${models.length} model(s), first=${first.id}; validate round-tripped`);

// 2. Save: the first provider becomes the default and carries no credential.
const saved = saveProvider({
  name: "Ollama (settings-test)",
  type: "ollama",
  baseUrl: OLLAMA_URL,
  model: first.id,
});
if (!saved.isDefault) throw new Error("FAIL: the first saved provider is not the default");
if (saved.credentialsConfigured) throw new Error("FAIL: an Ollama provider must report no stored key");
if (listProviders().length !== 1) throw new Error("FAIL: listProviders() does not show the saved row");
console.log(`[save] ${saved.name} — ${saved.type}/${saved.model}, isDefault=${saved.isDefault}`);

// 3. Settings row defaults, then the model the agent would build from it.
const initial = readSettings();
if (initial.defaultProviderId !== saved.id) throw new Error("FAIL: defaultProviderId does not point at the saved provider");
if (initial.setupComplete) throw new Error("FAIL: setupComplete must stay false before the wizard runs");
if (initial.pinConfigured) throw new Error("FAIL: a fresh install must report no PIN");
if (initial.idleLockMinutes !== 15) {
  throw new Error(`FAIL: the idle-lock default is ${initial.idleLockMinutes}, expected 15 minutes`);
}
console.log(
  `[settings] assistant=${initial.assistantName} idle=${initial.idleLockMinutes}m default=${initial.defaultProviderId}`
);

const spec = activeModelSpec(loadConfig([]));
if (spec.type !== "ollama" || spec.model !== first.id || spec.baseUrl !== OLLAMA_URL || spec.apiKey !== null) {
  throw new Error(`FAIL: activeModelSpec ignored the provider row: ${JSON.stringify(spec)}`);
}
console.log(`[model] agent would build ${spec.type}/${spec.model} at ${spec.baseUrl}`);

// 4. A second provider must not steal the default flag; setDefault moves it.
const second = saveProvider({ name: "Backup", type: "ollama", baseUrl: OLLAMA_URL, model: first.id });
if (second.isDefault) throw new Error("FAIL: the second provider stole the default flag on save");
if (!getProviderInfo(saved.id)?.isDefault) throw new Error("FAIL: the original default lost its flag");
console.log(`[save] second provider isDefault=${second.isDefault} (default unchanged)`);

// 5. Cloud providers cannot be saved without credentials (the wizard and the
//    Settings dialog both surface this message).
const cloud = captureThrow(() =>
  saveProvider({ name: "OpenAI", type: "openai", baseUrl: "https://api.openai.com", model: "gpt-4o-mini" })
);
if (!cloud) throw new Error("FAIL: saving an openai provider without a key was accepted");
if (!/API key/i.test(cloud.message)) throw new Error(`FAIL: unexpected rejection: ${cloud.message}`);
console.log(`[guard] keyless openai rejected: ${cloud.message}`);

const cloudWithKey: ProviderInput = {
  name: "OpenAI",
  type: "openai",
  baseUrl: "https://api.openai.com",
  model: "gpt-4o-mini",
  apiKey: "sk-test-not-a-real-key",
};
try {
  const keyed = saveProvider(cloudWithKey);
  if (!keyed.credentialsConfigured) throw new Error("FAIL: credentialsConfigured stayed false after a key was saved");
  console.log("[credentials] key stored through safeStorage; credentialsConfigured=true");
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  // safeStorage needs the Electron app runtime; under ELECTRON_RUN_AS_NODE it
  // refuses to encrypt, and the provider module must refuse to write plaintext.
  if (!/encryption/i.test(message)) throw new Error(`FAIL: unexpected error storing a key: ${message}`);
  console.log(`[credentials] safeStorage unavailable in this harness — key storage skipped (${message})`);
}

// 6. Settings writes: idle minutes, appearance, then the Security section's
//    set/keep/remove PIN.
const beforeSave = getProviderInfo(saved.id)?.updatedAt;
writeSettings({ assistantName: "hermes", idleLockMinutes: 0, defaultProviderId: saved.id, pin: "5678", theme: "dark", accent: "violet" });
if (readSettings().idleLockMinutes !== 0) throw new Error("FAIL: idleLockMinutes did not persist");
if (readSettings().theme !== "dark") throw new Error("FAIL: theme did not persist");
if (readSettings().accent !== "violet") throw new Error("FAIL: accent did not persist");
if (getProviderInfo(saved.id)?.updatedAt !== beforeSave) {
  throw new Error("FAIL: re-saving settings bumped the default provider's updatedAt");
}
if (!readSettings().pinConfigured) throw new Error("FAIL: setting a PIN through settings did not take");
writeSettings({ assistantName: "hermes", idleLockMinutes: 0, defaultProviderId: saved.id, theme: "dark", accent: "violet" });
if (!readSettings().pinConfigured) throw new Error("FAIL: saving other settings cleared the PIN");
if (readSettings().accent !== "violet") throw new Error("FAIL: re-saving settings dropped the accent");
writeSettings({ assistantName: "hermes", idleLockMinutes: 0, defaultProviderId: saved.id, pin: null, theme: "system", accent: "neutral" });
if (readSettings().pinConfigured) throw new Error("FAIL: removing the PIN through settings did not take");
if (readSettings().theme !== "system") throw new Error("FAIL: theme did not round-trip back to system");
if (readSettings().accent !== "neutral") throw new Error("FAIL: accent did not round-trip back to neutral");
console.log("[settings] idle=0 and theme persisted; PIN set, kept and removed through saveSettings");

// 7. A settings row hand-edited to nonsense must not fail the read: the accent
//    falls back to neutral, exactly like an unrecognised theme falls back to system.
getDb().prepare(`UPDATE settings SET value = 'chartreuse' WHERE key = 'accent'`).run();
if (readSettings().accent !== "neutral") {
  throw new Error(`FAIL: an unknown accent read back as ${readSettings().accent}, expected neutral`);
}
getDb().prepare(`UPDATE settings SET value = 'sepia' WHERE key = 'theme'`).run();
if (readSettings().theme !== "system") {
  throw new Error(`FAIL: an unknown theme read back as ${readSettings().theme}, expected system`);
}
console.log("[settings] unknown accent and theme rows both fell back to their defaults");

fs.rmSync(home, { recursive: true, force: true });
console.log("SETTINGS_TEST_DONE — providers, settings and the settings-side PIN writes verified.");
process.exit(0);
