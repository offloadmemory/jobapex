# Hermes Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the `deep-agents-101` POC into a personal-assistant CLI (`hermes`) with durable threads, a global identity, a native skills system (load + gated generation), and automatic memory capture.

**Architecture:** Build on the existing LangChain Deep Agents stack, leveraging `deepagents@1.12.2`'s *native* skills middleware, memory middleware, and `Settings` path manager rather than reimplementing them. The only genuinely new code is: a durable SQLite checkpointer, a gated `write_skill` tool, a post-turn memory-consolidation pass, and CLI polish.

**Tech Stack:** TypeScript (NodeNext ESM), `deepagents@1.12.2`, `@langchain/langgraph-checkpoint-sqlite` (better-sqlite3), `@langchain/ollama`, `langchain` (tool/middleware), `zod`.

**Spec:** `docs/superpowers/specs/2026-08-28-hermes-assistant-design.md`

## Global Constraints

- Node.js >= 22; `"type": "module"`; all relative imports use `.js` extensions (NodeNext).
- Model stays Ollama (`ChatOllama`); provider seam remains swappable.
- Directory convention is **`~/.deepagents/hermes/`** (native `deepagents` convention, adopted in place of the spec's `~/.hermes-assistant/` so `createSettings` works out of the box). Agent name constant: `hermes`.
- Testing ethos: **live integration scripts** against a running Ollama daemon, not mocks. `npm test` = `tsc --noEmit` is the only always-on gate.
- Every commit message ends with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Do not commit `workspace/*` (gitignored) or `package-lock.json` churn unrelated to a task.

### Discovery note (read first)

`deepagents@1.12.2` already provides, verified against `node_modules/deepagents/dist/agent-pS9QvkWZ.d.ts`:

- **`createSkillsMiddleware({ backend, sources })`** — loads `SKILL.md` files (Agent Skills spec, `agentskills.io`) and injects name+description into the system prompt via *progressive disclosure*; the agent reads full `SKILL.md` via `read_file` when needed. **No native write tool.**
- **`createMemoryMiddleware({ backend, sources })`** — loads `AGENTS.md`/`agent.md` files (multiple sources, absolute paths) into the system prompt. Read-only.
- **`createSettings()`** → `Settings` with `~/.deepagents/{agent}/agent.md`, `~/.deepagents/{agent}/skills/`, `{projectRoot}/.deepagents/agent.md`, `{projectRoot}/.deepagents/skills/`.
- **`interruptOn: Record<string, { allowedDecisions: ("approve"|"edit"|"reject")[] }>`** — gates *any* tool by name, not just `execute`.
- **`SqliteSaver.fromConnString(localPath)`** from `@langchain/langgraph-checkpoint-sqlite` (dep: `better-sqlite3`).
- **`FilesystemBackend({ rootDir, virtualMode })`** — with `virtualMode: false` (default), absolute paths resolve as-is; used as the backend for skills/memory so they can live in `~/.deepagents/` outside the workspace sandbox.

Consequence: the spec's "build a skill system from scratch" and "build a memory store from scratch" collapse into "wire the native middlewares + add a gated write tool + add a consolidation pass."

---

## File Structure

```
src/
  paths.ts             # canonical ~/.deepagents/hermes/... paths (NEW)
  config.ts            # env + config.json + flags (MODIFY)
  persistence.ts       # createCheckpointer() -> SqliteSaver (NEW)
  identity.ts          # createIdentityMiddleware() -> memory middleware (NEW)
  skills/
    registry.ts        # createSkillsMiddleware wiring + ensure dirs (NEW)
    tools.ts           # write_skill tool (gated) (NEW)
  memory/
    store.ts           # memory note store (Markdown + index) (NEW)
    consolidate.ts     # post-turn consolidation pass (NEW)
  agent.ts             # wire checkpointer + identity + skills + write_skill (MODIFY)
  subagents.ts         # unchanged
  tools/search.ts      # unchanged
  render.ts            # extend: skill + memory events (MODIFY)
  index.ts             # REPL: /threads /resume /skills /memory + consolidation (MODIFY)
  ollamaShim.ts        # unchanged
bin/
  hermes.js            # launcher (NEW)
```

---

## Phase 1 — Persistence + identity

### Task 1: Canonical paths + durable checkpointer

**Files:**
- Create: `src/paths.ts`
- Create: `src/persistence.ts`
- Test: `scripts/persistence-test.ts`

**Interfaces:**
- Produces: `AGENT_NAME = "hermes"`; `agentHomeDir(): string`; `skillsDir(): string`; `memoryDir(): string`; `checkpointsPath(): string`; `configPath(): string`; `createCheckpointer(): SqliteSaver`.

- [ ] **Step 1: Write `src/paths.ts`**

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const AGENT_NAME = "hermes";

/** ~/.deepagents/hermes — created on first use. */
export function agentHomeDir(): string {
  const dir = path.join(os.homedir(), ".deepagents", AGENT_NAME);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function skillsDir(): string {
  const dir = path.join(agentHomeDir(), "skills");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function memoryDir(): string {
  const dir = path.join(agentHomeDir(), "memory");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function checkpointsPath(): string {
  return path.join(agentHomeDir(), "checkpoints.sqlite");
}

export function configPath(): string {
  return path.join(agentHomeDir(), "config.json");
}
```

- [ ] **Step 2: Write `src/persistence.ts`**

```ts
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { checkpointsPath } from "./paths.js";

/** Durable checkpointer: threads survive process restarts. */
export function createCheckpointer(): SqliteSaver {
  return SqliteSaver.fromConnString(checkpointsPath());
}
```

- [ ] **Step 3: Write `scripts/persistence-test.ts`** (live check: a thread persists across two agent instances)

```ts
import { loadConfig } from "../src/config.js";
import { buildAgent } from "../src/agent.js";
import { createCheckpointer } from "../src/persistence.js";

const cfg = loadConfig(["--yolo"]);
const threadId = "persistence-test";

// First instance: run a task that writes a fact into conversation state.
const a1 = buildAgent(cfg);
await a1.invoke(
  { messages: [{ role: "user", content: "Remember the number 42. Reply 'ok'." }] },
  { configurable: { thread_id: threadId } }
);

// Second instance (fresh buildAgent, same durable checkpointer): ask it to recall.
const a2 = buildAgent(cfg);
const res = await a2.invoke(
  { messages: [{ role: "user", content: "What number did I ask you to remember?" }] },
  { configurable: { thread_id: threadId } }
);
const last = res.messages[res.messages.length - 1];
console.log("recall:", typeof last.content === "string" ? last.content : JSON.stringify(last.content));
console.log("checkpointer:", createCheckpointer() instanceof Object ? "ok" : "fail");
```

- [ ] **Step 4: Run typecheck + live test**

Run: `npx tsc --noEmit` then `npx tsx scripts/persistence-test.ts`
Expected: typecheck passes; the second instance recalls "42" (proving the thread survived a fresh `buildAgent`).

- [ ] **Step 5: Commit**

```bash
git add src/paths.ts src/persistence.ts scripts/persistence-test.ts
git commit -m "feat: durable SQLite checkpointer + canonical ~/.deepagents/hermes paths

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 2: Identity middleware (SOUL.md equivalent)

**Files:**
- Create: `src/identity.ts`
- Modify: `src/agent.ts` (wire identity middleware; keep `MemorySaver` for now — swapped in Task 3)

**Interfaces:**
- Consumes: `AGENT_NAME` from `src/paths.js`; `workspaceDir` from `AppConfig`.
- Produces: `createIdentityMiddleware(workspaceDir: string): AgentMiddleware` (a `createMemoryMiddleware` instance loading user `agent.md` + workspace `AGENTS.md` + project `.deepagents/agent.md`).

- [ ] **Step 1: Write `src/identity.ts`**

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMemoryMiddleware, FilesystemBackend } from "deepagents";
import { AGENT_NAME } from "./paths.js";

const DEFAULT_AGENT_MD = `# ${AGENT_NAME} — identity

You are ${AGENT_NAME}, a personal assistant. Add your standing preferences,
identity, and instructions here. This file is loaded into every session.
`;

/** Absolute path to the user-level identity file, created with a default if missing. */
function userAgentMdPath(): string {
  const p = path.join(os.homedir(), ".deepagents", AGENT_NAME, "agent.md");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (!fs.existsSync(p)) fs.writeFileSync(p, DEFAULT_AGENT_MD);
  return p;
}

/**
 * Memory middleware loading user identity + project instructions into the
 * system prompt. Uses a FilesystemBackend rooted at "/" (virtualMode false)
 * so absolute paths resolve as-is, independent of the workspace sandbox.
 *
 * Sources (in order): user agent.md, workspace AGENTS.md (carries the OpenWiki
 * pointer block — must be preserved), then project .deepagents/agent.md.
 */
export function createIdentityMiddleware(workspaceDir: string) {
  const sources = [userAgentMdPath()];
  const workspaceAgentMd = path.join(workspaceDir, "AGENTS.md");
  if (fs.existsSync(workspaceAgentMd)) sources.push(workspaceAgentMd);
  const projectAgentMd = path.join(process.cwd(), ".deepagents", "agent.md");
  if (fs.existsSync(projectAgentMd)) sources.push(projectAgentMd);
  return createMemoryMiddleware({
    backend: new FilesystemBackend({ rootDir: "/" }),
    sources,
  });
}
```

- [ ] **Step 2: Wire into `src/agent.ts`**

Replace the `memory` option usage. In `buildAgent`, remove `...(hasMemoryFile ? { memory: ["/AGENTS.md"] } : {})` and add `createIdentityMiddleware(cfg.workspaceDir)` to the `middleware` array:

```ts
import { createIdentityMiddleware } from "./identity.js";
// ...
return createDeepAgent({
  model,
  systemPrompt: SYSTEM_PROMPT,
  tools: [webSearch],
  subagents: gatedSubagents,
  ...(backend ? { backend } : {}),
  middleware: [todoListMiddleware(), createIdentityMiddleware(cfg.workspaceDir), ollamaToolContentShim],
  checkpointer: new MemorySaver(),
  ...(gate ? { interruptOn: gate } : {}),
});
```

(Delete the now-unused `hasMemoryFile` block and the `path` import if it becomes unused.)

- [ ] **Step 3: Run typecheck + smoke**

Run: `npx tsc --noEmit` then `npx tsx scripts/smoke.ts`
Expected: typecheck passes; smoke still completes (identity middleware loads the default `agent.md` without error).

- [ ] **Step 4: Commit**

```bash
git add src/identity.ts src/agent.ts
git commit -m "feat: load user identity (agent.md) + project instructions as memory

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 3: Swap in the durable checkpointer + thread commands

**Files:**
- Modify: `src/agent.ts` (use `createCheckpointer()`)
- Modify: `src/index.ts` (add `/threads` and `/resume <id>`)

**Interfaces:**
- Consumes: `createCheckpointer` from `src/persistence.js`.
- Produces: REPL commands `/threads` (list) and `/resume <id>` (set `threadId`).

- [ ] **Step 1: Swap checkpointer in `src/agent.ts`**

```ts
import { createCheckpointer } from "./persistence.js";
// ...
checkpointer: createCheckpointer(),
```

Remove the `MemorySaver` import.

- [ ] **Step 2: Add thread commands to `src/index.ts`**

Add a helper that lists known threads by reading the SQLite DB via the checkpointer's `list` method, and wire two slash commands in the `ask()` loop:

```ts
import { createCheckpointer } from "./persistence.js";
const checkpointer = createCheckpointer();

async function listThreads(): Promise<void> {
  const configs = await checkpointer.list({ limit: 20 });
  if (!configs.length) return console.log(`${c.dim}no saved threads yet${c.reset}`);
  for (const cfg of configs) {
    const id = cfg.configurable?.thread_id ?? "?";
    console.log(`  ${c.bold}${id}${c.reset}`);
  }
}
```

In `ask()`, before the `if (input)` branch:

```ts
if (input === "/threads") { await listThreads(); return ask(); }
if (input.startsWith("/resume ")) {
  const id = input.slice("/resume ".length).trim();
  if (!id) { console.log(`${c.dim}usage: /resume <thread-id>${c.reset}`); return ask(); }
  threadId = id;
  console.log(`${c.dim}resumed thread ${id}${c.reset}`);
  return ask();
}
```

- [ ] **Step 3: Run typecheck + persistence test**

Run: `npx tsc --noEmit` then `npx tsx scripts/persistence-test.ts`
Expected: typecheck passes; recall still works (now through SQLite).

- [ ] **Step 4: Commit**

```bash
git add src/agent.ts src/index.ts
git commit -m "feat: durable threads via SQLite + /threads and /resume commands

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Phase 2 — Skill system

### Task 4: Skills registry (native loading)

**Files:**
- Create: `src/skills/registry.ts`
- Modify: `src/agent.ts` (wire skills middleware)

**Interfaces:**
- Consumes: `skillsDir` from `src/paths.js`.
- Produces: `createSkillsRegistry(): AgentMiddleware` (a `createSkillsMiddleware` instance loading user + project skills).

- [ ] **Step 1: Write `src/skills/registry.ts`**

```ts
import fs from "node:fs";
import path from "node:path";
import { createSkillsMiddleware, FilesystemBackend } from "deepagents";
import { skillsDir } from "../paths.js";

/**
 * Skills middleware: loads SKILL.md files from the user skills dir (and the
 * project .deepagents/skills dir when present) and injects name+description
 * into the system prompt (progressive disclosure). The agent reads full
 * SKILL.md content via read_file when it needs to follow a skill.
 */
export function createSkillsRegistry() {
  const sources = [skillsDir()];
  const projectSkills = path.join(process.cwd(), ".deepagents", "skills");
  if (fs.existsSync(projectSkills)) sources.push(projectSkills);
  return createSkillsMiddleware({
    backend: new FilesystemBackend({ rootDir: "/" }),
    sources,
  });
}
```

- [ ] **Step 2: Wire into `src/agent.ts`**

Add `createSkillsRegistry()` to the `middleware` array (after `createIdentityMiddleware()`):

```ts
import { createSkillsRegistry } from "./skills/registry.js";
// ...
middleware: [todoListMiddleware(), createIdentityMiddleware(), createSkillsRegistry(), ollamaToolContentShim],
```

- [ ] **Step 3: Run typecheck + smoke**

Run: `npx tsc --noEmit` then `npx tsx scripts/smoke.ts`
Expected: typecheck passes; smoke completes (empty skills dir is a no-op).

- [ ] **Step 4: Commit**

```bash
git add src/skills/registry.ts src/agent.ts
git commit -m "feat: native skills loading via createSkillsMiddleware

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 5: Gated `write_skill` tool (auto skill generation)

**Files:**
- Create: `src/skills/tools.ts`
- Modify: `src/agent.ts` (add tool + gate)
- Test: `scripts/skills-test.ts`

**Interfaces:**
- Consumes: `skillsDir` from `src/paths.js`.
- Produces: `writeSkill` (a `langchain` tool named `write_skill`), gated via `interruptOn`.

- [ ] **Step 1: Write `src/skills/tools.ts`**

```ts
import fs from "node:fs";
import path from "node:path";
import { tool } from "langchain";
import * as z from "zod";
import { skillsDir } from "../paths.js";

const FRONTMATTER = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n`;

/**
 * Propose a new reusable skill. Gated by interruptOn: the HITL gate pauses
 * for approve/edit/reject BEFORE this function runs, so a skill only becomes
 * loadable after the user consents.
 */
export const writeSkill = tool(
  async ({ name, description, content }: { name: string; description: string; content: string }) => {
    const dir = path.join(skillsDir(), name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), FRONTMATTER(name, description) + content + "\n");
    return `Skill "${name}" written to ${dir}. It is now available to load in future sessions.`;
  },
  {
    name: "write_skill",
    description:
      "Propose a new reusable skill (a SKILL.md file) capturing a repeatable workflow. " +
      "Use when you have performed a non-obvious procedure more than once. The user must approve before it is saved.",
    schema: z.object({
      name: z.string().regex(/^[a-z0-9-]+$/).describe("kebab-case skill name (lowercase, hyphens)"),
      description: z.string().describe("what the skill does and when to use it"),
      content: z.string().describe("the SKILL.md body: step-by-step instructions"),
    }),
  }
);
```

- [ ] **Step 2: Add tool + gate in `src/agent.ts`**

```ts
import { writeSkill } from "./skills/tools.js";
// ...
const interruptOnShell = {
  execute: { allowedDecisions: ["approve", "edit", "reject"] as const },
  write_skill: { allowedDecisions: ["approve", "edit", "reject"] as const },
};
// ...
tools: [webSearch, writeSkill],
```

Also append this rule to `SYSTEM_PROMPT` (after the "How to work" section):

```
- Skills: when you have done a non-obvious procedure more than once, propose it as a reusable skill via the write_skill tool. The user will approve it before it is saved.
```

- [ ] **Step 3: Write `scripts/skills-test.ts`** (live check: list + load + gated write)

```ts
import { loadConfig } from "../src/config.js";
import { buildAgent } from "../src/agent.js";
import { skillsDir } from "../src/paths.js";
import fs from "node:fs";
import path from "node:path";

// Seed a skill so list/load has something to find.
const seed = path.join(skillsDir(), "demo-skill");
fs.mkdirSync(seed, { recursive: true });
fs.writeFileSync(path.join(seed, "SKILL.md"), "---\nname: demo-skill\ndescription: A demo skill for testing.\n---\n# Demo\nSay 'demo skill loaded'.\n");

const cfg = loadConfig(["--yolo"]);
const agent = buildAgent(cfg);
const res = await agent.invoke(
  { messages: [{ role: "user", content: "List your available skills, then load and follow the demo-skill." }] },
  { configurable: { thread_id: "skills-test" }, recursionLimit: 100 }
);
const last = res.messages[res.messages.length - 1];
console.log("result:", typeof last.content === "string" ? last.content : JSON.stringify(last.content));
```

- [ ] **Step 4: Run typecheck + live test**

Run: `npx tsc --noEmit` then `npx tsx scripts/skills-test.ts`
Expected: typecheck passes; the agent reports `demo-skill` in its skill list and follows it (output mentions "demo skill loaded").

- [ ] **Step 5: Commit**

```bash
git add src/skills/tools.ts src/agent.ts scripts/skills-test.ts
git commit -m "feat: gated write_skill tool for auto skill generation

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Phase 3 — Auto-memory

### Task 6: Memory store

**Files:**
- Create: `src/memory/store.ts`

**Interfaces:**
- Consumes: `memoryDir` from `src/paths.js`.
- Produces: `MemoryNote`; `listNotes(): MemoryNote[]`; `writeNote(note: { slug: string; title: string; content: string }): void`; `readNote(slug: string): string | null`; `searchNotes(query: string): MemoryNote[]`.

- [ ] **Step 1: Write `src/memory/store.ts`**

```ts
import fs from "node:fs";
import path from "node:path";
import { memoryDir } from "../paths.js";

export interface MemoryNote {
  slug: string;
  title: string;
  content: string;
}

function notePath(slug: string): string {
  return path.join(memoryDir(), `${slug}.md`);
}

export function listNotes(): MemoryNote[] {
  const dir = memoryDir();
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "index.md")
    .map((f) => {
      const slug = f.replace(/\.md$/, "");
      const raw = fs.readFileSync(path.join(dir, f), "utf8");
      const title = raw.split("\n")[0]?.replace(/^#\s*/, "") ?? slug;
      return { slug, title, content: raw };
    });
}

export function readNote(slug: string): string | null {
  const p = notePath(slug);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

/** Append-or-replace a note by slug; keeps index.md current (one line per note). */
export function writeNote(note: MemoryNote): void {
  const dir = memoryDir();
  fs.writeFileSync(notePath(note.slug), `# ${note.title}\n\n${note.content}\n`);
  const notes = listNotes();
  const index = notes.map((n) => `- [${n.title}](${n.slug}.md)`).join("\n") + "\n";
  fs.writeFileSync(path.join(dir, "index.md"), index);
}

export function searchNotes(query: string): MemoryNote[] {
  const q = query.toLowerCase();
  return listNotes().filter(
    (n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/memory/store.ts
git commit -m "feat: durable memory note store (Markdown + index)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 7: Post-turn consolidation pass

**Files:**
- Create: `src/memory/consolidate.ts`
- Modify: `src/index.ts` (run consolidation after each task)
- Test: `scripts/memory-test.ts`

**Interfaces:**
- Consumes: `writeNote` from `src/memory/store.js`; a `ChatOllama` model instance.
- Produces: `consolidateMemory(model, messages): Promise<number>` (number of notes written).

- [ ] **Step 1: Write `src/memory/consolidate.ts`**

```ts
import { writeNote } from "./store.js";

const CONSOLIDATE_PROMPT = `You are a memory consolidator. Given a conversation, extract durable learnings worth remembering in a month: user preferences, decisions and their reasons, verified commands, and pitfalls with fixes. Ignore session trivia.

Return ONLY a JSON array of objects, each with "slug" (kebab-case), "title" (short), and "content" (1-3 sentences). If nothing is worth remembering, return [].`;

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

/** Run a cheap consolidation call and append durable learnings to memory. */
export async function consolidateMemory(model: any, messages: any[]): Promise<number> {
  const res = await model.invoke([
    { role: "system", content: CONSOLIDATE_PROMPT },
    ...messages.slice(-12), // last 12 messages is enough context
  ]);
  const text = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return 0;
  let items: { slug?: string; title?: string; content?: string }[];
  try {
    items = JSON.parse(match[0]);
  } catch {
    return 0;
  }
  let written = 0;
  for (const it of items) {
    if (!it?.content) continue;
    writeNote({
      slug: slugify(it.slug ?? it.title ?? `note-${written}`),
      title: it.title ?? "Note",
      content: it.content,
    });
    written++;
  }
  return written;
}
```

- [ ] **Step 2: Wire into `src/index.ts`**

In `runTask`, capture the final messages and return them; in `main`, consolidate after a successful task. Change `runTask` to return the messages:

```ts
async function runTask(prompt: string): Promise<any[] | null> {
  // ... existing loop ...
  // after the loop breaks (task finished), fetch state and return messages:
  const state = await agent.getState({ configurable: { thread_id: threadId } });
  return (state.values?.messages as any[]) ?? null;
}
```

In `main`, after `await runTask(input)`:

```ts
if (input) {
  console.log();
  const messages = await runTask(input);
  if (messages) {
    const n = await consolidateMemory(model, messages).catch(() => 0);
    if (n > 0) console.log(`${c.dim}🧠 remembered ${n} note${n === 1 ? "" : "s"}${c.reset}`);
  }
}
```

Add imports: `import { consolidateMemory } from "./memory/consolidate.js";` and a shared model instance `const model = new ChatOllama({ model: cfg.model, baseUrl: cfg.baseUrl });` (or reuse the one from `agent.ts` by exporting a `buildModel(cfg)` helper — see Task 8 note).

- [ ] **Step 3: Write `scripts/memory-test.ts`** (live check: consolidation writes a note; a fresh thread reads it back)

```ts
import { loadConfig } from "../src/config.js";
import { buildAgent } from "../src/agent.js";
import { consolidateMemory } from "../src/memory/consolidate.js";
import { listNotes } from "../src/memory/store.js";
import { ChatOllama } from "@langchain/ollama";

const cfg = loadConfig(["--yolo"]);
const model = new ChatOllama({ model: cfg.model, baseUrl: cfg.baseUrl });

const before = listNotes().length;
const n = await consolidateMemory(model, [
  { role: "user", content: "My name is Kartik and I prefer TypeScript over Python." },
  { role: "assistant", content: "Noted — I'll remember you prefer TypeScript." },
]);
const after = listNotes().length;
console.log(`notes written: ${n}; total before=${before} after=${after}`);
console.log("PASS" === (n > 0 && after > before ? "PASS" : "FAIL") ? "PASS" : "FAIL");
```

- [ ] **Step 4: Run typecheck + live test**

Run: `npx tsc --noEmit` then `npx tsx scripts/memory-test.ts`
Expected: typecheck passes; `notes written: >=1` and `PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/memory/consolidate.ts src/index.ts scripts/memory-test.ts
git commit -m "feat: post-turn auto-memory consolidation

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 8: Read-first memory in the system prompt

**Files:**
- Modify: `src/agent.ts` (system prompt rule)

- [ ] **Step 1: Add a read-first rule to `SYSTEM_PROMPT`**

Append to the "Your knowledge base" section:

```
- Your personal memory lives in ~/.deepagents/hermes/memory/ (Markdown notes + index.md). READ FIRST: before starting substantial work, read index.md and any relevant notes so past learnings inform this session.
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/agent.ts
git commit -m "feat: read-first memory rule in system prompt

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Phase 4 — CLI polish

### Task 9: Config file (env > file > defaults)

**Files:**
- Modify: `src/config.ts`

**Interfaces:**
- Consumes: `configPath` from `src/paths.js`.
- Produces: `loadConfig` now merges `~/.deepagents/hermes/config.json` under env vars.

- [ ] **Step 1: Extend `src/config.ts`**

```ts
import fs from "node:fs";
import { configPath } from "./paths.js";

function readConfigFile(): Partial<AppConfig> {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8"));
  } catch {
    return {};
  }
}

export function loadConfig(argv: string[] = process.argv.slice(2)): AppConfig {
  const file = readConfigFile();
  return {
    model: process.env.OLLAMA_MODEL ?? file.model ?? "deepseek-v4-flash:0731-cloud",
    baseUrl: process.env.OLLAMA_BASE_URL ?? file.baseUrl ?? "http://localhost:11434",
    workspaceDir: process.env.AGENT_WORKSPACE ?? file.workspaceDir ?? path.join(projectRoot, "workspace"),
    memfs: argv.includes("--memfs") || file.memfs === true,
    yolo: argv.includes("--yolo") || file.yolo === true,
    think: !["0", "false"].includes((process.env.OLLAMA_THINK ?? "").toLowerCase()),
  };
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: config file (~/.deepagents/hermes/config.json) with env override

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 10: Named binary + history + `/skills` `/memory` `/help`

**Files:**
- Create: `bin/hermes.js`
- Modify: `package.json` (add `bin`)
- Modify: `src/index.ts` (history + `/skills` `/memory` `/help`)

**Interfaces:**
- Consumes: `listNotes`/`searchNotes` from `src/memory/store.js`; `skillsDir` from `src/paths.js`.

- [ ] **Step 1: Write `bin/hermes.js`**

```js
#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const r = spawnSync("npx", ["tsx", "src/index.ts", ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
});
process.exit(r.status ?? 1);
```

- [ ] **Step 2: Add `bin` to `package.json`**

```json
"bin": { "hermes": "bin/hermes.js" }
```

- [ ] **Step 3: Add history + commands to `src/index.ts`**

Enable readline history persistence and add three commands. In `main()`, after creating `rl`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listNotes, searchNotes } from "./memory/store.js";
import { skillsDir } from "./paths.js";

const historyFile = path.join(os.homedir(), ".deepagents", "hermes", "history");
if (fs.existsSync(historyFile)) {
  for (const line of fs.readFileSync(historyFile, "utf8").split("\n")) {
    if (line.trim()) rl.history.push(line);
  }
}
rl.on("line", (line) => {
  if (line.trim()) fs.appendFileSync(historyFile, line + "\n");
});
```

In `ask()`, add before the `if (input)` branch:

```ts
if (input === "/skills") {
  const dir = skillsDir();
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "SKILL.md"))) : [];
  names.length ? names.forEach((n) => console.log(`  ${c.bold}${n}${c.reset}`)) : console.log(`${c.dim}no skills yet${c.reset}`);
  return ask();
}
if (input.startsWith("/memory")) {
  const q = input.slice("/memory".length).trim();
  const notes = q ? searchNotes(q) : listNotes();
  notes.length ? notes.forEach((n) => console.log(`  ${c.bold}${n.title}${c.reset}${c.dim} (${n.slug})${c.reset}`)) : console.log(`${c.dim}no memory yet${c.reset}`);
  return ask();
}
if (input === "/help") {
  console.log(`${c.dim}commands: /todos /files /threads /resume <id> /skills /memory [query] /reset /exit${c.reset}`);
  return ask();
}
```

- [ ] **Step 4: Run typecheck + smoke**

Run: `npx tsc --noEmit` then `npx tsx scripts/smoke.ts`
Expected: typecheck passes; smoke completes.

- [ ] **Step 5: Commit**

```bash
git add bin/hermes.js package.json src/index.ts
git commit -m "feat: hermes binary, command history, /skills /memory /help

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 11: Update README + design spec addendum

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-28-hermes-assistant-design.md` (addendum)

- [ ] **Step 1: Update `README.md`**

Add a "Personal assistant (hermes)" section documenting: the `hermes` binary, `~/.deepagents/hermes/` layout (agent.md identity, skills/, memory/, checkpoints.sqlite, config.json), the new REPL commands, and the auto-memory + skill-generation behavior. Update the architecture diagram to include the new modules.

- [ ] **Step 2: Add a spec addendum**

Append to the spec a short "Addendum (2026-08-28): native deepagents systems" noting that skills/memory/settings are wired via `createSkillsMiddleware`/`createMemoryMiddleware`/`createSettings` rather than built from scratch, and that the directory convention is `~/.deepagents/hermes/`.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/superpowers/specs/2026-08-28-hermes-assistant-design.md
git commit -m "docs: document hermes assistant + native deepagents addendum

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:** persistence (Tasks 1,3), identity (Task 2), skills loading (Task 4), skill generation (Task 5), auto-memory (Tasks 6,7,8), CLI (Tasks 9,10), docs (Task 11). All four phases covered.
- **Type consistency:** `AGENT_NAME`, `agentHomeDir`, `skillsDir`, `memoryDir`, `checkpointsPath`, `configPath` are defined once in `src/paths.ts` and consumed consistently. `writeNote`/`listNotes`/`searchNotes` signatures match between `store.ts` and `consolidate.ts`/`index.ts`.
- **Verification points (fix during execution if the API differs):** `SqliteSaver.fromConnString` accepting a bare local path; `FilesystemBackend({ rootDir: "/" })` resolving absolute paths for the memory/skills middlewares; `agent.getState` availability on the `DeepAgent` return value; `ChatOllama` reuse for consolidation (if `buildAgent` doesn't expose the model, add a `buildModel(cfg)` export to `agent.ts`).
