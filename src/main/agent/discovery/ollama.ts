import { z } from "zod";
import type { ModelInfo } from "../../../shared/wire.js";
import { errorDetail, request, type DiscoveryTarget } from "./shared.js";

const tagsSchema = z.object({
  models: z.array(z.object({ name: z.string().optional(), model: z.string().optional() })).optional(),
});

/** Pure parser — covered by ollama.test.ts with no live Ollama. Unreadable payloads list no models. */
export function parseOllamaTags(payload: unknown): ModelInfo[] {
  const parsed = tagsSchema.safeParse(payload);
  if (!parsed.success) return [];
  const out: ModelInfo[] = [];
  for (const entry of parsed.data.models ?? []) {
    const id = entry.name ?? entry.model;
    if (id) out.push({ id, label: id });
  }
  return out;
}

export async function discoverOllama(target: DiscoveryTarget): Promise<ModelInfo[]> {
  const url = `${target.baseUrl}/api/tags`;
  const res = await request(url);
  if (!res.ok) throw new Error(`Ollama responded ${res.status} for ${url}${await errorDetail(res)}`);
  return parseOllamaTags(await res.json());
}

/** One-token chat round trip: proves the base URL, the model name, and generation. */
export async function validateOllama(target: DiscoveryTarget, model: string): Promise<void> {
  const url = `${target.baseUrl}/api/chat`;
  const res = await request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "ping" }],
      stream: false,
      options: { num_predict: 1 },
    }),
  });
  if (!res.ok) throw new Error(`Ollama rejected "${model}" (${res.status})${await errorDetail(res)}`);
}
