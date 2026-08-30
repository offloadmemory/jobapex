import fs from "node:fs";
import { loadConfig } from "../src/main/agent/config.js";
import { buildAgent } from "../src/main/agent/agent.js";
import { createCheckpointer } from "../src/main/agent/persistence.js";
import { checkpointsPath } from "../src/main/agent/paths.js";

const cfg = loadConfig(["--yolo"]);
const threadId = "persistence-test";

// Isolated check: the checkpointer is a SqliteSaver and creates the SQLite file.
const cp = createCheckpointer();
console.log("checkpointer type:", cp.constructor.name);
console.log("sqlite file created:", fs.existsSync(checkpointsPath()));

// Full recall: a fact written by one agent instance is recalled by a fresh one.
const a1 = buildAgent(cfg);
await a1.invoke(
  { messages: [{ role: "user", content: "Remember the number 42. Reply 'ok'." }] },
  { configurable: { thread_id: threadId } }
);

const a2 = buildAgent(cfg);
const res = await a2.invoke(
  { messages: [{ role: "user", content: "What number did I ask you to remember?" }] },
  { configurable: { thread_id: threadId } }
);
const last = res.messages[res.messages.length - 1];
const text = typeof last.content === "string" ? last.content : JSON.stringify(last.content);
console.log("recall:", text);
console.log(text.includes("42") ? "PASS" : "FAIL");
