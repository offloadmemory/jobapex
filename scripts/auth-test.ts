/**
 * Live test of the Auth surface: the first-run setup wizard and the PIN lock —
 * the exact domain calls the app:setup / app:isLocked / app:lock / app:unlock
 * handlers wrap, including attempt backoff and the wizard's agent.md write.
 *
 * Run: npm run auth:test  (HOME is redirected there, see lib/isolated-home)
 * Ollama must be reachable at http://localhost:11434.
 */
import fs from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

import { requireIsolatedHome } from "./lib/isolated-home.js";
import { discoverModels } from "../src/main/agent/discovery/index.js";
import { agentMdPath, secretsPath } from "../src/main/agent/paths.js";
import {
  attemptUnlock,
  clearPin,
  hasPin,
  isLocked,
  lock,
  markUnlocked,
  pinRetryDelayMs,
  setPin,
} from "../src/main/app/auth.js";
import { getProviderInfo, resolveTarget } from "../src/main/app/providers.js";
import {
  clearSecretsKey,
  getSecret,
  hasSecret,
  installSecretsKey,
  setSecret,
} from "../src/main/app/secrets.js";
import { readSettings, runSetup } from "../src/main/app/settings.js";

const home = requireIsolatedHome();
const OLLAMA_URL = "http://localhost:11434";

// 1. A fresh profile has no PIN, so it opens straight into the wizard (no LockScreen).
if (hasPin()) throw new Error("FAIL: a fresh profile already has a PIN");
if (isLocked()) throw new Error("FAIL: a fresh profile must open unlocked");
if (readSettings().setupComplete) throw new Error("FAIL: a fresh profile must not be set up");
if (attemptUnlock("1234").ok) throw new Error("FAIL: a PIN was accepted with no PIN configured");
console.log("[gate] fresh profile: unlocked, no PIN, no setup");

// 2. Storing a PIN arms the gate; lock()/markUnlocked() are the sidebar button and a session unlock.
setPin("1234");
if (!hasPin()) throw new Error("FAIL: setPin did not persist a hash");
if (!isLocked()) throw new Error("FAIL: a session with a stored PIN must start locked");
markUnlocked();
if (isLocked()) throw new Error("FAIL: markUnlocked() did not clear the lock");
lock();
if (!isLocked()) throw new Error("FAIL: lock() did not lock the session");
console.log("[lock] stored PIN → locked at start; markUnlocked/lock round-trip");

// 3. Wrong PIN rejected; the third failure arms the backoff, which the correct PIN must wait out.
const wrong = attemptUnlock("0000");
if (wrong.ok) throw new Error("FAIL: a wrong PIN unlocked the app");
if (wrong.retryInMs !== 0) throw new Error("FAIL: the first wrong PIN must not be delayed");
if (!/Incorrect PIN/.test(wrong.message)) throw new Error(`FAIL: unexpected message: ${wrong.message}`);
console.log(`[pin] wrong PIN rejected: ${wrong.message}`);
attemptUnlock("0000");
const third = attemptUnlock("0000");
if (third.ok) throw new Error("FAIL: a wrong PIN unlocked the app");
if (third.retryInMs <= 0) throw new Error("FAIL: three failures did not arm the backoff");
const blocked = attemptUnlock("1234");
if (blocked.ok) throw new Error("FAIL: the correct PIN was accepted while the backoff was armed");
if (!/Try again in/.test(blocked.message)) throw new Error(`FAIL: unexpected backoff message: ${blocked.message}`);
console.log(`[backoff] armed after 3 failures: ${blocked.message}`);
await delay(third.retryInMs + 150);
const right = attemptUnlock("1234");
if (!right.ok) throw new Error(`FAIL: the correct PIN was rejected after the backoff: ${right.message}`);
if (isLocked()) throw new Error("FAIL: isLocked() stayed true after a successful unlock");
if (pinRetryDelayMs() !== 0) throw new Error("FAIL: a successful unlock did not reset the failure count");
console.log("[pin] backoff waited out; the correct PIN unlocked and cleared the failure count");

// 4. First-run wizard: assistant name + provider + PIN in one step.
const models = await discoverModels(resolveTarget({ type: "ollama", baseUrl: OLLAMA_URL }));
const first = models[0];
if (!first) throw new Error("FAIL: discovery returned no Ollama models");
const setup = runSetup({
  assistantName: "hermes-auth",
  provider: { name: "Wizard Ollama", type: "ollama", baseUrl: OLLAMA_URL, model: first.id },
  pin: "4321",
});
if (!setup.setupComplete) throw new Error("FAIL: runSetup did not mark setup complete");
if (!setup.pinConfigured) throw new Error("FAIL: runSetup did not store the PIN");
if (isLocked()) throw new Error("FAIL: runSetup must leave the session unlocked — setup just authenticated it");
const defaultId = setup.defaultProviderId;
if (!defaultId || !getProviderInfo(defaultId)?.isDefault) {
  throw new Error("FAIL: the wizard's provider is not the default");
}
const agentMd = fs.readFileSync(agentMdPath(), "utf8");
if (!agentMd.includes("hermes-auth")) throw new Error("FAIL: the wizard's name never reached agent.md");
console.log(`[setup] provider=${defaultId} name=hermes-auth pinConfigured=${setup.pinConfigured}`);

// 5. The wizard's PIN replaces the earlier one, and a relaunch locks again.
lock();
if (attemptUnlock("1234").ok) throw new Error("FAIL: the pre-wizard PIN still unlocks the app");
const afterWizard = attemptUnlock("4321");
if (!afterWizard.ok) throw new Error(`FAIL: the wizard's PIN was rejected: ${afterWizard.message}`);
console.log("[pin] wizard PIN replaced the old one and unlocked the fresh session");

// 6. API keys ride the PIN: the wizard's PIN installed a key, so a write lands
// in a v2 envelope (AES-256-GCM under scrypt(PIN)) with no plaintext on disk.
const apiKey = "sk-auth-test-3f7a91";
setSecret(defaultId, apiKey);
const onDisk = fs.readFileSync(secretsPath(), "utf8");
if (onDisk.includes(apiKey)) throw new Error("FAIL: the API key is stored in plaintext");
const envelope = JSON.parse(onDisk) as { v?: number };
if (envelope.v !== 2) throw new Error(`FAIL: expected a v2 envelope, got v=${String(envelope.v)}`);
if (!hasSecret(defaultId)) throw new Error("FAIL: hasSecret() does not see the key just stored");
console.log("[secrets] stored under a v2 (PIN-derived, AES-256-GCM) envelope, no plaintext on disk");

// 7. Locking drops the session key: the map is unreadable, writes are refused,
// and only the right PIN recovers it.
clearSecretsKey();
if (getSecret(defaultId) !== null) throw new Error("FAIL: the key was readable after a lock");
if (!hasSecret(defaultId)) throw new Error("FAIL: hasSecret() must still answer while locked");
let wrote = true;
try {
  setSecret("locked-write", "nope");
} catch {
  wrote = false;
}
if (wrote) throw new Error("FAIL: a write while locked was accepted");
let wrongPin = false;
try {
  installSecretsKey("1234");
} catch {
  wrongPin = true;
}
if (!wrongPin) throw new Error("FAIL: the pre-wizard PIN was accepted against the envelope");
if (getSecret(defaultId) !== null) throw new Error("FAIL: a rejected PIN armed a key");
installSecretsKey("4321");
if (getSecret(defaultId) !== apiKey) throw new Error("FAIL: the correct PIN did not recover the key");
console.log("[secrets] locked → unreadable and write-refused; the right PIN recovers the key");

// 8. Removing the PIN (the Security card's "Remove PIN") disarms the gate.
clearPin();
if (hasPin() || isLocked()) throw new Error("FAIL: clearPin() left the app locked");
if (attemptUnlock("4321").ok) throw new Error("FAIL: a PIN was accepted after the PIN was removed");
console.log("[gate] PIN removed → the app opens without one");

fs.rmSync(home, { recursive: true, force: true });
console.log("AUTH_TEST_DONE — wizard, PIN gate, backoff and unlock all verified.");
process.exit(0);
