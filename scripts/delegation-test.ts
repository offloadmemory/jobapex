/** One-off live test: exercises task-tool delegation to coder + critic. */
import { loadConfig } from "../src/main/agent/config.js";
import { buildAgent } from "../src/main/agent/agent.js";
import { StreamRenderer } from "../src/main/agent/render.js";

const agent = buildAgent(loadConfig(["--yolo"]));
const renderer = new StreamRenderer();

const TASK =
  "Delegate to the coder subagent: create fizz.sh that prints numbers 1-5, make it executable, " +
  "run it, and report the output. Then delegate to the critic subagent to verify fizz.sh meets " +
  "the requirement.";

const stream = await agent.stream(
  { messages: [{ role: "user", content: TASK }] },
  { configurable: { thread_id: "delegation-test" }, streamMode: "updates", subgraphs: true, recursionLimit: 150 }
);
for await (const chunk of stream) renderer.renderChunk(chunk);
console.log("DELEGATION_TEST_DONE");
