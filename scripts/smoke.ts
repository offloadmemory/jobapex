/**
 * End-to-end smoke test: exercises planning (todos), file write, shell
 * execution and the final summary in one cheap task.
 *
 * Run: npm run smoke
 */
import { loadConfig } from "../src/main/agent/config.js";
import { buildAgent } from "../src/main/agent/agent.js";
import { StreamRenderer } from "../src/main/agent/render.js";

const cfg = loadConfig(["--yolo"]);
const agent = buildAgent(cfg);
const renderer = new StreamRenderer();

const TASK =
  "Plan with todos, then: write a file hello.txt containing exactly 'hello from deep agents', " +
  "verify it with a shell command (cat hello.txt), then mark all todos completed and summarize.";

console.log(`smoke task on ${cfg.model} …\n`);

const stream = await agent.stream(
  { messages: [{ role: "user", content: TASK }] },
  { configurable: { thread_id: "smoke" }, streamMode: "updates", subgraphs: true, recursionLimit: 100 }
);

for await (const chunk of stream) {
  renderer.renderChunk(chunk);
}

console.log("\nsmoke run finished.");
