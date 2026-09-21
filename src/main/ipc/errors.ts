import type { Result } from "@shared/wire";
import { logError } from "../app/logger.js";

/** Success half of the envelope; handlers never return a bare value across the bridge. */
export function okResult<T>(data: T): Result<T> {
  return { ok: true, data };
}

/** Bridge a thrown domain error into the Result envelope; the message carries the detail. */
export function failResult(err: unknown, code = "FAILED"): Result<never> {
  logError(`ipc.${code}`, err);
  return {
    ok: false,
    error: { code, message: err instanceof Error ? err.message : String(err) },
  };
}
