# JobApex Desktop App — Design

Date: 2026-08-29
Status: Approved design (brainstorming complete)
Reference repos:
- **This repo** (`jobapex/desktop-app`) — LangChain Deep Agents harness with Ink TUI
- **agentfork** (`/Users/kartik/Documents/git-repo/agentfork`) — Nx monorepo, Next.js + Shadcn + Zod, next-auth, LLM provider config UI, Deep Agents runtime (`libs/claw-studio`)

## Goal

Replace the Ink terminal UI with an Electron desktop app for the existing Deep Agent core — keeping the core's native LangChain Deep Agents architecture (SQLite checkpoints, markdown memory/skills, OpenWiki, subagents, HITL approval gate) untouched. UI component and feature patterns are ported from the agentfork reference; chat components come from [assistant-ui](https://www.assistant-ui.com) integrated with the deepagents stream seam.

## Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Desktop shell | **Electron** — agent runs in-process in main (Node) |
| Renderer stack | **Vite + React + Shadcn + Tailwind + Zod**, chat surface via **assistant-ui** |
| Core↔renderer wiring | **Option A: typed IPC** over contextBridge (no localhost server, no nodeIntegration) |
| v1 features | Chat + threads (core), LLM provider config, skills manager, memory manager, setup wizard + lock |
| Providers in v1 | Ollama (default), OpenAI, Anthropic |
| Repo layout | Single package, electron-vite (`src/main`, `src/preload`, `src/renderer`) |
| Ink TUI | **Removed entirely** — GUI-only going forward |
| Auth meaning | Local: first-run setup wizard + optional PIN lock (no users/sessions/server) |
| Storage split | SQLite for chats/providers/settings; **filesystem markdown for skills/memory/identity/OpenWiki**; `safeStorage` for API keys |

## Architecture

```
jobapex/
├── electron.vite.config.ts        # main / preload / renderer build configs
├── src/
│   ├── main/                      # Electron main process (Node)
│   │   ├── index.ts               # app bootstrap, window, single-instance lock
│   │   ├── ipc/                   # typed handlers, one module per domain
│   │   │   ├── chat.ts            # runTask, cancel, approval round-trip
│   │   │   ├── threads.ts         # list / resume / history
│   │   │   ├── providers.ts       # CRUD + discover + validate + secrets
│   │   │   ├── skills.ts          # list / read / write SKILL.md
│   │   │   ├── memory.ts          # list / search / read / write notes
│   │   │   └── app.ts             # settings, lock state, setup wizard
│   │   └── agent/                 # the existing core, moved as-is
│   │       ├── agent.ts           # buildAgent (now provider-aware via model-factory)
│   │       ├── model-factory.ts   # NEW: provider row → ChatOllama/ChatOpenAI/ChatAnthropic
│   │       ├── agent-runner.ts    # unchanged seam
│   │       ├── stream-events.ts   # unchanged seam
│   │       ├── config.ts, paths.ts, persistence.ts, identity.ts
│   │       ├── subagents.ts, ollamaShim.ts, render.ts (kept for scripts)
│   │       ├── memory/  skills/  tools/
│   ├── preload/
│   │   └── index.ts               # contextBridge: window.hermes (typed API)
│   └── renderer/                  # React app (sandboxed, no Node)
│       ├── src/
│       │   ├── App.tsx            # shell: sidebar + routing + lock gate
│       │   ├── chat/              # assistant-ui Thread + runtime adapter + ChatStore
│       │   ├── threads/           # thread list / resume / new thread
│       │   ├── settings/          # providers, general, lock
│       │   ├── skills/            # SKILL.md browser/editor
│       │   ├── memory/            # notes browser/search
│       │   ├── setup/             # first-run wizard + lock screen
│       │   ├── lib/               # ipc client, stores (zustand), zod schemas
│       │   └── components/ui/     # shadcn primitives
│       └── index.html
├── bin/hermes.js                  # now launches electron .
└── scripts/                       # existing verification scripts survive
```

**Deleted:** `src/index.tsx`, `src/ui/` (App.tsx, store.ts, resume.ts, components/), `scripts/ui-test.ts`, and the `ink` / `ink-testing-library` dependencies. `render.ts` stays (console scripts use it).

**Process responsibilities**
- **Main:** owns the agent, SQLite checkpointers, filesystem, shell, secrets (`safeStorage`), provider registry. Rebuilds the agent when the active provider/model changes.
- **Preload:** a single `window.hermes` API typed by a shared `HermesApi` interface imported by both sides. `contextIsolation: true`, `nodeIntegration: false`.
- **Renderer:** pure React. Locked/unlocked window states; assistant-ui runtime fed by an IPC event bus.

## IPC contract

One typed API surface (Zod-validated on the main side, mirroring agentfork's `parse-request` pattern):

```ts
interface HermesApi {
  chat: {
    run(req: { prompt: string; threadId: string }): { runId: string }; // events stream back via onEvent
    cancel(threadId: string): void;
    resolveApproval(runId: string, decision: HITLResponse): void;
  };
  threads: { list(): ThreadSummary[]; history(threadId: string): Message[] };
  providers: { list(): ProviderInfo[]; save(p: ProviderInput): ProviderInfo;
               discover(p: ProviderInput): ModelInfo[]; validate(p: ProviderInput): Result;
               setDefault(id: string): void };
  skills:  { list(): SkillInfo[]; read(name: string): string; write(s: SkillInput): void };
  memory:  { list(): NoteInfo[]; search(q: string): NoteInfo[];
             read(slug: string): string | null; write(n: NoteInput): void };
  app:     { getSettings(): Settings; saveSettings(s: Settings): void;
             isLocked(): boolean; unlock(pin: string): Result; setup(w: SetupInput): void };
  onEvent(channel: 'chat-event' | 'chat-approval' | 'status', cb: (ev: unknown) => void): Unsubscribe;
}
```

Every handler returns a result envelope: `{ ok: true, data } | { ok: false, error: { code, message } }`. No exceptions cross the bridge.

**Chat streaming flow:** `chat.run()` → main spawns `runAgentTask` (existing loop, unchanged) → each `StreamEvent` serialized via `webContents.send('chat-event', ev)` → renderer `ChatStore` (port of `UIStore`, consuming the same events) updates → assistant-ui `useExternalStoreRuntime` renders. Approval interrupts arrive as `chat-approval` events `{ runId, request: HITLRequest }`; the renderer shows the ApprovalCard; `resolveApproval` resolves main's `requestApproval` promise and the run resumes on the same checkpoint. Cancel maps to the existing `AbortController` path (settling any open gate with reject-all first, as `cancel()` does today).

`StreamEvent`s are already plain JSON (`parseChunk` reduces LangGraph chunks to `{ kind, msg, depth }` POJOs), so IPC serialization needs no special handling.

## Chat UI (assistant-ui)

Renderer state: `ChatStore` — direct port of `UIStore` (same `consume`/`flushLive`, same `entries/todos/status/live` shape) fed by IPC events instead of the in-process stream.

```tsx
const runtime = useExternalStoreRuntime({
  messages: chatStore.entries,
  isRunning: chatStore.status === 'streaming',
  onNew: (m) => ipc.chat.run({ prompt: textOf(m), threadId }),
  onCancel: () => ipc.chat.cancel(threadId),
  convertMessage: toThreadMessage,
});
```

**`toThreadMessage` conversion (TranscriptEntry → assistant-ui parts):**
- `assistant` → text part (streamed by mutating the in-place message, matching `live.text` accumulation)
- `thinking` → reasoning part (collapsible; replaces the 🧠 dim block)
- `tool` / `toolResult` → `tool-call` + `tool-result` parts (collapsible cards with full args — no terminal 240-char truncation)
- `delegate` → tool-call part styled as a subagent section; `depth` rendered as nesting
- `user` / `system` / `error` → text parts with role styling

**Todo panel:** custom Shadcn card in the right rail driven by `chatStore.todos` (the `write_todos` state the seam already emits). assistant-ui has no todo concept. Same ○/◐/● icons.

**Approval gate mapping (ApprovalCard — Shadcn dialog inline in the thread):**

| Ink key | Desktop action | HITLResponse sent |
|---|---|---|
| `y` | Approve button | `{ type: "approve" }` for that actionRequest |
| `n` | Reject + reason field | `{ type: "reject", message: reason }` |
| `a` | "Allow all" (only when >1 batched) | `approve` for every actionRequest |
| `e` | "Edit command" (pre-filled input) | `{ type: "edit", ...editedCommand }` |

Reject-with-reason keeps current behavior (reason goes back to the model). Esc/stop while a card is open rejects-all before abort, mirroring `cancel()`.

**Slash commands** become UI affordances: `/todos /files /threads /skills /memory` → sidebar navigation; `/reset` → "New thread" button; composer history is assistant-ui's.

**Post-turn memory consolidation** stays in main (unchanged `consolidateMemory`); "remembered N notes" arrives as a `system` entry rendered as a subtle inline note/toast.

## Settings

### LLM provider config (ported from agentfork, adapted from multi-tenant Postgres to local)

- **Storage:** `app.sqlite` table `providers`: `{ id, name, type: "ollama"|"openai"|"anthropic", baseUrl?, chatModel?, isDefault, createdAt, updatedAt }`. API keys never in SQLite — encrypted via Electron `safeStorage` into `secrets.bin`.
- **Secret visibility (agentfork's endpoint-vs-secret split):** `baseUrl` returned to the renderer in full (it's an address); `apiKey` reported by name only (`credentialsConfigured: true`); edit form shows "leave blank to keep" and update merges.
- **UI:** settings → Providers: Shadcn DataTable + `llm-provider-form` port (name, type select, base URL, key, model picker).
- **Discovery:** per-provider modules in main (`discovery/ollama.ts`, `discovery/openai.ts`, `discovery/anthropic.ts` — mirroring agentfork's `libs/ai/src/discovery/`): Ollama `GET /api/tags`; OpenAI/Anthropic model-list endpoints. Validate = 1-token ping before save.
- **Agent wiring:** `model-factory.ts` maps `{ type, baseUrl, model, key }` → `ChatOllama` / `ChatOpenAI` / `ChatAnthropic` (LangChain chat models — native deepagents integration). `ollamaToolContentShim` attaches only for ollama. Changing the default provider rebuilds the agent for the next run. Active model shown in the chat header.
- **Precedence (kept):** provider row → `config.json` → env → defaults; the setup wizard writes the first row.

### Skills manager

Sidebar page listing skills from the registry dirs (name + frontmatter description, user vs project badge). View renders SKILL.md; edit via simple Markdown editor (textarea + preview — no Monaco in v1); "New skill" writes a `SKILL.md` scaffold. The in-chat `write_skill` approval flow is unchanged; approved skills appear on this page.

### Memory manager

Sidebar page over the existing `memory/store.ts`: notes list with search, Markdown view/edit, index regenerated on save. Consolidation stays automatic; the page is for inspection and pruning.

## Storage split

**Rule: whatever the agent reads/writes with its own tools stays markdown-on-disk; whatever only the app reads becomes SQLite.**

| Data | Where | Why |
|---|---|---|
| Chat threads / sessions | `checkpoints.sqlite` (existing `SqliteSaver`) + `threads` table (id, title, updatedAt) in `app.sqlite` | Durable threads are LangGraph state; titles derived from first user message for list UI |
| Providers, settings, lock hash | `app.sqlite` (new) | Structured app data, transactional CRUD, no agent tooling touches it |
| API keys | `secrets.bin` via `safeStorage` | Never plaintext; OS-keyed encryption |
| Skills | `~/.deepagents/hermes/skills/*/SKILL.md` | `createSkillsMiddleware` scans dirs natively; `load_skill`/`write_skill` are file tools; skills are human-readable, git-able, portable |
| Memory | `~/.deepagents/hermes/memory/*.md` | `read_memory`/`write_memory` + `consolidateMemory` write markdown; notes are inspectable knowledge |
| Identity | `agent.md` | `createMemoryMiddleware` loads it directly |
| OpenWiki knowledge | `workspace/openwiki/**/*.md` | OKF is file-based; the OpenWiki CLI expects a file tree |

Moving skills/memory to SQLite would fork `createSkillsMiddleware`/`createMemoryMiddleware`, translate every agent `read_file`/`write_file` on `/openwiki` into DB queries, and break the OpenWiki CLI — losing the native deepagents touch for nothing at this scale. The renderer is agnostic anyway (IPC handlers return `SkillInfo[]`/`NoteInfo[]` either way), so the decision is cheap to revisit.

## Auth: setup wizard + lock

- **First run** (no providers configured + no lock set): 3-step wizard — (1) name the assistant / write `agent.md` identity, (2) pick provider (Ollama default; OpenAI/Anthropic with key), (3) optional PIN. Writes settings, drops into chat.
- **Lock:** if a PIN is set, `app.isLocked()` gates the window at launch, on an idle timeout, and via a "Lock" menu item. PIN hashed (bcrypt/argon2) in `app.sqlite`; wrong-attempt backoff. The PIN derives the key for `secrets.bin`.
- **Honest limitation (out of scope v1):** SQLite checkpoints and markdown remain on disk unencrypted; the lock gates the UI and secrets only. Full at-rest encryption is a future item.
- No users, sessions, or server — the reference's auth UX without its server machinery.

## Error handling

- Result envelopes on every IPC handler; renderer shows errors inline or as toasts.
- Chat keeps today's semantics: `ECONNREFUSED` → friendly "Is the ollama daemon running?" hint with a retry button and a link to provider settings. Cancel/abort → "task cancelled" entry, not an error.
- Provider validation failures surface field-level in the settings form — never silent saves.
- Main-process agent errors log to `~/.deepagents/hermes/logs/` (rotating file logger) — no console scrollback in a desktop app.

## Testing

Keeping the repo's live-verification ethos, plus vitest for renderer units:

- **Unchanged:** existing seam scripts (`smoke`, `hitl-test`, `delegation-test`, `persistence-test`, `skills-test`, `memory-test`, `wiki-test`, `runner-test`) must keep passing after the move — proof the core wasn't broken by the restructure.
- **New vitest units (no model needed):** `ChatStore` against recorded `StreamEvent` fixtures (port of `ui-test.ts` philosophy); `toThreadMessage` conversion; `matchThreadPrefix` (moves with `resume.ts`); IPC payload Zod schemas; `model-factory` mapping.
- **One new live script:** `scripts/ipc-test.ts` — boots the main-process agent machinery headless (the same `runAgentTask` path the IPC chat handler uses) with a scripted approval callback.
- **Playwright-over-Electron E2E:** later; not v1-blocking.

## Rollout order (each step leaves the repo green)

1. **Scaffold** — electron-vite config, main/preload/renderer skeletons, move core into `src/main/agent/`, delete Ink (index.tsx, src/ui/, ink deps), fix script imports. Typecheck + all existing scripts pass.
2. **Chat spine** — IPC chat handlers + `ChatStore` + assistant-ui runtime + todo panel + approval card. `ipc-test.ts` lands here.
3. **Threads** — list/resume/history + `threads` table in `app.sqlite`.
4. **Providers** — providers table, discovery/validate, `model-factory`, settings UI; wizard replaces first-run.
5. **Skills + Memory pages** — IPC over the existing stores.
6. **Auth** — wizard + PIN lock + `secrets.bin`.
7. **Packaging polish** — app icon, `electron-builder` config (signed/notarized macOS dmg; Linux/Windows config-only), `bin/hermes.js` → `electron .`.

## Out of scope (v1)

Agent studio (visual graph builder), multi-tenancy/RBAC/orgs, dashboards/analytics/evaluation, MCP servers, SDK widget, connectors (telegram/whatsapp), background workers, full at-rest encryption, auto-update infrastructure, additional providers (Bedrock/vLLM/OpenRouter).