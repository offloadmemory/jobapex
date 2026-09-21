import type { ProviderType } from "../../../shared/wire.js";

export interface DiscoveryTarget {
  type: ProviderType;
  baseUrl: string;
  apiKey: string | null;
}

export const DISCOVERY_TIMEOUT_MS = 10_000;

export function requireApiKey(target: DiscoveryTarget): string {
  if (!target.apiKey) throw new Error("Add an API key for this provider first.");
  return target.apiKey;
}

/** Short quoted slice of an error body so failures are diagnosable in the UI. */
export async function errorDetail(res: Response): Promise<string> {
  const text = (await res.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 200);
  return text ? `: ${text}` : "";
}

/** fetch with an unreachable-host message, since a bare "fetch failed" is useless to a user. */
export async function request(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS), ...init });
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : null;
    const detail = cause ?? (err instanceof Error ? err.message : String(err));
    throw new Error(`Cannot reach ${url} (${detail}). Check the base URL and that the provider is running.`);
  }
}
