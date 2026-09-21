/**
 * Live test of the agent-runner seam: runAgentTask streams a task, fires
 * the requestApproval callback on the shell gate, auto-approves, and
 * returns the final messages.
 */
import { randomUUID } from "node:crypto";
import type { HITLRequest, HITLResponse } from "langchain";
import { loadConfig } from "../src/main/agent/config.js";
import { buildAgent } from "../src/main/agent/agent.js";
import { runAgentTask, type TaskCallbacks, type TaskResult } from "../src/main/agent/agent-runner.js";
import { truncate } from "../src/main/agent/stream-events.js";

import { requireIsolatedHome } from "./lib/isolated-home.js";

// Refuses to run without the temp HOME the npm script sets.
requireIsolatedHome();

const agent = buildAgent(loadConfig([])); // gate ON
let approvals = 0;
let tokenLines = 0;

const callbacks: TaskCallbacks = {
  onEvent(ev) {
    if (ev.kind === "token") {
      if (tokenLines < 5) {
        console.log(`[token depth=${ev.depth}] ${truncate(String(ev.msg.content ?? ""), 80)}`);
        tokenLines++;
      }
      return;
    }
    for (const [key, nodeUpdate] of Object.entries(ev.update)) {
      if (key === "__interrupt__") continue;
      for (const msg of (nodeUpdate.messages ?? []) as Array<Record<string, any>>) {
        for (const tc of msg.tool_calls ?? []) {
          console.log(`[update depth=${ev.depth}] tool-call: ${tc.name}`);
        }
      }
    }
  },
  async requestApproval(request: HITLRequest): Promise<HITLResponse> {
    approvals++;
    for (const action of request.actionRequests) {
      const detail =
        action.name === "execute" ? String(action.args.command ?? "") : JSON.stringify(action.args);
      console.log(`approval: ${action.name} ${detail}`);
    }
    return { decisions: [{ type: "approve" }] };
  },
};

const PROMPT =
  "Run the shell command `echo runner-gate-ok` with the execute tool and report its output.";

const result = await runAgentTask(agent, PROMPT, randomUUID(), callbacks);

const messagesOk = result.messages !== null && result.messages.length > 0;
const gateOk = approvals >= 1;
console.log(`\n[${messagesOk ? "PASS" : "FAIL"}] result.messages returned (${result.messages?.length ?? 0} messages, error=${result.error?.message ?? "none"}, cancelled=${result.cancelled})`);
console.log(`[${gateOk ? "PASS" : "FAIL"}] approval gate satisfied via requestApproval (${approvals} call(s))`);
console.log(`\nRUNNER_TEST_DONE — ${messagesOk && gateOk ? "PASS" : "FAIL"}`);
if (!(messagesOk && gateOk)) process.exit(1);
