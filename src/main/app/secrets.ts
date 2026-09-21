import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";

import { secretsPath } from "../agent/paths.js";
import { hasPin } from "./auth.js";

const require = createRequire(import.meta.url);

/** provider id → API key. */
type SecretMap = Record<string, string>;

/** v1 (legacy): provider id → base64 Electron safeStorage ciphertext (OS-keyed). */
type EnvelopeV1 = Record<string, string>;

/**
 * v2: the whole map under one AES-256-GCM key derived from the PIN with scrypt.
 * `ids` carries the provider ids so `hasSecret` can still answer while locked —
 * ids are configuration, not secrets.
 */
interface EnvelopeV2 {
  v: 2;
  kdf: "scrypt";
  salt: string;
  iv: string;
  tag: string;
  data: string;
  ids: string[];
}

const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;

const LOCKED_MESSAGE =
  "API keys are locked: the PIN-derived key is only available in an unlocked session.";

/** The slice of Electron's safeStorage this module uses. */
interface SafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

function isSafeStorage(value: unknown): value is SafeStorage {
  return (
    typeof value === "object" &&
    value !== null &&
    "isEncryptionAvailable" in value &&
    typeof value.isEncryptionAvailable === "function" &&
    "encryptString" in value &&
    typeof value.encryptString === "function" &&
    "decryptString" in value &&
    typeof value.decryptString === "function"
  );
}

/**
 * Loaded through require at first use, not a static import: under
 * ELECTRON_RUN_AS_NODE (live scripts, vitest) "electron" resolves to the npm
 * package that exports only the binary path, and a named static import of
 * safeStorage throws before this module can even run.
 */
let loaded: unknown;

function safeStorage(): SafeStorage | null {
  if (loaded === undefined) {
    const electron: unknown = require("electron");
    loaded =
      typeof electron === "object" && electron !== null && "safeStorage" in electron
        ? electron.safeStorage
        : null;
  }
  const api = loaded;
  return isSafeStorage(api) ? api : null;
}

/**
 * Session key derived from the PIN. Set by installSecretsKey() on unlock or on
 * a PIN write, dropped by clearSecretsKey()/releaseSecretsKey(). Never persisted:
 * a relaunch with a PIN configured starts without it, i.e. locked.
 */
let keyring: { key: Buffer; salt: string } | null = null;

function isV2(value: unknown): value is EnvelopeV2 {
  if (typeof value !== "object" || value === null) return false;
  const env = value as Partial<EnvelopeV2>;
  return (
    env.v === 2 &&
    env.kdf === "scrypt" &&
    typeof env.salt === "string" &&
    typeof env.iv === "string" &&
    typeof env.tag === "string" &&
    typeof env.data === "string" &&
    Array.isArray(env.ids)
  );
}

function readEnvelope(): EnvelopeV1 | EnvelopeV2 {
  try {
    const parsed = JSON.parse(fs.readFileSync(secretsPath(), "utf8")) as unknown;
    if (isV2(parsed)) return parsed;
    return typeof parsed === "object" && parsed !== null ? (parsed as EnvelopeV1) : {};
  } catch {
    // Absent or corrupt: an empty map is the honest reading (no key stored).
    return {};
  }
}

function writeEnvelope(next: EnvelopeV1 | EnvelopeV2): void {
  const target = secretsPath();
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
  fs.renameSync(tmp, target);
}

function decryptV1(env: EnvelopeV1): SecretMap {
  // Nothing stored: reading must not wake the OS keyring. Electron initializes
  // its keychain entry on the first safeStorage call, and on a machine whose
  // login keychain is locked that is a synchronous authorization prompt — the
  // main thread never returns from it, so a launch with no secrets at all would
  // hang before the window paints.
  if (Object.keys(env).length === 0) return {};
  const api = safeStorage();
  if (!api || !api.isEncryptionAvailable()) return {};
  const map: SecretMap = {};
  for (const [id, stored] of Object.entries(env)) {
    try {
      map[id] = api.decryptString(Buffer.from(stored, "base64"));
    } catch {
      // A key the OS keyring cannot open is not a key we can use.
    }
  }
  return map;
}

/** Refuses to write plaintext when the OS keyring is unavailable. */
function encryptV1(map: SecretMap): EnvelopeV1 {
  const api = safeStorage();
  if (!api || !api.isEncryptionAvailable()) {
    throw new Error(
      "OS encryption is unavailable, so the API key was not saved (refusing to store it in plaintext)."
    );
  }
  const env: EnvelopeV1 = {};
  for (const [id, apiKey] of Object.entries(map)) {
    env[id] = api.encryptString(apiKey).toString("base64");
  }
  return env;
}

function decryptV2(env: EnvelopeV2, key: Buffer): SecretMap {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(env.iv, "hex"));
  decipher.setAuthTag(Buffer.from(env.tag, "hex"));
  const json = Buffer.concat([
    decipher.update(Buffer.from(env.data, "base64")),
    decipher.final(), // GCM: a wrong key (wrong PIN) throws here
  ]).toString("utf8");
  const parsed = JSON.parse(json) as unknown;
  return typeof parsed === "object" && parsed !== null ? (parsed as SecretMap) : {};
}

function encryptV2(map: SecretMap, key: Buffer, salt: string): EnvelopeV2 {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(map), "utf8"), cipher.final()]);
  return {
    v: 2,
    kdf: "scrypt",
    salt,
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    data: data.toString("base64"),
    ids: Object.keys(map).sort(),
  };
}

/**
 * Decrypted map. A v2 file needs this session's PIN-derived key; a v1 file is
 * read with the OS keyring.
 *
 * Deliberately returns an empty map (rather than throwing) when the key is
 * absent: the main process builds its model at boot, before the lock screen has
 * had a chance to collect the PIN, and a locked read must not look like a
 * corrupt store. Every surface that could use the key is lock-gated anyway
 * (`chat:run` returns LOCKED), and `hasSecret` still answers from the ids.
 */
function readMap(): SecretMap {
  const env = readEnvelope();
  if (isV2(env)) return keyring ? decryptV2(env, keyring.key) : {};
  return decryptV1(env);
}

/**
 * Store shape follows the gate, not the session: with a PIN configured the map
 * must go back under the PIN-derived key, so a write in a session that lost its
 * key fails loudly instead of silently downgrading to the OS keyring.
 */
function writeMap(map: SecretMap): void {
  if (Object.keys(map).length === 0) {
    fs.rmSync(secretsPath(), { force: true });
    return;
  }
  if (keyring) {
    writeEnvelope(encryptV2(map, keyring.key, keyring.salt));
    return;
  }
  // Without a session key a write would silently drop every key it could not
  // read (readMap is empty while locked) and rewrite the file in v1 form.
  if (hasPin()) throw new Error(LOCKED_MESSAGE);
  writeEnvelope(encryptV1(map));
}

/**
 * Install the session key from `pin`. Call after the PIN has been verified (or
 * just set). On an existing v2 file the PIN is checked against it here, so a
 * mismatch throws instead of surfacing later as a missing key. A legacy v1 file
 * is migrated under the PIN as part of the same step.
 */
export function installSecretsKey(pin: string): void {
  const env = readEnvelope();
  const legacy = isV2(env) ? null : env;
  const salt = isV2(env) ? env.salt : randomBytes(SALT_BYTES).toString("hex");
  const key = scryptSync(pin, Buffer.from(salt, "hex"), KEY_BYTES);
  if (isV2(env)) decryptV2(env, key);
  keyring = { key, salt };
  if (legacy && Object.keys(legacy).length > 0) {
    writeEnvelope(encryptV2(decryptV1(legacy), key, salt));
  }
}

/** Drop the session key (lock). The file stays under the PIN. */
export function clearSecretsKey(): void {
  keyring = null;
}

/**
 * Drop the session key and put the map back under the OS keyring (PIN removal).
 * The caller clears the stored PIN only after this returns, so a failure leaves
 * the file readable rather than orphaned behind a PIN nobody can enter.
 */
export function releaseSecretsKey(): void {
  const env = readEnvelope();
  const active = keyring;
  if (isV2(env)) {
    // A v2 file with no session key cannot be re-wrapped: refuse rather than
    // strand the stored keys behind a PIN that is about to be removed.
    if (!active) throw new Error(LOCKED_MESSAGE);
    keyring = null;
    const map = decryptV2(env, active.key);
    if (Object.keys(map).length > 0) writeEnvelope(encryptV1(map));
    else fs.rmSync(secretsPath(), { force: true }); // nothing left to keep
    return;
  }
  keyring = null;
  const legacy = decryptV1(env);
  if (Object.keys(legacy).length > 0) writeEnvelope(encryptV1(legacy));
}

/** Store an API key, under the PIN when one is configured, else the OS keyring. */
export function setSecret(providerId: string, apiKey: string): void {
  const next = readMap();
  next[providerId] = apiKey;
  writeMap(next);
}

/** True when a key is stored — reported to the renderer instead of the key itself. */
export function hasSecret(providerId: string): boolean {
  const env = readEnvelope();
  return isV2(env) ? env.ids.includes(providerId) : env[providerId] !== undefined;
}

/** Decrypted key, for main-process model construction only. Never crosses the bridge. */
export function getSecret(providerId: string): string | null {
  return readMap()[providerId] ?? null;
}

export function clearSecret(providerId: string): void {
  const next = readMap();
  if (next[providerId] === undefined) return;
  delete next[providerId];
  writeMap(next);
}
