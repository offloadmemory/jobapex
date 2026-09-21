import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getDb } from "./db.js";
import { logWarn } from "./logger.js";

const PIN_HASH_KEY = "pinHash";
const PIN_BACKOFF_KEY = "pinBackoff";
const MAX_BACKOFF_MS = 5 * 60_000;

/**
 * Unlock state is per session and deliberately not persisted: a relaunch with a
 * PIN configured starts locked.
 */
let unlocked = false;

function readRow(key: string): string | null {
  const row = getDb().prepare(`SELECT value FROM auth WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function writeRow(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO auth (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
}

export function hasPin(): boolean {
  return readRow(PIN_HASH_KEY) !== null;
}

/** scrypt from node:crypto — a password-hashing dependency would be a heavier choice. */
export function setPin(pin: string): void {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 64);
  writeRow(PIN_HASH_KEY, `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`);
}

export function clearPin(): void {
  const db = getDb();
  db.prepare(`DELETE FROM auth WHERE key IN (?, ?)`).run(PIN_HASH_KEY, PIN_BACKOFF_KEY);
  unlocked = true; // nothing left to lock
}

function verifyPin(pin: string): boolean {
  const stored = readRow(PIN_HASH_KEY);
  if (!stored) return false;
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(pin, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

interface Backoff {
  failures: number;
  lastFailedAt: number;
}

function readBackoff(): Backoff {
  const stored = readRow(PIN_BACKOFF_KEY);
  if (!stored) return { failures: 0, lastFailedAt: 0 };
  try {
    const parsed = JSON.parse(stored) as Partial<Backoff>;
    return { failures: parsed.failures ?? 0, lastFailedAt: parsed.lastFailedAt ?? 0 };
  } catch {
    // An unreadable row must not hand out a fresh budget of attempts: treat it
    // as one failure now, so the counter keeps climbing from here instead of
    // resetting to zero.
    logWarn("auth.backoff", "pinBackoff row is not valid JSON; counting it as one failed attempt");
    return { failures: 1, lastFailedAt: Date.now() };
  }
}

/** Milliseconds before the next attempt is accepted; 0 means now. */
export function pinRetryDelayMs(): number {
  const { failures, lastFailedAt } = readBackoff();
  if (failures < 3) return 0;
  const delay = Math.min(MAX_BACKOFF_MS, 2 ** (failures - 2) * 1000);
  return Math.max(0, lastFailedAt + delay - Date.now());
}

export function isLocked(): boolean {
  return hasPin() && !unlocked;
}

export function markUnlocked(): void {
  unlocked = true;
}

export function lock(): void {
  unlocked = false;
}

export type UnlockResult = { ok: true } | { ok: false; message: string; retryInMs: number };

export function attemptUnlock(pin: string): UnlockResult {
  const waiting = pinRetryDelayMs();
  if (waiting > 0) {
    return {
      ok: false,
      retryInMs: waiting,
      message: `Too many attempts. Try again in ${Math.ceil(waiting / 1000)}s.`,
    };
  }
  if (!verifyPin(pin)) {
    const backoff = readBackoff();
    writeRow(
      PIN_BACKOFF_KEY,
      JSON.stringify({ failures: backoff.failures + 1, lastFailedAt: Date.now() })
    );
    const retryInMs = pinRetryDelayMs();
    return {
      ok: false,
      retryInMs,
      message: retryInMs > 0 ? `Incorrect PIN. Try again in ${Math.ceil(retryInMs / 1000)}s.` : "Incorrect PIN.",
    };
  }
  writeRow(PIN_BACKOFF_KEY, JSON.stringify({ failures: 0, lastFailedAt: 0 }));
  unlocked = true;
  return { ok: true };
}
