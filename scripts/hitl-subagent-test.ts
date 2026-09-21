/** Live test: approval gate must also fire inside a delegated subagent and resume cleanly. */
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
  configurable: { thread_id: "hitl-subagent-test" },
  streamMode: "updates" as const,
  subgraphs: true as const,
  recursionLimit: 150,
};

async function drain(input: unknown): Promise<HITLRequest | null> {
  const stream = await agent.stream(input as never, config);
  let pending: HITLRequest | null = null;
  for await (const chunk of stream) {
    const [, update] = chunk as [string[], Record<string, unknown>];
    const interrupts = update?.["__interrupt__"] as Array<{ value?: HITLRequest }> | undefined;
    if (interrupts?.[0]?.value) pending = interrupts[0].value;
    else renderer.renderChunk(chunk);
  }
  return pending;
}

let pending = await drain({
  messages: [
    {
      role: "user",
      content:
        "Delegate to the coder subagent: run the shell command `echo sub-gate-ok` and report its exact output.",
    },
  ],
});

let approvals = 0;
while (pending) {
  approvals++;
  console.log(`\n[gate #${approvals}] ${JSON.stringify(pending.actionRequests.map((a) => a.args))}`);
  if (approvals > 5) throw new Error("FAIL: too many interrupts, something is looping");
  pending = await drain(
    new Command({ resume: { decisions: pending.actionRequests.map(() => ({ type: "approve" as const })) } })
  );
}

if (approvals === 0) throw new Error("FAIL: gate never fired for the delegated shell command");
console.log(`\nHITL_SUBAGENT_TEST_DONE — gate fired ${approvals}x inside delegation and resumed cleanly.`);
