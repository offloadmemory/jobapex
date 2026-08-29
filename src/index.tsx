/**
 * Entry point for the Ink REPL. Owns all wiring (config, agent, checkpointer,
 * history) and the slash commands; the React tree is pure presentation over
 * UIStore.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { useState } from "react";
import type { HITLRequest, HITLResponse } from "langchain";
import { render } from "ink";
import { ChatOllama } from "@langchain/ollama";
import { loadConfig } from "./config.js";
import { buildAgent } from "./agent.js";
import { runAgentTask, type TaskCallbacks } from "./agent-runner.js";
import { createCheckpointer } from "./persistence.js";
import { consolidateMemory } from "./memory/consolidate.js";
import { listNotes, searchNotes } from "./memory/store.js";
import { agentHomeDir, skillsDir } from "./paths.js";
import { UIStore } from "./ui/store.js";
import { App } from "./ui/App.js";
import { matchThreadPrefix } from "./ui/resume.js";

// Ruling 4: no TTY, no UI — fail fast with a plain message.
if (!process.stdout.isTTY || !process.stdin.isTTY) {
  console.error("hermes needs an interactive terminal");
  process.exit(1);
}

const cfg = loadConfig();
const agent = buildAgent(cfg);
const checkpointer = createCheckpointer();
const model = new ChatOllama({ model: cfg.model, baseUrl: cfg.baseUrl, think: false });

const historyFile = path.join(agentHomeDir(), "history");

const TODO_ICON: Record<string, string> = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
};

async function listThreads(): Promise<string[]> {
  const ids = new Set<string>();
  for await (const tuple of checkpointer.list({}, { limit: 100 })) {
    const id = tuple.config.configurable?.thread_id;
    if (id) ids.add(id);
  }
  return [...ids];
}

function listWorkspaceFiles(): string {
  if (cfg.memfs) return "(in-memory mode — files live in agent state; ask the agent to ls)";
  const lines: string[] = [cfg.workspaceDir];
  const walk = (dir: string, prefix = ""): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".git")) continue;
      const rel = path.join(prefix, entry.name);
      lines.push(`  ${entry.isDirectory() ? `${rel}/` : rel}`);
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
    }
  };
  walk(cfg.workspaceDir);
  return lines.join("\n");
}

function Root({ onExit }: { onExit: () => void }) {
  const [threadId, setThreadId] = useState<string>(randomUUID);
  const [history, setHistory] = useState<string[]>(() =>
    fs.existsSync(historyFile)
      ? fs.readFileSync(historyFile, "utf8").split("\n").filter((l) => l.trim())
      : []
  );
  const [inFlight] = useState(() => ({ current: null as AbortController | null }));
  const [store] = useState(() => new UIStore());

  const runTask = async (prompt: string): Promise<void> => {
    const controller = new AbortController();
    inFlight.current = controller;
    store.setStatus("streaming");
    const callbacks: TaskCallbacks = {
      onEvent: (ev) => store.consume(ev),
      requestApproval: (request: HITLRequest): Promise<HITLResponse> =>
        new Promise((resolve) => {
          store.approval = {
            request,
            resolve: (r) => {
              store.approval = null;
              store.setStatus("streaming");
              resolve(r);
            },
          };
          store.setStatus("approval");
        }),
      onDrain: () => store.flushLive(),
    };
    try {
      const result = await runAgentTask(agent, prompt, threadId, callbacks, controller.signal);
      if (result.error) {
        store.addEntry("error", `error: ${result.error.message}`);
        if (/ECONNREFUSED/.test(result.error.message ?? "")) {
          store.addEntry("error", "Is the ollama daemon running? Try: ollama serve");
        }
      } else if (result.cancelled) {
        store.addEntry("system", "task cancelled");
      }
      if (result.messages) {
        const n = await consolidateMemory(model, result.messages).catch(() => 0);
        if (n > 0) store.addEntry("system", `🧠 remembered ${n} note${n === 1 ? "" : "s"}`);
      }
    } finally {
      inFlight.current = null;
      store.flushLive();
      store.setStatus("idle");
    }
  };

  const sys = (text: string): void => store.addEntry("system", text);

  const handleCommand = async (input: string): Promise<void> => {
    if (input === "/exit" || input === "/quit") return onExit();
    if (input === "/reset") {
      setThreadId(randomUUID());
      store.setTodos([]);
      return sys("started a fresh thread");
    }
    if (input === "/todos") {
      return sys(
        store.todos.length
          ? store.todos.map((t) => `  ${TODO_ICON[t.status] ?? "○"} ${t.content}`).join("\n")
          : "no todos yet"
      );
    }
    if (input === "/files") return sys(listWorkspaceFiles());
    // Await inside handleCommand so the call-site catch covers a checkpointer
    // failure here too.
    if (input === "/threads") {
      const ids = await listThreads();
      return sys(ids.length ? ids.map((id) => `  ${id}`).join("\n") : "no saved threads yet");
    }
    if (input.startsWith("/resume ")) {
      const arg = input.slice("/resume ".length).trim();
      if (!arg) return sys("usage: /resume <thread-id>");
      const match = matchThreadPrefix(await listThreads(), arg);
      if (match.kind === "none") return sys(`no thread matches "${arg}"`);
      if (match.kind === "ambiguous") {
        return sys(`ambiguous prefix "${arg}" — ${match.count} threads match; use /threads`);
      }
      setThreadId(match.id);
      return sys(`resumed thread ${match.id}`);
    }
    if (input === "/skills") {
      const dir = skillsDir();
      const names = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "SKILL.md")))
        : [];
      return sys(names.length ? names.map((n) => `  ${n}`).join("\n") : "no skills yet");
    }
    if (input.startsWith("/memory")) {
      const q = input.slice("/memory".length).trim();
      const notes = q ? searchNotes(q) : listNotes();
      return sys(
        notes.length ? notes.map((n) => `  ${n.title} (${n.slug})`).join("\n") : "no memory yet"
      );
    }
    if (input === "/help") {
      return sys(
        "commands: /todos /files /threads /resume <id> /skills /memory [query] /reset /exit"
      );
    }
    return sys("unknown command — /help lists commands");
  };

  const handleSubmit = (input: string): void => {
    fs.appendFileSync(historyFile, `${input}\n`);
    setHistory((h) => [...h, input]);
    // A rejected command (e.g. a checkpointer I/O error in /resume) must not
    // become an unhandled rejection — that would kill the whole REPL.
    if (input.startsWith("/"))
      return void handleCommand(input).catch((e: unknown) =>
        sys(`error: ${(e as Error).message}`)
      );
    store.addEntry("user", input);
    void runTask(input);
  };

  const cancel = (): void => {
    // Settle an open approval first so the gate promise can't dangle.
    if (store.approval) {
      const req = store.approval.request;
      store.approval.resolve({
        decisions: req.actionRequests.map(() => ({
          type: "reject",
          message: "The user cancelled this task.",
        })),
      });
      store.approval = null;
      store.setStatus("streaming");
    }
    inFlight.current?.abort();
  };

  return (
    <App
      store={store}
      model={cfg.model}
      baseUrl={cfg.baseUrl}
      workspaceDir={cfg.workspaceDir}
      memfs={cfg.memfs}
      yolo={cfg.yolo}
      threadId={threadId}
      history={history}
      onSubmit={handleSubmit}
      onCancel={cancel}
      onExit={onExit}
    />
  );
}

// exitOnCtrlC would intercept \x03 before any useInput — the app handles
// Ctrl+C itself (cancel while running, exit while idle).
const instance = render(<Root onExit={exitApp} />, { exitOnCtrlC: false });

function exitApp(): void {
  instance.unmount();
  console.log("\nbye");
  process.exit(0);
}