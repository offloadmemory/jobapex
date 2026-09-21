import { randomUUID } from "node:crypto";
import type { HITLRequest, HITLResponse } from "langchain";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { loadConfig, type AppConfig } from "./config.js";
import { buildAgent, type DeepAgentInstance } from "./agent.js";
import { activeModelSpec, createChatModel } from "./model-factory.js";
import { resolveActiveProvider } from "../app/providers.js";
import { isLocked } from "../app/auth.js";
import { noteThreadRun } from "../app/threads.js";
import { logError } from "../app/logger.js";
import { runAgentTask, type TaskCallbacks } from "./agent-runner.js";
import { contentToString, type StreamEvent } from "./stream-events.js";
import { consolidateMemory } from "./memory/consolidate.js";
import type {
  AppInfo,
  HITLDecisionKind,
  HITLRequestWire,
  HITLResponseWire,
  Todo,
  WireEvent,
  WireMsg,
} from "../../shared/wire.js";

let cfg: AppConfig | null = null;

/**
 * Config is read on first use rather than at import time: index.ts points the
 * packaged workspace root at userData before anything builds an agent, and the
 * filesystem backend must not snapshot the read-only app.asar default first.
 */
function config(): AppConfig {
  return (cfg ??= loadConfig());
}

/**
 * The agent plus the cold model used for memory consolidation; both are built
 * together because both need the provider's API key. Null while the runtime
 * cannot be built: with a PIN stored, a launch starts locked and a cloud
 * provider cannot build until the lock screen has collected the PIN. Booting
 * must not crash on that — app:unlock rebuilds once the key is available.
 */
let built: { agent: DeepAgentInstance; model: BaseChatModel } | null = null;

/**
 * Why the last build failed, in the runtime's own words. The lock/key wording
 * only fits a lock or key problem; a broken workspace or an unreadable
 * checkpoint file must be reported as itself instead of being blamed on them.
 */
let bootError: string | null = null;

/** True once a build has been attempted, so a null `built` is not retried on every run. */
let bootstrapped = false;

/** better-sqlite3 holds the file open until close(); each rebuild would leak a handle. */
function closeCheckpointer(agent: DeepAgentInstance | null | undefined): void {
  // `createDeepAgent` returns the compiled graph behind a `.withConfig(...)`
  // binding, so the saver sits on the bound runnable when a wrapper is present.
  const graph: unknown = agent && "bound" in agent ? agent.bound : agent;
  const saver: unknown =
    graph && typeof graph === "object" && "checkpointer" in graph ? graph.checkpointer : null;
  if (!(saver instanceof SqliteSaver)) return;
  try {
    saver.db.close();
  } catch (err) {
    logError("agent.close", err);
  }
}

function buildRuntime(next: AppConfig): typeof built {
  const previous = built;
  try {
    const runtime = {
      agent: buildAgent(next),
      // Consolidation runs cold: thinking tokens would only dilute the summary.
      model: createChatModel({ ...activeModelSpec(next), think: false }),
    };
    // Only once the replacement is known-good, so a failed rebuild leaves the
    // previous agent (and its checkpointer) usable.
    closeCheckpointer(previous?.agent);
    bootError = null;
    return runtime;
  } catch (err) {
    // While locked the keys are unreadable by design — that is not a boot
    // failure, and the lock screen is the actionable message for it.
    bootError = isLocked() ? null : err instanceof Error ? err.message : String(err);
    logError("agent.boot", err);
    return null;
  }
}

/** Build on first use; index.ts has configured the workspace root by then. */
function ensureBuilt(): typeof built {
  if (built || bootstrapped) return built;
  bootstrapped = true;
  built = buildRuntime(config());
  return built;
}

/**
 * Rebuild after the active provider (or the unlock state, which gates the keys)
 * changes. A run already in flight keeps the agent instance it started with.
 */
export function rebuildAgent(): void {
  cfg = loadConfig();
  bootstrapped = true;
  built = buildRuntime(cfg);
}

/** Release the sqlite handle the current agent holds; main calls this on quit. */
export function closeRuntime(): void {
  closeCheckpointer(built?.agent);
  built = null;
  bootstrapped = true;
}

const pendingApprovals = new Map<
  string,
  { request: HITLRequest; resolve: (r: HITLResponse) => void }
>();
let active: { runId: string; threadId: string; controller: AbortController } | null = null;

/** Gates that do not name their decisions accept all of them. */
const ALL_DECISIONS: HITLDecisionKind[] = ["approve", "reject", "edit"];

function toWireMsg(msg: Record<string, any>): WireMsg | null {
  const type = msg.getType?.() ?? msg.type;
  if (type === "ai") {
    const toolCalls = ((msg.tool_calls ?? []) as Array<Record<string, any>>).map((tc) => ({
      name: tc.name,
      args: tc.args,
    }));
    return {
      type: "ai",
      content: contentToString(msg.content),
      ...(msg.additional_kwargs?.reasoning_content
        ? { reasoning: msg.additional_kwargs.reasoning_content as string }
        : {}),
      ...(toolCalls.length ? { toolCalls } : {}),
    };
  }
  if (type === "tool") {
    return {
      type: "tool",
      content: contentToString(msg.content),
      isError: msg.status === "error",
    };
  }
  return null;
}

export function toWireEvents(ev: StreamEvent): WireEvent[] {
  if (ev.kind === "token") {
    const msg = toWireMsg(ev.msg);
    return msg ? [{ type: "token", depth: ev.depth, msg }] : [];
  }
  const out: WireEvent[] = [];
  for (const [key, nodeUpdate] of Object.entries(ev.update ?? {})) {
    if (key === "__interrupt__") continue;
    if (!nodeUpdate || typeof nodeUpdate !== "object") continue;
    const u = nodeUpdate as Record<string, unknown>;
    // depth > 0 is a subagent's plan; the renderer nests it under the parent's.
    if (Array.isArray(u.todos)) out.push({ type: "todos", depth: ev.depth, todos: u.todos as Todo[] });
    for (const m of (u.messages ?? []) as Array<Record<string, any>>) {
      const wm = toWireMsg(m);
      if (wm) out.push({ type: "update", depth: ev.depth, msg: wm });
    }
  }
  return out;
}

function toWireRequest(request: HITLRequest): HITLRequestWire {
  return {
    actionRequests: request.actionRequests.map((a, i) => ({
      name: a.name,
      args: a.args as Record<string, unknown>,
      // The library reports the accepted decisions on the review config that
      // pairs with the action, so the UI never offers one the gate would refuse.
      allowedDecisions: request.reviewConfigs?.[i]?.allowedDecisions ?? ALL_DECISIONS,
    })),
  };
}

function toHITLResponse(decision: HITLResponseWire): HITLResponse {
  return {
    decisions: decision.decisions.map((d) => {
      if (d.type === "approve") return { type: "approve" };
      if (d.type === "reject") return { type: "reject", message: d.message };
      return { type: "edit", editedAction: d.editedAction };
    }),
  };
}

/**
 * Run one prompt. `send` is the caller's channel back to whoever started the
 * run (the IPC layer routes it to the initiating window); this module never
 * broadcasts on its own.
 */
export async function runTask(
  prompt: string,
  threadId: string,
  send: (ev: WireEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const current = ensureBuilt();
  if (!current) {
    // Most specific reason first: a build that failed for a real reason (an
    // unwritable workspace, a corrupt provider row) outranks the lock/key guess.
    if (bootError) throw new Error(`The agent could not start: ${bootError}`);
    if (isLocked()) throw new Error("The app is locked. Enter your PIN to continue.");
    throw new Error("No provider is configured. Add one in Settings -> Providers.");
  }
  const { agent, model } = current;
  const runId = randomUUID();
  const controller = new AbortController();
  active = { runId, threadId, controller };
  noteThreadRun(threadId, prompt);

  const callbacks: TaskCallbacks = {
    onEvent: (ev) => {
      for (const w of toWireEvents(ev)) send(w);
    },
    requestApproval: (request) =>
      new Promise<HITLResponse>((resolve) => {
        pendingApprovals.set(runId, { request, resolve });
        send({ type: "approval", runId, request: toWireRequest(request) });
      }),
    onDrain: () => send({ type: "drain" }),
  };

  try {
    const result = await runAgentTask(agent, prompt, threadId, callbacks, controller.signal);
    if (result.error) {
      logError("agent.run", result.error);
      send({
        type: "done",
        cancelled: false,
        error: result.error.message || result.error.name,
      });
    } else if (result.cancelled) {
      send({ type: "done", cancelled: true });
    } else {
      let rememberedNotes = 0;
      if (result.messages) {
        rememberedNotes = await consolidateMemory(model, result.messages).catch((err: unknown) => {
          logError("memory.consolidate", err);
          return 0;
        });
      }
      send({ type: "done", cancelled: false, rememberedNotes });
    }
  } finally {
    pendingApprovals.delete(runId);
    if (active?.runId === runId) active = null;
  }
}

/** False when the gate is gone (already answered, cancelled, or a stale runId). */
export function resolveApproval(runId: string, decision: HITLResponseWire): boolean {
  const entry = pendingApprovals.get(runId);
  if (!entry) return false;
  pendingApprovals.delete(runId);
  entry.resolve(toHITLResponse(decision));
  return true;
}

/** Whether a run is still parked on this gate (a reloaded window re-asks). */
export function hasPendingApproval(runId: string): boolean {
  return pendingApprovals.has(runId);
}

/** Thread of the in-flight run, so a busy refusal can name it. */
export function runningThreadId(): string | null {
  return active?.threadId ?? null;
}

/**
 * Stop the in-flight run. A threadId stops only that thread's run: a stale Stop
 * from another thread's view must not kill the one the user is watching.
 */
export function cancel(threadId?: string): void {
  if (!active) return;
  if (threadId && active.threadId !== threadId) return;
  const { runId, controller } = active;
  const entry = pendingApprovals.get(runId);
  if (entry) {
    pendingApprovals.delete(runId);
    // Reject all pending actions so the langgraph interrupt resolves and the
    // run unwinds via the abort below instead of hanging forever.
    entry.resolve({
      decisions: entry.request.actionRequests.map(() => ({
        type: "reject",
        message: "The user cancelled this task.",
      })),
    });
  }
  controller.abort();
}

export function isRunning(): boolean {
  return active !== null;
}

/** The fields the main process knows statically; logDir/version come from Electron. */
export function getAppInfo(): Omit<AppInfo, "logDir" | "version"> {
  const current = config();
  const spec = activeModelSpec(current);
  const provider = resolveActiveProvider();
  return {
    model: spec.model,
    baseUrl: spec.baseUrl,
    workspaceDir: current.workspaceDir,
    memfs: current.memfs,
    yolo: current.yolo,
    providerName: provider?.name ?? null,
    providerType: provider?.type ?? null,
  };
}
