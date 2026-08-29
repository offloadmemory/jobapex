import { Command } from "@langchain/langgraph";
import type { HITLRequest } from "langchain";
import { loadConfig } from "../src/main/agent/config.js";
import { buildAgent } from "../src/main/agent/agent.js";
import { StreamRenderer } from "../src/main/agent/render.js";

const agent = buildAgent(loadConfig([]));
const renderer = new StreamRenderer(true);
const config = { configurable: { thread_id: "gate-dual" }, streamMode: ["updates", "messages"] as const, subgraphs: true as const, recursionLimit: 100 };

function extractInterrupt(chunk: unknown): HITLRequest | null {
  const [, mode, payload] = chunk as [string[], string, Record<string, unknown>];
  if (mode !== "updates") return null;
  const i = payload?.["__interrupt__"] as Array<{ value?: HITLRequest }> | undefined;
  return i?.[0]?.value ?? null;
}
async function drain(input: unknown): Promise<HITLRequest | null> {
  const stream = await agent.stream(input as never, config as never);
  let pending: HITLRequest | null = null;
  for await (const chunk of stream) {
    const i = extractInterrupt(chunk);
    if (i) pending = i; else renderer.renderChunk(chunk);
  }
  renderer.finishLine();
  return pending;
}
let pending = await drain({ messages: [{ role: "user", content: "Run `echo dual-gate-ok` and report the exact output." }] });
if (!pending) throw new Error("FAIL: gate did not fire in dual stream mode");
console.log("[gate fired in dual mode]");
const done = await drain(new Command({ resume: { decisions: [{ type: "approve" }] } }));
if (done) throw new Error("FAIL: unexpected second interrupt");
console.log("GATE_DUAL_CHECK_DONE");
