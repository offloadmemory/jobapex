/**
 * Live test of the OpenWiki knowledge loop:
 * 1. write-back — a task with durable learnings must produce librarian notes
 *    under workspace/openwiki/notes/
 * 2. read-first — a FRESH thread must answer a question from the knowledge
 *    base by reading /openwiki files rather than re-exploring from scratch.
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/main/agent/config.js";
import { buildAgent } from "../src/main/agent/agent.js";
import { StreamRenderer } from "../src/main/agent/render.js";

const cfg = loadConfig(["--yolo"]);
const agent = buildAgent(cfg);
const renderer = new StreamRenderer();
const notesDir = path.join(cfg.workspaceDir, "openwiki", "notes");

const wikiReads: string[] = [];

async function run(threadId: string, content: string): Promise<void> {
  const stream = await agent.stream(
    { messages: [{ role: "user", content }] },
    { configurable: { thread_id: threadId }, streamMode: "updates", subgraphs: true, recursionLimit: 150 }
  );
  for await (const chunk of stream) {
    const [, update] = chunk as [string[], Record<string, Record<string, unknown>>];
    for (const node of Object.values(update ?? {})) {
      for (const msg of (node?.messages ?? []) as Array<Record<string, any>>) {
        for (const tc of msg.tool_calls ?? []) {
          const target = String(tc.args?.file_path ?? tc.args?.path ?? "");
          if (target.includes("openwiki") && (tc.name === "read_file" || tc.name === "ls" || tc.name === "glob")) {
            wikiReads.push(`${tc.name}:${target}`);
          }
        }
      }
    }
    renderer.renderChunk(chunk);
  }
}

const before = fs.readdirSync(notesDir).filter((f) => f !== "index.md");

console.log("=== phase 1: write-back ===\n");
await run(
  "wiki-test-write",
  "Durable learnings from today worth keeping: (1) the user prefers AWS cost reports to list " +
    "'bleeders' (month-over-month increasers) before top-spend tables; (2) aws-cost-analysis/analyze.py " +
    "reads pre-fetched Cost Explorer JSON from /private/tmp, so it needs those files refreshed before " +
    "re-running. Record this in your knowledge base."
);

const after = fs.readdirSync(notesDir).filter((f) => f !== "index.md");
const newNotes = after.filter((f) => !before.includes(f));
if (newNotes.length === 0) throw new Error("FAIL: librarian created no new notes");
const noteContent = fs.readFileSync(path.join(notesDir, newNotes[0]), "utf8");
if (!noteContent.startsWith("---")) throw new Error("FAIL: note missing OKF front matter");
console.log(`\n[write-back OK] new notes: ${newNotes.join(", ")}`);

console.log("\n=== phase 2: read-first on a fresh thread ===\n");
wikiReads.length = 0;
await run(
  "wiki-test-read",
  "New session. What do you already know about the AWS cost analysis work in this workspace and " +
    "how reports should be formatted? Answer from your knowledge base."
);
if (wikiReads.length === 0) throw new Error("FAIL: agent never read /openwiki on the fresh thread");
console.log(`\n[read-first OK] wiki reads: ${wikiReads.slice(0, 5).join(", ")}`);

console.log("\nWIKI_TEST_DONE");
