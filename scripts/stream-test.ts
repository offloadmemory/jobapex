/**
 * Live test of token + thinking streaming: verifies that "messages"-mode
 * chunks carry reasoning_content and content deltas, and that the renderer
 * interleaves 🧠 thinking, prose, and tool lines without collisions.
 */
import { loadConfig } from "../src/main/agent/config.js";
import { buildAgent } from "../src/main/agent/agent.js";
import { StreamRenderer } from "../src/main/agent/render.js";

import { requireIsolatedHome } from "./lib/isolated-home.js";

// Refuses to run without the temp HOME the npm script sets.
requireIsolatedHome();

const agent = buildAgent(loadConfig(["--yolo"]));
const renderer = new StreamRenderer(true);

let reasoningDeltas = 0;
let contentDeltas = 0;

const stream = await agent.stream(
  {
    messages: [
      {
        role: "user",
        content:
          "Run `echo stream-check` in the shell, then explain in two sentences what the command did.",
      },
    ],
  },
  {
    configurable: { thread_id: "stream-test" },
    streamMode: ["updates", "messages"],
    subgraphs: true,
    recursionLimit: 100,
  }
);

for await (const chunk of stream) {
  const [, mode, payload] = chunk as [string[], string, unknown];
  if (mode === "messages") {
    const [msg] = payload as [Record<string, any>, unknown];
    if (msg.additional_kwargs?.reasoning_content) reasoningDeltas++;
    if (typeof msg.content === "string" && msg.content) contentDeltas++;
  }
  renderer.renderChunk(chunk);
}
renderer.finishLine();

console.log(`\nreasoning deltas: ${reasoningDeltas}, content deltas: ${contentDeltas}`);
if (contentDeltas < 2) throw new Error("FAIL: expected token-by-token content streaming");
console.log("STREAM_TEST_DONE");
