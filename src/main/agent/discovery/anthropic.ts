import { z } from "zod";
import type { ModelInfo } from "../../../shared/wire.js";
import { errorDetail, request, requireApiKey, type DiscoveryTarget } from "./shared.js";

const ANTHROPIC_VERSION = "2023-06-01";

const modelsSchema = z.object({
  data: z.array(z.object({ id: z.string().optional(), display_name: z.string().optional() })).optional(),
});

export function parseAnthropicModels(payload: unknown): ModelInfo[] {
  const parsed = modelsSchema.safeParse(payload);
  if (!parsed.success) return [];
  const out: ModelInfo[] = [];
  for (const entry of parsed.data.data ?? []) {
    if (entry.id) out.push({ id: entry.id, label: entry.display_name ?? entry.id });
  }
  return out;
}

export async function discoverAnthropic(target: DiscoveryTarget): Promise<ModelInfo[]> {
  const key = requireApiKey(target);
  const url = `${target.baseUrl}/v1/models`;
  const res = await request(url, {
    headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION },
  });
  if (!res.ok) throw new Error(`Anthropic responded ${res.status} for ${url}${await errorDetail(res)}`);
  return parseAnthropicModels(await res.json());
}

export async function validateAnthropic(target: DiscoveryTarget, model: string): Promise<void> {
  const key = requireApiKey(target);
  const url = `${target.baseUrl}/v1/messages`;
  const res = await request(url, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic rejected "${model}" (${res.status})${await errorDetail(res)}`);
}
