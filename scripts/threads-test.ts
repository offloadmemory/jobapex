/**
 * Live test of the Threads surface: run a real task through the agent runtime,
 * then assert the exact data the Threads view reads — `listThreads()` rows and
 * `threadHistory()` replay for that thread.
 *
 * Run: npm run threads:test  (HOME is redirected there, see lib/isolated-home)
 * Ollama must be reachable at http://localhost:11434.
 */
import fs from "node:fs";

import { requireIsolatedHome } from "./lib/isolated-home.js";
import { listThreads, threadHistory } from "../src/main/app/threads.js";
import { runTask } from "../src/main/agent/runtime.js";
import type { WireEvent } from "../src/shared/wire.js";

const home = requireIsolatedHome();

const PROMPT = "Reply with exactly: threads-ok";
const threadId = `threads-test-${Date.now()}`;
const events: WireEvent[] = [];

const watchdog = setTimeout(() => {
  console.error("FAIL: the run did not finish within 5 minutes");
  process.exit(1);
}, 5 * 60_000);

await runTask(PROMPT, threadId, (ev) => events.push(ev));
clearTimeout(watchdog);

const done = events.find((e): e is Extract<WireEvent, { type: "done" }> => e.type === "done");
if (!done) throw new Error("FAIL: the run never emitted a done event");
if (done.error) throw new Error(`FAIL: the run errored: ${done.error}`);
console.log(`[done] cancelled=${done.cancelled}`);

const threads = await listThreads();
const row = threads.find((thread) => thread.id === threadId);
if (!row) throw new Error(`FAIL: ${threadId} is missing from listThreads() — the view would show nothing`);
if (threads[0]?.id !== threadId) {
  throw new Error(`FAIL: the newest thread is not first (got ${threads[0]?.title ?? "none"})`);
}
if (row.title !== PROMPT) throw new Error(`FAIL: title "${row.title}" != the prompt`);
if (row.messageCount < 2) {
  throw new Error(`FAIL: messageCount ${row.messageCount} < 2 (the prompt plus the reply)`);
}
if (!(row.updatedAt > 0)) throw new Error("FAIL: updatedAt was not recorded");
console.log(
  `[list] ${threads.length} thread(s), newest first — title="${row.title}", ${row.messageCount} messages`
);

const history = await threadHistory(threadId);
const user = history.filter((message) => message.role === "user");
const assistant = history.filter(
  (message) => message.role === "assistant" && message.content.trim().length > 0
);
if (!user.some((message) => message.content.includes("threads-ok"))) {
  throw new Error("FAIL: the replayed history has no user prompt");
}
const reply = assistant[0];
if (!reply) throw new Error("FAIL: the replayed history has no assistant reply");
console.log(`[history] ${history.length} messages (${user.length} user, ${assistant.length} assistant)`);
console.log(`[reply] ${reply.content.slice(0, 80)}`);

fs.rmSync(home, { recursive: true, force: true });
console.log("THREADS_TEST_DONE — run recorded, listed newest-first, and replayed from the checkpointer.");
process.exit(0);
