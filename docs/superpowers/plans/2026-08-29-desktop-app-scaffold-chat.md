# Desktop App — Scaffold + Chat Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Ink terminal UI with an Electron desktop app whose chat surface (assistant-ui) drives the existing LangChain Deep Agent core over typed IPC — streaming transcript, todo panel, and the HITL approval gate all working end-to-end.

**Architecture:** Electron main process runs the Deep Agent in-process (Node); a contextBridge preload exposes a typed `window.hermes` API; the sandboxed React renderer consumes stream events over IPC and renders them through assistant-ui's `useExternalStoreRuntime`. The existing seam (`stream-events.ts` → `agent-runner.ts`) is preserved verbatim; only the consumer changes.

**Tech Stack:** Electron, electron-vite, React 19, Vite, Tailwind, shadcn/ui, assistant-ui (`@assistant-ui/react`), Zod, vitest, TypeScript (NodeNext for main, Bundler for renderer).

**Spec:** `docs/superpowers/specs/2026-08-29-desktop-app-design.md`

## Global Constraints

- Node >= 22 (existing `engines`).
- `contextIsolation: true`, `nodeIntegration: false` — never enable nodeIntegration.
- The seam files `src/main/agent/stream-events.ts` and `src/main/agent/agent-runner.ts` must remain **unchanged** (scripts depend on them).
- Every IPC handler returns a result envelope: `{ ok: true, data } | { ok: false, error: { code, message } }`. No exceptions cross the bridge.
- Storage split (from spec): SQLite for chats/providers/settings; filesystem markdown for skills/memory/identity/OpenWiki; `safeStorage` for keys. This plan touches only the existing `checkpoints.sqlite` + markdown — no new DB yet.
- Providers v1 = Ollama + OpenAI + Anthropic. This plan uses Ollama only (existing `config.ts`); `model-factory` arrives in the providers plan.
- No `TBD`/`TODO`/placeholder code. Every code step is complete.

## File Structure

```
src/
  shared/                      # NEW — types shared across main/preload/renderer
    wire.ts                    # WireEvent, WireMsg, Todo, HITL wire types, Result<T>
    schemas.ts                 # Zod schemas for IPC payloads
  main/
    index.ts                   # NEW — app bootstrap, BrowserWindow, single-instance
    ipc/
      index.ts                 # NEW — registerIpc(): wires all handlers
      chat.ts                  # NEW — chat:run / chat:cancel / chat:resolveApproval
      app.ts                   # NEW — app:getInfo
    agent/                     # MOVED — the existing core, unchanged except config.ts
      agent.ts  agent-runner.ts  stream-events.ts  render.ts  subagents.ts
      config.ts  identity.ts  ollamaShim.ts  paths.ts  persistence.ts
      memory/  skills/  tools/
      runtime.ts               # NEW — runTask/resolveApproval/cancel + toWire conversion
  preload/
    index.ts                   # NEW — contextBridge: window.hermes
  renderer/
    index.html                 # NEW
    src/
      main.tsx                 # NEW — React root
      App.tsx                  # NEW — shell: sidebar + ChatView
      chat/
        ChatView.tsx           # NEW — Thread + composer + todo panel + approval card
        runtime.tsx            # NEW — useExternalStoreRuntime wiring
        ApprovalCard.tsx       # NEW — Shadcn dialog port of the Ink ApprovalCard
        TodoPanel.tsx          # NEW — todo list card
      lib/
        chat-store.ts          # NEW — ChatStore (port of UIStore, consumes WireEvent)
        to-thread-message.ts   # NEW — TranscriptEntry → ThreadMessageLike
        ipc.ts                 # NEW — typed window.hermes accessor
      components/ui/           # NEW — shadcn primitives (generated)
electron.vite.config.ts        # NEW
vitest.config.ts               # NEW
tsconfig.base.json             # NEW (replaces tsconfig.json)
tsconfig.node.json             # NEW
tsconfig.web.json              # NEW
```

**Deleted:** `src/index.tsx`, `src/ui/` (entire), `scripts/ui-test.ts`, `tsconfig.json` (replaced by base), and the `ink` / `ink-testing-library` deps.

---

## Task 1: Restructure source tree + split tsconfigs

**Files:**
- Move: `src/*.ts` and `src/memory/`, `src/skills/`, `src/tools/` → `src/main/agent/` (same relative layout)
- Modify: `src/main/agent/config.ts` (projectRoot fix)
- Modify: every `scripts/*.ts` import `../src/` → `../src/main/agent/`
- Delete: `src/index.tsx`, `src/ui/`, `scripts/ui-test.ts`
- Create: `tsconfig.base.json`, `tsconfig.node.json`, `tsconfig.web.json`
- Delete: `tsconfig.json`
- Modify: `package.json` (scripts)

**Interfaces:**
- Produces: `src/main/agent/*` at their new paths; `npm test` runs typecheck over both node and web configs.

- [ ] **Step 1: Move the core into `src/main/agent/`**

```bash
mkdir -p src/main/agent
git mv src/agent.ts src/agent-runner.ts src/config.ts src/identity.ts src/ollamaShim.ts \
        src/paths.ts src/persistence.ts src/render.ts src/stream-events.ts src/subagents.ts \
        src/main/agent/
git mv src/memory src/skills src/tools src/main/agent/
```

- [ ] **Step 2: Delete the Ink UI and its test**

```bash
git rm -r src/ui src/index.tsx scripts/ui-test.ts
```

- [ ] **Step 3: Fix `projectRoot` in `src/main/agent/config.ts`**

The file computes `projectRoot` as the parent of its own directory. It moved two levels deeper, so the `..` count changes. Edit the line:

```ts
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
```

to:

```ts
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
```

- [ ] **Step 4: Rewrite script imports**

In every `scripts/*.ts` (all except `wiki.sh`), replace the import prefix `../src/` with `../src/main/agent/`. The affected files and their imports are:

- `smoke.ts`, `delegation-test.ts`, `stream-test.ts`, `wiki-test.ts`, `hitl-subagent-test.ts`, `hitl-test.ts`, `gate-dual-check.ts`: `../src/config.js`, `../src/agent.js`, `../src/render.js`
- `runner-test.ts`: `../src/config.js`, `../src/agent.js`, `../src/agent-runner.js`, `../src/stream-events.js`
- `memory-test.ts`: `../src/config.js`, `../src/agent.js`, `../src/memory/consolidate.js`, `../src/memory/store.js`, `../src/memory/tools.js`, `../src/paths.js`
- `skills-test.ts`: `../src/config.js`, `../src/agent.js`, `../src/paths.js`, `../src/skills/tools.js`
- `persistence-test.ts`: `../src/config.js`, `../src/agent.js`, `../src/persistence.js`, `../src/paths.js`

A single `sed` does it:

```bash
sed -i '' 's#"\.\./src/#"../src/main/agent/#g' scripts/*.ts
```

- [ ] **Step 5: Write the three tsconfigs**

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "noEmit": true
  }
}
```

`tsconfig.node.json`:

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"]
  },
  "include": ["src/main/**/*.ts", "src/preload/**/*.ts", "src/shared/**/*.ts", "scripts/**/*.ts"]
}
```

`tsconfig.web.json`:

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src/renderer/src/**/*.ts", "src/renderer/src/**/*.tsx", "src/shared/**/*.ts"]
}
```

```bash
rm tsconfig.json
```

- [ ] **Step 6: Update `package.json` scripts**

Replace the `scripts` block with:

```json
"scripts": {
  "test": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json",
  "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json",
  "smoke": "tsx scripts/smoke.ts",
  "wiki:update": "scripts/wiki.sh --update",
  "wiki:init": "scripts/wiki.sh --init"
}
```

(Remove `start` for now — it returns in Task 2 as `electron-vite dev`.)

- [ ] **Step 7: Remove Ink deps**

```bash
npm uninstall ink react @types/react ink-testing-library
```

- [ ] **Step 8: Verify typecheck passes**

Run: `npm test`
Expected: exit 0, no errors. (The moved core and rewritten scripts typecheck under NodeNext.)

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: move agent core to src/main/agent, drop Ink TUI, split tsconfigs"
```

---

## Task 2: Electron shell (deps, config, window, preload stub, renderer hello)

**Files:**
- Create: `electron.vite.config.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`
- Modify: `package.json` (deps + `main` + scripts)

**Interfaces:**
- Produces: `npm run dev` opens an Electron window rendering the React app; `window.hermes` exists (stub).

- [ ] **Step 1: Install Electron + build tooling**

```bash
npm install -D electron electron-vite vite @vitejs/plugin-react @types/react @types/react-dom
npm install react react-dom
```

- [ ] **Step 2: Write `electron.vite.config.ts`**

```ts
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { "@shared": resolve("src/shared") } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { "@shared": resolve("src/shared") } },
  },
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
        "@shared": resolve("src/shared"),
      },
    },
    plugins: [react()],
  },
});
```

- [ ] **Step 3: Write `src/main/index.ts`**

```ts
import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.on("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
```

- [ ] **Step 4: Write `src/preload/index.ts` (stub)**

```ts
import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("hermes", {
  ping: () => "pong",
});
```

- [ ] **Step 5: Write the renderer entry files**

`src/renderer/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>hermes</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/renderer/src/main.tsx`:

```tsx
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
```

`src/renderer/src/App.tsx`:

```tsx
export function App() {
  return <h1>hermes desktop — hello</h1>;
}
```

- [ ] **Step 6: Point `package.json` `main` at the built output and add scripts**

Set `"main": "out/main/index.js"` and add to `scripts`:

```json
"dev": "electron-vite dev",
"start": "electron-vite dev",
"build": "electron-vite build"
```

- [ ] **Step 7: Verify the window opens**

Run: `npm run dev`
Expected: an Electron window opens showing "hermes desktop — hello". (First run may need `npm install` to finish native deps.)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: electron shell with main/preload/renderer skeleton"
```

---

## Task 3: Shared wire types + Zod schemas + vitest

**Files:**
- Create: `src/shared/wire.ts`, `src/shared/schemas.ts`, `vitest.config.ts`
- Test: `src/shared/schemas.test.ts`
- Modify: `package.json` (vitest dep + `test:unit` script)

**Interfaces:**
- Produces: `WireEvent`, `WireMsg`, `Todo`, `HITLRequestWire`, `HITLResponseWire`, `HITLDecisionWire`, `Result<T>`, `AppInfo`; Zod schemas `chatRunSchema`, `resolveApprovalSchema`, `cancelSchema`.

- [ ] **Step 1: Install vitest**

```bash
npm install -D vitest
```

- [ ] **Step 2: Write `src/shared/wire.ts`**

```ts
export interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface WireToolCall {
  name: string;
  args: unknown;
}

export interface WireMsg {
  type: "ai" | "tool";
  content: string;
  reasoning?: string;
  toolCalls?: WireToolCall[];
  isError?: boolean;
}

export type WireEvent =
  | { type: "token"; depth: number; msg: WireMsg }
  | { type: "update"; depth: number; msg: WireMsg }
  | { type: "todos"; todos: Todo[] }
  | { type: "drain" }
  | { type: "approval"; runId: string; request: HITLRequestWire }
  | { type: "done"; cancelled: boolean; error?: string; rememberedNotes?: number };

export interface HITLActionWire {
  name: string;
  args: Record<string, unknown>;
}

export interface HITLRequestWire {
  actionRequests: HITLActionWire[];
}

export type HITLDecisionWire =
  | { type: "approve" }
  | { type: "reject"; message?: string }
  | { type: "edit"; editedAction: { name: string; args: Record<string, unknown> } };

export interface HITLResponseWire {
  decisions: HITLDecisionWire[];
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export interface AppInfo {
  model: string;
  baseUrl: string;
  workspaceDir: string;
  memfs: boolean;
  yolo: boolean;
}
```

- [ ] **Step 3: Write `src/shared/schemas.ts`**

```ts
import { z } from "zod";

export const chatRunSchema = z.object({
  prompt: z.string().min(1),
  threadId: z.string().min(1),
});

export const cancelSchema = z.object({
  threadId: z.string().min(1),
});

export const resolveApprovalSchema = z.object({
  runId: z.string().min(1),
  decision: z.object({
    decisions: z.array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("approve") }),
        z.object({ type: z.literal("reject"), message: z.string().optional() }),
        z.object({
          type: z.literal("edit"),
          editedAction: z.object({
            name: z.string(),
            args: z.record(z.string(), z.unknown()),
          }),
        }),
      ])
    ),
  }),
});
```

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@shared": resolve("src/shared") },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
```

- [ ] **Step 5: Write the failing test `src/shared/schemas.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { chatRunSchema, resolveApprovalSchema } from "./schemas";

describe("chatRunSchema", () => {
  it("accepts a valid run request", () => {
    const r = chatRunSchema.safeParse({ prompt: "hi", threadId: "t1" });
    expect(r.success).toBe(true);
  });

  it("rejects an empty prompt", () => {
    const r = chatRunSchema.safeParse({ prompt: "", threadId: "t1" });
    expect(r.success).toBe(false);
  });
});

describe("resolveApprovalSchema", () => {
  it("accepts an approve decision", () => {
    const r = resolveApprovalSchema.safeParse({
      runId: "r1",
      decision: { decisions: [{ type: "approve" }] },
    });
    expect(r.success).toBe(true);
  });

  it("accepts an edit decision", () => {
    const r = resolveApprovalSchema.safeParse({
      runId: "r1",
      decision: {
        decisions: [
          { type: "edit", editedAction: { name: "execute", args: { command: "ls" } } },
        ],
      },
    });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run`
Expected: 4 tests pass.

- [ ] **Step 7: Add the `test:unit` script and commit**

Add to `package.json` scripts: `"test:unit": "vitest run"`.

```bash
git add -A
git commit -m "feat: shared wire types + zod schemas + vitest"
```

---

## Task 4: Main agent runtime service

**Files:**
- Create: `src/main/agent/runtime.ts`
- Test: `src/main/agent/runtime.test.ts` (unit, no model — tests `toWireEvents`)

**Interfaces:**
- Consumes: `buildAgent` (`src/main/agent/agent.ts`), `runAgentTask` + `TaskCallbacks` (`src/main/agent/agent-runner.ts`), `StreamEvent`/`contentToString` (`src/main/agent/stream-events.ts`), `consolidateMemory` (`src/main/agent/memory/consolidate.ts`), `loadConfig` (`src/main/agent/config.ts`), `WireEvent`/`WireMsg`/`Todo`/`HITLRequestWire`/`HITLResponseWire` (`@shared/wire`).
- Produces: `runTask(prompt, threadId, send, signal)`, `resolveApproval(runId, decision)`, `cancel()`, `getAppInfo()`, and `toWireEvents(ev)` (exported for tests).

- [ ] **Step 1: Write the failing test `src/main/agent/runtime.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { toWireEvents } from "./runtime";
import type { StreamEvent } from "./stream-events";

describe("toWireEvents", () => {
  it("converts an ai token event", () => {
    const ev: StreamEvent = {
      kind: "token",
      depth: 0,
      msg: {
        getType: () => "ai",
        content: "hello",
        additional_kwargs: { reasoning_content: "thinking..." },
      } as any,
    };
    const out = toWireEvents(ev);
    expect(out).toEqual([
      { type: "token", depth: 0, msg: { type: "ai", content: "hello", reasoning: "thinking..." } },
    ]);
  });

  it("converts an ai update with tool calls", () => {
    const ev: StreamEvent = {
      kind: "update",
      depth: 0,
      update: {
        model: {
          messages: [
            {
              getType: () => "ai",
              content: "",
              tool_calls: [{ name: "write_file", args: { path: "/a.txt" } }],
            },
          ],
        },
      },
    };
    const out = toWireEvents(ev);
    expect(out).toEqual([
      {
        type: "update",
        depth: 0,
        msg: {
          type: "ai",
          content: "",
          toolCalls: [{ name: "write_file", args: { path: "/a.txt" } }],
        },
      },
    ]);
  });

  it("emits a todos event from a node update", () => {
    const ev: StreamEvent = {
      kind: "update",
      depth: 0,
      update: {
        model: { todos: [{ content: "do it", status: "in_progress" }] },
      },
    };
    const out = toWireEvents(ev);
    expect(out).toEqual([
      { type: "todos", todos: [{ content: "do it", status: "in_progress" }] },
    ]);
  });

  it("skips __interrupt__ keys", () => {
    const ev: StreamEvent = {
      kind: "update",
      depth: 0,
      update: { __interrupt__: [{ value: {} }] },
    };
    expect(toWireEvents(ev)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/agent/runtime.test.ts`
Expected: FAIL — `Cannot find module './runtime'`.

- [ ] **Step 3: Write `src/main/agent/runtime.ts`**

```ts
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
```

> **Note on `cancel()`:** the reject-all-on-cancel needs the pending request's actionRequests to build reject decisions. The runtime stores the request alongside the resolver (see Task 5's refinement below). Replace the `resolve({ decisions: [] })` body in `cancel()` with the version in Task 5 Step 3, which rejects every actionRequest.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/agent/runtime.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: main agent runtime service with wire conversion"
```

---

## Task 5: IPC handlers + preload bridge

**Files:**
- Create: `src/main/ipc/index.ts`, `src/main/ipc/chat.ts`, `src/main/ipc/app.ts`
- Modify: `src/main/index.ts` (call `registerIpc()`)
- Modify: `src/main/agent/runtime.ts` (store the pending request for reject-all-on-cancel)
- Rewrite: `src/preload/index.ts`
- Create: `src/renderer/src/lib/ipc.ts`

**Interfaces:**
- Consumes: `runTask`/`resolveApproval`/`cancel`/`getAppInfo` (`src/main/agent/runtime.ts`), `chatRunSchema`/`cancelSchema`/`resolveApprovalSchema` (`@shared/schemas`), `WireEvent`/`Result`/`AppInfo` (`@shared/wire`).
- Produces: `window.hermes` with `chat.run`, `chat.cancel`, `chat.resolveApproval`, `app.getInfo`, `onEvent`.

- [ ] **Step 1: Refine `cancel()` in `src/main/agent/runtime.ts` to reject-all**

Store the request with the resolver. Change the `pendingApprovals` map value type and the two sites:

```ts
const pendingApprovals = new Map<string, { request: HITLRequest; resolve: (r: HITLResponse) => void }>();
```

In `requestApproval`:

```ts
requestApproval: (request) =>
  new Promise<HITLResponse>((resolve) => {
    pendingApprovals.set(runId, { request, resolve });
    send({ type: "approval", runId, request: toWireRequest(request) });
  }),
```

In `resolveApproval`:

```ts
export function resolveApproval(runId: string, decision: HITLResponseWire): void {
  const entry = pendingApprovals.get(runId);
  if (!entry) return;
  pendingApprovals.delete(runId);
  entry.resolve(toHITLResponse(decision));
}
```

Replace `cancel()`:

```ts
export function cancel(): void {
  if (!active) return;
  const { runId, controller } = active;
  const entry = pendingApprovals.get(runId);
  if (entry) {
    pendingApprovals.delete(runId);
    entry.resolve({
      decisions: entry.request.actionRequests.map(() => ({
        type: "reject",
        message: "The user cancelled this task.",
      })),
    });
  }
  controller.abort();
}
```

- [ ] **Step 2: Write `src/main/ipc/chat.ts`**

```ts
import { ipcMain, BrowserWindow } from "electron";
import { chatRunSchema, cancelSchema, resolveApprovalSchema } from "@shared/schemas";
import type { Result, WireEvent } from "@shared/wire";
import { runTask, resolveApproval, cancel } from "../agent/runtime.js";

function sendToAll(ev: WireEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("chat:event", ev);
  }
}

export function registerChatIpc(): void {
  ipcMain.handle("chat:run", async (_e, raw: unknown): Promise<Result<{ runId: string }>> => {
    const parsed = chatRunSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    const { prompt, threadId } = parsed.data;
    void runTask(prompt, threadId, sendToAll);
    return { ok: true, data: { runId: threadId } };
  });

  ipcMain.handle("chat:cancel", async (_e, raw: unknown): Promise<Result<null>> => {
    const parsed = cancelSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
    }
    cancel();
    return { ok: true, data: null };
  });

  ipcMain.handle(
    "chat:resolveApproval",
    async (_e, raw: unknown): Promise<Result<null>> => {
      const parsed = resolveApprovalSchema.safeParse(raw);
      if (!parsed.success) {
        return { ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } };
      }
      resolveApproval(parsed.data.runId, parsed.data.decision);
      return { ok: true, data: null };
    }
  );
}
```

- [ ] **Step 3: Write `src/main/ipc/app.ts`**

```ts
import { ipcMain } from "electron";
import type { AppInfo, Result } from "@shared/wire";
import { getAppInfo } from "../agent/runtime.js";

export function registerAppIpc(): void {
  ipcMain.handle("app:getInfo", async (): Promise<Result<AppInfo>> => {
    return { ok: true, data: getAppInfo() };
  });
}
```

- [ ] **Step 4: Write `src/main/ipc/index.ts`**

```ts
import { registerChatIpc } from "./chat.js";
import { registerAppIpc } from "./app.js";

export function registerIpc(): void {
  registerChatIpc();
  registerAppIpc();
}
```

- [ ] **Step 5: Wire `registerIpc()` into `src/main/index.ts`**

Add the import and call inside `app.whenReady()`:

```ts
import { registerIpc } from "./ipc/index.js";
// ...
app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
```

- [ ] **Step 6: Rewrite `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from "electron";
import type { AppInfo, HITLResponseWire, Result, WireEvent } from "@shared/wire";

export interface HermesApi {
  chat: {
    run(req: { prompt: string; threadId: string }): Promise<Result<{ runId: string }>>;
    cancel(threadId: string): Promise<Result<null>>;
    resolveApproval(runId: string, decision: HITLResponseWire): Promise<Result<null>>;
  };
  app: {
    getInfo(): Promise<Result<AppInfo>>;
  };
  onEvent(cb: (ev: WireEvent) => void): () => void;
}

const api: HermesApi = {
  chat: {
    run: (req) => ipcRenderer.invoke("chat:run", req),
    cancel: (threadId) => ipcRenderer.invoke("chat:cancel", { threadId }),
    resolveApproval: (runId, decision) =>
      ipcRenderer.invoke("chat:resolveApproval", { runId, decision }),
  },
  app: {
    getInfo: () => ipcRenderer.invoke("app:getInfo"),
  },
  onEvent: (cb) => {
    const listener = (_e: unknown, ev: WireEvent) => cb(ev);
    ipcRenderer.on("chat:event", listener);
    return () => ipcRenderer.removeListener("chat:event", listener);
  },
};

contextBridge.exposeInMainWorld("hermes", api);
```

- [ ] **Step 7: Write `src/renderer/src/lib/ipc.ts`**

```ts
import type { HermesApi } from "../../../preload/index.js";

declare global {
  interface Window {
    hermes: HermesApi;
  }
}

export const hermes: HermesApi = window.hermes;
```

- [ ] **Step 8: Verify typecheck**

Run: `npm test`
Expected: exit 0. (The preload's `HermesApi` is imported by the renderer via a relative path — both are in the node/web tsconfig include sets, so the type resolves.)

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: typed IPC handlers + preload bridge"
```

---

## Task 6: Renderer scaffold (Tailwind + shadcn + assistant-ui + shell)

**Files:**
- Create: `tailwind.config.ts`, `postcss.config.js`, `components.json`, `src/renderer/src/index.css`
- Modify: `src/renderer/src/main.tsx` (import CSS), `src/renderer/src/App.tsx` (shell)
- Create: `src/renderer/src/components/ui/*` (generated by shadcn)

**Interfaces:**
- Produces: a styled app shell (sidebar + chat area) with shadcn primitives and assistant-ui installed.

- [ ] **Step 1: Install Tailwind + shadcn deps**

```bash
npm install -D tailwindcss postcss autoprefixer tailwindcss-animate
npm install class-variance-authority clsx tailwind-merge lucide-react
```

- [ ] **Step 2: Write `tailwind.config.ts`**

```ts
import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./src/renderer/index.html", "./src/renderer/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
```

- [ ] **Step 3: Write `postcss.config.js`**

```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 4: Write `src/renderer/src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 240 10% 3.9%;
    --card: 0 0% 100%;
    --card-foreground: 240 10% 3.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 240 10% 3.9%;
    --primary: 240 5.9% 10%;
    --primary-foreground: 0 0% 98%;
    --secondary: 240 4.8% 95.9%;
    --secondary-foreground: 240 5.9% 10%;
    --muted: 240 4.8% 95.9%;
    --muted-foreground: 240 3.8% 46.1%;
    --accent: 240 4.8% 95.9%;
    --accent-foreground: 240 5.9% 10%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 0 0% 98%;
    --border: 240 5.9% 90%;
    --input: 240 5.9% 90%;
    --ring: 240 5.9% 10%;
    --radius: 0.5rem;
  }
  .dark {
    --background: 240 10% 3.9%;
    --foreground: 0 0% 98%;
    --card: 240 10% 3.9%;
    --card-foreground: 0 0% 98%;
    --popover: 240 10% 3.9%;
    --popover-foreground: 0 0% 98%;
    --primary: 0 0% 98%;
    --primary-foreground: 240 5.9% 10%;
    --secondary: 240 3.7% 15.9%;
    --secondary-foreground: 0 0% 98%;
    --muted: 240 3.7% 15.9%;
    --muted-foreground: 240 5% 64.9%;
    --accent: 240 3.7% 15.9%;
    --accent-foreground: 0 0% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 0 0% 98%;
    --border: 240 3.7% 15.9%;
    --input: 240 3.7% 15.9%;
    --ring: 240 4.9% 83.9%;
  }
}
```

- [ ] **Step 5: Init shadcn**

```bash
npx shadcn@latest init -d
```

Accept the defaults (base color neutral, CSS variables). This writes `components.json` and `src/renderer/src/lib/utils.ts`.

- [ ] **Step 6: Add shadcn primitives**

```bash
npx shadcn@latest add button card dialog input textarea scroll-area separator tooltip badge
```

- [ ] **Step 7: Install assistant-ui**

```bash
npm install @assistant-ui/react @assistant-ui/react-markdown remark-gfm tw-shimmer zustand
```

Add the assistant-ui registry to `components.json` (under the top-level `registries` key):

```json
"registries": {
  "@assistant-ui": "https://r.assistant-ui.com/styles/{style}/{name}.json"
}
```

Then add the thread components:

```bash
npx shadcn@latest add @assistant-ui/thread
```

- [ ] **Step 8: Write the app shell `src/renderer/src/App.tsx`**

```tsx
import { useState } from "react";
import { ChatView } from "./chat/ChatView";

const NAV = [
  { id: "chat", label: "Chat" },
  { id: "threads", label: "Threads", disabled: true },
  { id: "skills", label: "Skills", disabled: true },
  { id: "memory", label: "Memory", disabled: true },
  { id: "settings", label: "Settings", disabled: true },
] as const;

export function App() {
  const [active, setActive] = useState<string>("chat");
  return (
    <div className="flex h-screen">
      <aside className="w-56 border-r bg-muted/30 p-3 flex flex-col gap-1">
        <div className="px-2 py-3 text-sm font-semibold">✻ hermes</div>
        {NAV.map((item) => (
          <button
            key={item.id}
            disabled={item.disabled}
            onClick={() => setActive(item.id)}
            className={`rounded-md px-3 py-2 text-left text-sm ${
              active === item.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            } ${item.disabled ? "opacity-40 cursor-not-allowed" : ""}`}
          >
            {item.label}
          </button>
        ))}
      </aside>
      <main className="flex-1 min-w-0">{active === "chat" ? <ChatView /> : null}</main>
    </div>
  );
}
```

- [ ] **Step 9: Stub `src/renderer/src/chat/ChatView.tsx` (replaced in Task 8)**

```tsx
export function ChatView() {
  return <div className="p-4 text-muted-foreground">chat coming in Task 8</div>;
}
```

- [ ] **Step 10: Import CSS in `src/renderer/src/main.tsx`**

Add `import "./index.css";` as the first line.

- [ ] **Step 11: Verify the shell renders**

Run: `npm run dev`
Expected: window shows the sidebar (Chat active, others disabled) and the "chat coming in Task 8" placeholder.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: renderer shell with tailwind + shadcn + assistant-ui"
```

---

## Task 7: ChatStore + message conversion (vitest)

**Files:**
- Create: `src/renderer/src/lib/chat-store.ts`, `src/renderer/src/lib/to-thread-message.ts`
- Test: `src/renderer/src/lib/chat-store.test.ts`, `src/renderer/src/lib/to-thread-message.test.ts`

**Interfaces:**
- Consumes: `WireEvent`/`WireMsg`/`Todo`/`HITLRequestWire` (`@shared/wire`).
- Produces: `ChatStore` (class with `entries`, `todos`, `status`, `live`, `approval`, `subscribe`, `getSnapshot`, `consume`, `addEntry`, `setTodos`, `setStatus`, `flushLive`, `clearApproval`), `TranscriptEntry`, `EntryKind`, `Status`, and `toThreadMessage(entry)`.

- [ ] **Step 1: Write the failing test `src/renderer/src/lib/chat-store.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { ChatStore } from "./chat-store";
import type { WireEvent } from "@shared/wire";

function storeWith(events: WireEvent[]): ChatStore {
  const s = new ChatStore();
  for (const e of events) s.consume(e);
  return s;
}

describe("ChatStore", () => {
  it("accumulates streamed ai text into live", () => {
    const s = storeWith([
      { type: "token", depth: 0, msg: { type: "ai", content: "hel", reasoning: "" } },
      { type: "token", depth: 0, msg: { type: "ai", content: "lo", reasoning: "" } },
    ]);
    expect(s.live?.text).toBe("hello");
  });

  it("flushes live into an assistant entry on drain", () => {
    const s = storeWith([
      { type: "token", depth: 0, msg: { type: "ai", content: "hi", reasoning: "think" } },
      { type: "drain" },
    ]);
    expect(s.live).toBeNull();
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0]).toMatchObject({ kind: "assistant", text: "hi", thinking: "think" });
  });

  it("records tool calls and results", () => {
    const s = storeWith([
      {
        type: "update",
        depth: 0,
        msg: { type: "ai", content: "", toolCalls: [{ name: "write_file", args: { path: "/a" } }] },
      },
      { type: "update", depth: 0, msg: { type: "tool", content: "wrote /a", isError: false } },
    ]);
    expect(s.entries.map((e) => e.kind)).toEqual(["tool", "toolResult"]);
  });

  it("sets approval state on an approval event", () => {
    const s = storeWith([
      {
        type: "approval",
        runId: "r1",
        request: { actionRequests: [{ name: "execute", args: { command: "ls" } }] },
      },
    ]);
    expect(s.status).toBe("approval");
    expect(s.approval?.runId).toBe("r1");
  });

  it("updates todos from a todos event", () => {
    const s = storeWith([{ type: "todos", todos: [{ content: "x", status: "pending" }] }]);
    expect(s.todos).toEqual([{ content: "x", status: "pending" }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/lib/chat-store.test.ts`
Expected: FAIL — `Cannot find module './chat-store'`.

- [ ] **Step 3: Write `src/renderer/src/lib/chat-store.ts`**

```ts
import type { HITLRequestWire, Todo, WireEvent, WireMsg } from "@shared/wire";

export type EntryKind =
  | "user"
  | "assistant"
  | "thinking"
  | "tool"
  | "toolResult"
  | "delegate"
  | "system"
  | "error";

export interface TranscriptEntry {
  id: number;
  kind: EntryKind;
  text: string;
  depth: number;
  thinking?: string;
  isError?: boolean;
}

export type Status = "idle" | "streaming" | "approval";

export interface ApprovalState {
  runId: string;
  request: HITLRequestWire;
}

export class ChatStore {
  entries: TranscriptEntry[] = [];
  todos: Todo[] = [];
  status: Status = "idle";
  live: { thinking: string; text: string; depth: number } | null = null;
  approval: ApprovalState | null = null;
  private version = 0;
  private listeners = new Set<() => void>();
  private nextId = 1;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): number => this.version;

  private emit(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  addEntry(kind: EntryKind, text: string, depth = 0, isError = false): void {
    this.entries = [
      ...this.entries,
      { id: this.nextId++, kind, text, depth, ...(isError ? { isError: true } : {}) },
    ];
    this.emit();
  }

  setTodos(todos: Todo[]): void {
    this.todos = todos;
    this.emit();
  }

  setStatus(s: Status): void {
    if (this.status === s) return;
    this.status = s;
    this.emit();
  }

  clearApproval(): void {
    this.approval = null;
    this.emit();
  }

  consume(ev: WireEvent): void {
    switch (ev.type) {
      case "token":
        this.consumeToken(ev.msg, ev.depth);
        break;
      case "update":
        this.consumeUpdate(ev.msg, ev.depth);
        break;
      case "todos":
        this.setTodos(ev.todos);
        break;
      case "drain":
        this.flushLive();
        break;
      case "approval":
        this.approval = { runId: ev.runId, request: ev.request };
        this.setStatus("approval");
        break;
      case "done":
        this.flushLive();
        this.setStatus("idle");
        break;
    }
  }

  private consumeToken(msg: WireMsg, depth: number): void {
    if (msg.type !== "ai") return;
    if (!msg.reasoning && !msg.content) return;
    if (!this.live) this.live = { thinking: "", text: "", depth };
    if (this.live.depth !== depth) {
      this.flushLive();
      this.live = { thinking: "", text: "", depth };
    }
    if (msg.reasoning) this.live.thinking += msg.reasoning;
    if (msg.content) this.live.text += msg.content;
    this.emit();
  }

  private consumeUpdate(msg: WireMsg, depth: number): void {
    if (msg.type === "ai") {
      const toolCalls = msg.toolCalls ?? [];
      if (toolCalls.length > 0) {
        this.flushLive();
        for (const tc of toolCalls) {
          if (tc.name === "write_todos") continue;
          if (tc.name === "task") {
            const args = tc.args as { subagent_type?: string; description?: string };
            this.addEntry(
              "delegate",
              `delegate → ${args.subagent_type ?? "general-purpose"} — ${String(args.description ?? "")}`,
              depth
            );
          } else {
            this.addEntry("tool", `${tc.name} ${JSON.stringify(tc.args ?? {})}`, depth);
          }
        }
      }
    } else if (msg.type === "tool") {
      this.flushLive();
      if (msg.content.startsWith("Updated todo list")) return;
      this.addEntry("toolResult", msg.content, depth, msg.isError);
    }
  }

  flushLive(): void {
    if (!this.live) return;
    const { thinking, text, depth } = this.live;
    this.live = null;
    if (thinking.trim() || text.trim()) {
      this.entries = [
        ...this.entries,
        {
          id: this.nextId++,
          kind: "assistant",
          text: text.trim(),
          depth,
          ...(thinking.trim() ? { thinking: thinking.trim() } : {}),
        },
      ];
      this.emit();
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/lib/chat-store.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Write the failing test `src/renderer/src/lib/to-thread-message.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { toThreadMessage } from "./to-thread-message";
import type { TranscriptEntry } from "./chat-store";

describe("toThreadMessage", () => {
  it("maps a user entry to a user message", () => {
    const e: TranscriptEntry = { id: 1, kind: "user", text: "hi", depth: 0 };
    expect(toThreadMessage(e)).toEqual({ role: "user", content: [{ type: "text", text: "hi" }] });
  });

  it("maps an assistant entry with thinking to reasoning + text parts", () => {
    const e: TranscriptEntry = { id: 2, kind: "assistant", text: "answer", thinking: "reason", depth: 0 };
    expect(toThreadMessage(e)).toEqual({
      role: "assistant",
      content: [
        { type: "reasoning", text: "reason" },
        { type: "text", text: "answer" },
      ],
    });
  });

  it("maps a tool entry to a prefixed text part", () => {
    const e: TranscriptEntry = { id: 3, kind: "tool", text: "write_file {}", depth: 0 };
    expect(toThreadMessage(e)).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "🔧 write_file {}" }],
    });
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/lib/to-thread-message.test.ts`
Expected: FAIL — `Cannot find module './to-thread-message'`.

- [ ] **Step 7: Write `src/renderer/src/lib/to-thread-message.ts`**

```ts
import type { ThreadMessageLike } from "@assistant-ui/react";
import type { TranscriptEntry } from "./chat-store";

export function toThreadMessage(entry: TranscriptEntry): ThreadMessageLike {
  switch (entry.kind) {
    case "user":
      return { role: "user", content: [{ type: "text", text: entry.text }] };
    case "system":
      return { role: "system", content: [{ type: "text", text: entry.text }] };
    case "assistant": {
      const parts: ThreadMessageLike["content"] = [];
      if (entry.thinking) parts.push({ type: "reasoning", text: entry.thinking });
      if (entry.text) parts.push({ type: "text", text: entry.text });
      return { role: "assistant", content: parts };
    }
    case "thinking":
      return { role: "assistant", content: [{ type: "reasoning", text: entry.text }] };
    case "tool":
      return { role: "assistant", content: [{ type: "text", text: `🔧 ${entry.text}` }] };
    case "toolResult":
      return { role: "assistant", content: [{ type: "text", text: `↳ ${entry.text}` }] };
    case "delegate":
      return { role: "assistant", content: [{ type: "text", text: `🤖 ${entry.text}` }] };
    case "error":
      return { role: "assistant", content: [{ type: "text", text: `⚠ ${entry.text}` }] };
  }
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/lib/to-thread-message.test.ts`
Expected: 3 tests pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: ChatStore + thread-message conversion with unit tests"
```

---

## Task 8: Chat runtime adapter + ChatView

**Files:**
- Create: `src/renderer/src/chat/runtime.tsx`, `src/renderer/src/chat/TodoPanel.tsx`
- Rewrite: `src/renderer/src/chat/ChatView.tsx`

**Interfaces:**
- Consumes: `ChatStore`/`TranscriptEntry` (`lib/chat-store`), `toThreadMessage` (`lib/to-thread-message`), `hermes` (`lib/ipc`), `useExternalStoreRuntime`/`AssistantRuntimeProvider`/`Thread`/`ThreadPrimitive` (`@assistant-ui/react`).
- Produces: `ChatRuntimeProvider` (wraps children in the runtime), `ChatView` (full chat screen).

- [ ] **Step 1: Write `src/renderer/src/chat/runtime.tsx`**

```tsx
import { useSyncExternalStore } from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import type { ReactNode } from "react";
import { ChatStore, type TranscriptEntry } from "../lib/chat-store";
import { toThreadMessage } from "../lib/to-thread-message";
import { hermes } from "../lib/ipc";

function textOf(message: ThreadMessageLike): string {
  return message.content
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("");
}

function useChatState(store: ChatStore) {
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  const live = store.live;
  const liveEntry: TranscriptEntry | null = live
    ? { id: -1, kind: "assistant", text: live.text, depth: live.depth, thinking: live.thinking }
    : null;
  return {
    messages: liveEntry ? [...store.entries, liveEntry] : store.entries,
    status: store.status,
  };
}

export function ChatRuntimeProvider({
  store,
  threadId,
  children,
}: {
  store: ChatStore;
  threadId: string;
  children: ReactNode;
}) {
  const { messages, status } = useChatState(store);

  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: status === "streaming",
    onNew: (message) => {
      const text = textOf(message);
      if (!text.trim()) return;
      store.addEntry("user", text);
      store.setStatus("streaming");
      void hermes.chat.run({ prompt: text, threadId });
    },
    onCancel: () => {
      void hermes.chat.cancel(threadId);
    },
    convertMessage: toThreadMessage,
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
```

- [ ] **Step 2: Write `src/renderer/src/chat/TodoPanel.tsx`**

```tsx
import type { Todo } from "@shared/wire";

const ICON: Record<Todo["status"], string> = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
};

export function TodoPanel({ todos }: { todos: Todo[] }) {
  if (todos.length === 0) return null;
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-2 text-sm font-semibold">📋 plan</div>
      <ul className="space-y-1 text-sm">
        {todos.map((t, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-muted-foreground">{ICON[t.status]}</span>
            <span className={t.status === "completed" ? "line-through text-muted-foreground" : ""}>
              {t.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Write `src/renderer/src/chat/ChatView.tsx`**

```tsx
import { useEffect, useMemo, useState } from "react";
import { Thread } from "@assistant-ui/react";
import { ChatStore } from "../lib/chat-store";
import { hermes } from "../lib/ipc";
import { ChatRuntimeProvider } from "./runtime";
import { TodoPanel } from "./TodoPanel";
import { ApprovalCard } from "./ApprovalCard";

export function ChatView() {
  const [store] = useState(() => new ChatStore());
  const [threadId, setThreadId] = useState(() => crypto.randomUUID());
  const [info, setInfo] = useState<{ model: string; baseUrl: string } | null>(null);

  useEffect(() => {
    void hermes.app.getInfo().then((r) => {
      if (r.ok) setInfo(r.data);
    });
    return hermes.onEvent((ev) => store.consume(ev));
  }, [store]);

  const runtime = useMemo(
    () => (
      <ChatRuntimeProvider store={store} threadId={threadId}>
        <div className="flex h-full flex-col">
          <header className="flex items-center justify-between border-b px-4 py-2 text-sm text-muted-foreground">
            <span>
              {info ? `${info.model} (via ${info.baseUrl})` : "loading…"}
            </span>
            <button
              className="rounded-md px-2 py-1 hover:bg-muted"
              onClick={() => {
                setThreadId(crypto.randomUUID());
                store.entries = [];
                store.todos = [];
                store.setStatus("idle");
              }}
            >
              New thread
            </button>
          </header>
          <div className="flex-1 min-h-0 overflow-hidden">
            <Thread />
          </div>
          <div className="border-t p-3">
            <TodoPanel todos={store.todos} />
          </div>
          <ApprovalCard store={store} />
        </div>
      </ChatRuntimeProvider>
    ),
    [store, threadId, info]
  );

  return runtime;
}
```

- [ ] **Step 4: Stub `src/renderer/src/chat/ApprovalCard.tsx` (replaced in Task 9)**

```tsx
import type { ChatStore } from "../lib/chat-store";

export function ApprovalCard({ store }: { store: ChatStore }) {
  return null;
}
```

- [ ] **Step 5: Verify typecheck**

Run: `npm test`
Expected: exit 0.

- [ ] **Step 6: Manual smoke — send a task**

Run: `npm run dev` (with Ollama running), type "Say hello in one word" and submit.
Expected: the assistant's streamed answer appears in the thread; the header shows the model.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: assistant-ui chat runtime + ChatView + todo panel"
```

---

## Task 9: Approval card + resolveApproval wiring

**Files:**
- Rewrite: `src/renderer/src/chat/ApprovalCard.tsx`

**Interfaces:**
- Consumes: `ChatStore`/`ApprovalState` (`lib/chat-store`), `hermes` (`lib/ipc`), `HITLDecisionWire` (`@shared/wire`), shadcn `Dialog`/`Button`/`Input`/`Textarea`.
- Produces: `ApprovalCard` — a dialog that renders the pending action, collects a decision, and calls `hermes.chat.resolveApproval`.

- [ ] **Step 1: Write `src/renderer/src/chat/ApprovalCard.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import type { HITLDecisionWire } from "@shared/wire";
import type { ChatStore } from "../lib/chat-store";
import { hermes } from "../lib/ipc";

type Mode = "choose" | "reject" | "edit";
const DEFAULT_REJECT = "The user declined this command.";

export function ApprovalCard({ store }: { store: ChatStore }) {
  const approval = store.approval;
  const [index, setIndex] = useState(0);
  const [decisions, setDecisions] = useState<HITLDecisionWire[]>([]);
  const [mode, setMode] = useState<Mode>("choose");
  const [input, setInput] = useState("");

  useEffect(() => {
    setIndex(0);
    setDecisions([]);
    setMode("choose");
    setInput("");
  }, [approval]);

  const actions = approval?.request.actionRequests ?? [];
  const action = actions[index];

  const resolve = (all: HITLDecisionWire[]) => {
    if (!approval) return;
    void hermes.chat.resolveApproval(approval.runId, { decisions: all });
    store.clearApproval();
    store.setStatus("streaming");
  };

  const approve = () => {
    const all = [...decisions, { type: "approve" } as HITLDecisionWire];
    if (all.length >= actions.length) resolve(all);
    else {
      setDecisions(all);
      setIndex(index + 1);
      setMode("choose");
      setInput("");
    }
  };

  const approveAll = () => {
    const all = [...decisions, ...actions.slice(index).map(() => ({ type: "approve" } as HITLDecisionWire))];
    resolve(all);
  };

  const submitRejectOrEdit = () => {
    const decision: HITLDecisionWire =
      mode === "edit"
        ? { type: "edit", editedAction: { name: action.name, args: { ...action.args, command: input } } }
        : { type: "reject", message: input.trim() || DEFAULT_REJECT };
    const all = [...decisions, decision];
    if (all.length >= actions.length) resolve(all);
    else {
      setDecisions(all);
      setIndex(index + 1);
      setMode("choose");
      setInput("");
    }
  };

  if (!approval || !action) return null;
  const canEdit = action.name === "execute";
  const detail =
    action.name === "execute" ? String(action.args.command ?? "") : JSON.stringify(action.args);

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>⚠ approval needed — agent wants to run</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{action.name}</span>{" "}
            <span className="font-mono text-xs">{detail}</span>
          </DialogDescription>
        </DialogHeader>

        {mode === "choose" ? (
          <DialogFooter className="gap-2">
            {actions.length - index > 1 && (
              <Button variant="outline" onClick={approveAll}>
                Allow all remaining ({actions.length - index})
              </Button>
            )}
            <Button variant="outline" onClick={() => { setMode("reject"); setInput(""); }}>
              Reject
            </Button>
            {canEdit && (
              <Button variant="outline" onClick={() => { setMode("edit"); setInput(String(action.args.command ?? "")); }}>
                Edit command
              </Button>
            )}
            <Button onClick={approve}>Approve</Button>
          </DialogFooter>
        ) : (
          <DialogFooter className="flex-col items-stretch gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={mode === "edit" ? "new command" : "tell the agent why (optional)"}
              onKeyDown={(e) => e.key === "Enter" && submitRejectOrEdit()}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setMode("choose"); setInput(""); }}>
                Back
              </Button>
              <Button onClick={submitRejectOrEdit}>{mode === "edit" ? "Run edited" : "Reject"}</Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm test`
Expected: exit 0.

- [ ] **Step 3: Manual smoke — the approval gate**

Run: `npm run dev` (Ollama running), submit: "Run the shell command `echo gate-check-ok` and tell me its exact output."
Expected: the run pauses and the approval dialog appears showing the `execute` command. Approve → the command runs and the answer streams. Re-run and Reject with a reason → the agent adapts.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: approval card dialog wired to resolveApproval"
```

---

## Task 10: Live IPC verification script + final polish

**Files:**
- Create: `scripts/ipc-test.ts`
- Modify: `package.json` (add `ipc:test` script)

**Interfaces:**
- Consumes: `runTask`/`resolveApproval`/`cancel` (`src/main/agent/runtime.ts`), `WireEvent` (`@shared/wire`).
- Produces: `npm run ipc:test` — a headless live check of the exact runTask path the IPC chat handler uses, including the approval round-trip.

- [ ] **Step 1: Write `scripts/ipc-test.ts`**

```ts
/**
 * Live test of the desktop chat path: runTask streams WireEvents, pauses on
 * the approval gate, and resumes after resolveApproval — the exact wiring the
 * IPC chat handler depends on (no Electron window needed).
 */
import { runTask, resolveApproval } from "../src/main/agent/runtime.js";
import type { WireEvent } from "../src/shared/wire.js";

const events: WireEvent[] = [];
let approvalRunId: string | null = null;

const send = (ev: WireEvent): void => {
  events.push(ev);
  if (ev.type === "approval") approvalRunId = ev.runId;
};

// 1. Run a gated task; it must pause on approval.
await runTask(
  "Run the shell command `echo ipc-gate-ok` and report its exact output.",
  "ipc-test",
  send
);
if (!approvalRunId) throw new Error("FAIL: expected an approval event, got none");
console.log(`[gate fired] runId=${approvalRunId}`);

// 2. Approve; the run should complete with a done event.
resolveApproval(approvalRunId, { decisions: [{ type: "approve" }] });
await new Promise((r) => setTimeout(r, 500));

const done = events.find((e) => e.type === "done");
if (!done) throw new Error("FAIL: expected a done event after approval");
if (done.cancelled) throw new Error("FAIL: run was cancelled, expected completion");
console.log(`[done] cancelled=${done.cancelled} rememberedNotes=${done.rememberedNotes ?? 0}`);

const tokens = events.filter((e) => e.type === "token").length;
const updates = events.filter((e) => e.type === "update").length;
console.log(`[stream] ${tokens} token events, ${updates} update events`);
if (tokens + updates === 0) throw new Error("FAIL: no stream events received");

console.log("IPC_TEST_DONE — runTask streams, approval round-trips, run completes.");
```

- [ ] **Step 2: Add the script**

Add to `package.json` scripts: `"ipc:test": "tsx scripts/ipc-test.ts"`.

- [ ] **Step 3: Run it (Ollama running)**

Run: `npm run ipc:test`
Expected: prints `[gate fired]`, `[done]`, `[stream]`, and `IPC_TEST_DONE`.

- [ ] **Step 4: Full verification pass**

Run: `npm test && npm run test:unit`
Expected: typecheck (node + web) and all vitest suites pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: live ipc-test script for the desktop chat path"
```

---

## Self-Review Notes

- **Spec coverage (this plan):** Phases 1–2 of the spec — scaffold, chat spine (streaming, todos, approval gate), and the IPC contract. Threads/providers/skills/memory/auth/packaging are deferred to follow-up plans (explicitly out of this plan's scope).
- **Deliberate v1 simplification:** the spec's "tool-call/tool-result collapsible cards" are rendered as prefixed text parts (`🔧`/`↳`/`🤖`) in `toThreadMessage`. Rich tool cards are a follow-up; the transcript is fully faithful.
- **Type consistency:** `WireEvent`/`WireMsg`/`Todo`/`HITLRequestWire`/`HITLResponseWire`/`HITLDecisionWire`/`Result`/`AppInfo` are defined once in `src/shared/wire.ts` and referenced identically across runtime, IPC, preload, and renderer. `ChatStore`/`TranscriptEntry`/`EntryKind`/`Status`/`ApprovalState` are defined in `chat-store.ts` and used by `runtime.tsx`, `ChatView.tsx`, `ApprovalCard.tsx`, and `to-thread-message.ts`.
- **`cancel()` refinement:** Task 4 Step 3 ships a placeholder `cancel()` body; Task 5 Step 1 replaces it with the correct reject-all version. The plan flags this explicitly so no executor ships the placeholder.
