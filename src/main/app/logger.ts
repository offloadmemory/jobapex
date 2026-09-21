import fs from "node:fs";
import path from "node:path";

import { logsDir } from "../agent/paths.js";

/**
 * Rotating file log for main-process failures. A desktop app has no console
 * scrollback, so agent and IPC errors land in
 * ~/.deepagents/hermes/logs/hermes.log instead — one JSON object per line,
 * rotated at 512 KiB with three older files kept.
 */
const MAX_BYTES = 512 * 1024;
const KEEP = 3;

function rotate(file: string): void {
  fs.rmSync(`${file}.${KEEP}`, { force: true });
  for (let i = KEEP - 1; i >= 1; i--) {
    const older = `${file}.${i}`;
    if (fs.existsSync(older)) fs.renameSync(older, `${file}.${i + 1}`);
  }
  fs.renameSync(file, `${file}.1`);
}

function detailOf(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

/** Errors thrown as objects (`{ name, message }` from a run result) have no prototype. */
function describe(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof value.message === "string"
  ) {
    return value.message;
  }
  return String(value);
}

function append(entry: Record<string, unknown>): void {
  try {
    const file = path.join(logsDir(), "hermes.log");
    if (fs.existsSync(file) && fs.statSync(file).size >= MAX_BYTES) rotate(file);
    fs.appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`, {
      mode: 0o600,
    });
  } catch {
    // Logging is best-effort: a full disk must never take the agent down.
  }
}

export function logInfo(scope: string, message: string, detail?: unknown): void {
  append({
    level: "info",
    scope,
    message,
    ...(detail === undefined ? {} : { detail: detailOf(detail) }),
  });
}

/**
 * Something degraded but did not fail — a rejection the user retried, a row we
 * had to read defensively. Worth keeping next to the errors it precedes.
 */
export function logWarn(scope: string, message: string, detail?: unknown): void {
  append({
    level: "warn",
    scope,
    message,
    ...(detail === undefined ? {} : { detail: detailOf(detail) }),
  });
}

/** Log a failure with the detail needed to diagnose it later (message + stack). */
export function logError(scope: string, err: unknown): void {
  append({ level: "error", scope, message: describe(err), detail: detailOf(err) });
}
