import { hermes } from "./ipc";

/**
 * Renderer failures have nowhere to go in a packaged build (no devtools, no
 * stdout), so mirror them into the main-process rotating log. Best effort on
 * purpose: logging must never throw into a catch block that is already
 * handling a failure.
 */
export function reportError(scope: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  void hermes.app.log("error", `${scope}: ${detail}`).catch(() => undefined);
}

export function reportWarn(scope: string, message: string): void {
  void hermes.app.log("warn", `${scope}: ${message}`).catch(() => undefined);
}

export function reportInfo(scope: string, message: string): void {
  void hermes.app.log("info", `${scope}: ${message}`).catch(() => undefined);
}
