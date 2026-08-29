import { randomUUID } from "node:crypto";
import type { HITLRequest, HITLResponse } from "langchain";
import { ChatOllama } from "@langchain/ollama";
import { loadConfig } from "./config.js";
import { buildAgent } from "./agent.js";
import { runAgentTask, type TaskCallbacks } from "./agent-runner.js";
import { contentToString, type StreamEvent } from "./stream-events.js";
import { consolidateMemory } from "./memory/consolidate.js";
import type {
  AppInfo,
  HITLRequestWire,
  HITLResponseWire,
  Todo,
  WireEvent,
  WireMsg,
} from "../../shared/wire.js";

const cfg = loadConfig();
const agent = buildAgent(cfg);
const model = new ChatOllama({ model: cfg.model, baseUrl: cfg.baseUrl, think: false });

const pendingApprovals = new Map<string, (r: HITLResponse) => void>();
let active: { runId: string; threadId: string; controller: AbortController } | null = null;

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
    if (Array.isArray(u.todos)) out.push({ type: "todos", todos: u.todos as Todo[] });
    for (const m of (u.messages ?? []) as Array<Record<string, any>>) {
      const wm = toWireMsg(m);
      if (wm) out.push({ type: "update", depth: ev.depth, msg: wm });
    }
  }
  return out;
}

function toWireRequest(request: HITLRequest): HITLRequestWire {
  return {
    actionRequests: request.actionRequests.map((a) => ({
      name: a.name,
      args: a.args as Record<string, unknown>,
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

export async function runTask(
  prompt: string,
  threadId: string,
  send: (ev: WireEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const runId = randomUUID();
  const controller = new AbortController();
  active = { runId, threadId, controller };

  const callbacks: TaskCallbacks = {
    onEvent: (ev) => {
      for (const w of toWireEvents(ev)) send(w);
    },
    requestApproval: (request) =>
      new Promise<HITLResponse>((resolve) => {
        pendingApprovals.set(runId, resolve);
        send({ type: "approval", runId, request: toWireRequest(request) });
      }),
    onDrain: () => send({ type: "drain" }),
  };

  try {
    const result = await runAgentTask(agent, prompt, threadId, callbacks, controller.signal);
    if (result.error) {
      send({ type: "done", cancelled: false, error: result.error.message });
    } else if (result.cancelled) {
      send({ type: "done", cancelled: true });
    } else {
      let rememberedNotes = 0;
      if (result.messages) {
        rememberedNotes = await consolidateMemory(model, result.messages).catch(() => 0);
      }
      send({ type: "done", cancelled: false, rememberedNotes });
    }
  } finally {
    pendingApprovals.delete(runId);
    if (active?.runId === runId) active = null;
  }
}

export function resolveApproval(runId: string, decision: HITLResponseWire): void {
  const resolve = pendingApprovals.get(runId);
  if (!resolve) return;
  pendingApprovals.delete(runId);
  resolve(toHITLResponse(decision));
}

export function cancel(): void {
  if (!active) return;
  const { runId, controller } = active;
  const resolve = pendingApprovals.get(runId);
  if (resolve) {
    pendingApprovals.delete(runId);
    resolve({
      decisions: (pendingApprovals.size >= 0 ? [] : []).length
        ? []
        : [],
    });
  }
  controller.abort();
}

export function getAppInfo(): AppInfo {
  return {
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    workspaceDir: cfg.workspaceDir,
    memfs: cfg.memfs,
    yolo: cfg.yolo,
  };
}