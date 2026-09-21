/**
 * Live test of the shell approval gate: the run must PAUSE on execute,
 * survive a rejection, and complete after an approval.
 */
import { Command } from "@langchain/langgraph";
import type { HITLRequest } from "langchain";
import { requireIsolatedHome } from "./lib/isolated-home.js";
import { loadConfig } from "../src/main/agent/config.js";
import { buildAgent } from "../src/main/agent/agent.js";
import { StreamRenderer } from "../src/main/agent/render.js";

// Refuses to run without the temp HOME the npm script sets.
requireIsolatedHome();

const agent = buildAgent(loadConfig([])); // gate ON
const renderer = new StreamRenderer();
const config = {
  configurable: { thread_id: "hitl-test" },
  streamMode: "updates" as const,
  subgraphs: true as const,
  recursionLimit: 100,
};

function extractInterrupt(chunk: unknown): HITLRequest | null {
  const [, update] = chunk as [string[], Record<string, unknown>];
  const interrupts = update?.["__interrupt__"] as Array<{ value?: HITLRequest }> | undefined;
  return interrupts?.[0]?.value ?? null;
}

async function drain(input: unknown): Promise<HITLRequest | null> {
  const stream = await agent.stream(input as never, config);
  let pending: HITLRequest | null = null;
  for await (const chunk of stream) {
    const i = extractInterrupt(chunk);
    if (i) pending = i;
    else renderer.renderChunk(chunk);
  }
  return pending;
}

// 1. The task must pause for approval before running the command.
let pending = await drain({
  messages: [{ role: "user", content: "Run the shell command `echo gate-check-ok` and tell me its exact output." }],
});
if (!pending) throw new Error("FAIL: expected an approval interrupt before execute, got none");
console.log(`\n[gate fired] agent wants: ${JSON.stringify(pending.actionRequests.map((a) => a.args))}`);

// 2. Reject once — the agent must survive and react, then ask again or adapt.
pending = await drain(
  new Command({
    resume: { decisions: [{ type: "reject", message: "Not yet — ask again, this is a drill." }] },
  })
);
console.log(`\n[after reject] ${pending ? "agent retried and gate fired again" : "agent finished without shell"}`);

// 3. Approve (retry the task if the agent gave up after rejection).
if (!pending) {
  pending = await drain({
    messages: [{ role: "user", content: "Drill over. Please run `echo gate-check-ok` now and report the output." }],
  });
  if (!pending) throw new Error("FAIL: expected the gate to fire on the second attempt");
}
const done = await drain(new Command({ resume: { decisions: [{ type: "approve" }] } }));
if (done) throw new Error("FAIL: unexpected second interrupt after approval");

console.log("\nHITL_TEST_DONE — gate pauses, rejection survives, approval executes.");
