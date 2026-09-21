import { z } from "zod";
import type { ModelInfo } from "../../../shared/wire.js";
import { errorDetail, request, requireApiKey, type DiscoveryTarget } from "./shared.js";

const modelsSchema = z.object({ data: z.array(z.object({ id: z.string().optional() })).optional() });

export function parseOpenAIModels(payload: unknown): ModelInfo[] {
  const parsed = modelsSchema.safeParse(payload);
  if (!parsed.success) return [];
  const ids: string[] = [];
  for (const entry of parsed.data.data ?? []) {
    if (entry.id) ids.push(entry.id);
  }
  return ids.sort((a, b) => a.localeCompare(b)).map((id) => ({ id, label: id }));
}

export async function discoverOpenAI(target: DiscoveryTarget): Promise<ModelInfo[]> {
  const key = requireApiKey(target);
  const url = `${target.baseUrl}/v1/models`;
  const res = await request(url, { headers: { authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`OpenAI responded ${res.status} for ${url}${await errorDetail(res)}`);
  return parseOpenAIModels(await res.json());
}

export async function validateOpenAI(target: DiscoveryTarget, model: string): Promise<void> {
  const key = requireApiKey(target);
  const url = `${target.baseUrl}/v1/chat/completions`;
  const res = await request(url, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI rejected "${model}" (${res.status})${await errorDetail(res)}`);
}
