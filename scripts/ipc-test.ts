/**
 * Live test of the desktop chat path: runTask streams WireEvents, pauses on
 * the approval gate, and resumes after resolveApproval — the exact wiring the
 * IPC chat handler depends on (no Electron window needed).
 *
 * Run: npm run ipc:test
 *
 * `npm run rebuild:native` compiles better-sqlite3 for Electron's ABI, so the
 * real module is unloadable from system Node. The npm script therefore runs
 * this file under `ELECTRON_RUN_AS_NODE=1 electron` — tsx via Electron's
 * runtime, i.e. the exact Node the main process uses.
 */
import { requireIsolatedHome } from "./lib/isolated-home.js";
import { runTask, resolveApproval } from "../src/main/agent/runtime.js";
import type { WireEvent } from "../src/shared/wire.js";

// Refuses to run without the temp HOME the npm script sets.
requireIsolatedHome();

const events: WireEvent[] = [];
let approvalRunId: string | null = null;

const send = (ev: WireEvent): void => {
  events.push(ev);
  if (ev.type === "approval") approvalRunId = ev.runId;
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const APPROVAL_TIMEOUT_MS = 10 * 60_000;

// A fresh threadId per invocation: checkpoints.sqlite persists across runs, so
// a reused thread would resume prior state instead of starting the gated task.
const threadId = `ipc-test-${Date.now()}`;

// 1. Run a gated task; it must pause on approval.
//
// runTask's promise only resolves once the whole run completes — including the
// wait for resolveApproval, which blocks on a deferred promise inside the gate.
// Await it here first and the script deadlocks. So: start the run unawaited,
// poll for the approval event, resolve it, and only then await the run promise.
const runPromise = runTask(
  "Run the shell command `echo ipc-gate-ok` and report its exact output.",
  threadId,
  send
);

const approvalDeadline = Date.now() + APPROVAL_TIMEOUT_MS;
while (!approvalRunId) {
  if (Date.now() > approvalDeadline) {
    throw new Error(`FAIL: expected an approval event, got none (${events.length} events before timeout)`);
  }
  await sleep(250);
}
console.log(`[gate fired] runId=${approvalRunId}`);

// 2. Approve; the run should complete with a done event.
resolveApproval(approvalRunId, { decisions: [{ type: "approve" }] });
await runPromise;

// send() is synchronous and events arrive while the run streams, so they are
// all collected already — the done event is the run's final send.
const done = events.find((e): e is Extract<WireEvent, { type: "done" }> => e.type === "done");
if (!done) throw new Error("FAIL: expected a done event after approval");
if (done.cancelled) throw new Error("FAIL: run was cancelled, expected completion");
if (done.error) throw new Error(`FAIL: run errored: ${done.error}`);
console.log(`[done] cancelled=${done.cancelled} rememberedNotes=${done.rememberedNotes ?? 0}`);

const tokens = events.filter((e) => e.type === "token").length;
const updates = events.filter((e) => e.type === "update").length;
console.log(`[stream] ${tokens} token events, ${updates} update events`);
if (tokens + updates === 0) throw new Error("FAIL: no stream events received");

console.log("IPC_TEST_DONE — runTask streams, approval round-trips, run completes.");
process.exit(0);