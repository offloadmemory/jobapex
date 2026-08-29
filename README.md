# JobApex

Your job search at its peak. A specialized AI job-search assistant that tracks every application, auto-applies, and handles outreach — being built on the CodeApex agent foundation: a Claude Code-style harness in pure TypeScript on [LangChain Deep Agents](https://docs.langchain.com/oss/javascript/deepagents/overview) with **planning/todo list, subagent delegation, real filesystem + shell, durable threads, auto-memory, and skills**, running on local [Ollama](https://ollama.com).

The foundation ships as **hermes**, a personal agent consumed here through an **Electron desktop app**: a [React](https://react.dev)/[Tailwind](https://tailwindcss.com)/[shadcn/ui](https://ui.shadcn.com)/[assistant-ui](https://www.assistant-ui.com/) chat window in the renderer, wired over typed, Zod-validated IPC to an in-process agent in the Electron main process.

> This is the starter codebase — the job tracker, auto-apply, and outreach features are being built on top of this agent foundation.

## Current status

- **Done (spec Phases 1-2):** Electron scaffold + typed IPC contract; chat spine with token streaming (thinking + text), todo panel, and the human-approval gate for shell commands; durable transcripts in the renderer; live IPC verification scripts.
- **Pending (later phases):** thread management UI, provider settings, skills UI, memory browser, auth, packaging/distribution.

## Prerequisites

- Node.js 22+
- A running [Ollama](https://ollama.com) daemon (the default model is `deepseek-v4-flash:0731-cloud` — or any local Ollama model with solid tool-calling). Set `OLLAMA_BASE_URL` if it isn't on `http://localhost:11434`.

## Fresh clone

```bash
npm install              # plain install; no --legacy-peer-deps needed
npm run rebuild:native   # rebuild better-sqlite3 against Electron's ABI
npm run dev              # start the Electron app (renderer + main hot-reload)
```

Two native-module gotchas on a fresh clone:

1. **ABI mismatch:** `better-sqlite3` ships a Node-ABI build; the app runs it inside Electron, so `npm run rebuild:native` (`@electron/rebuild`) is required once after install. If you skip it, the main process fails to load the sqlite checkpointer. Any script that loads SQLite must likewise run under *Electron's* Node — see [Verification scripts](#verification-scripts).
2. **Skipped Electron download:** some environments skip Electron's postinstall binary download. If `npm run dev` (or `npm run smoke`) can't resolve the Electron binary, run `node node_modules/electron/install.js` and retry; the `scripts/run-in-electron-node.sh` wrapper prints this hint too.

## Dev usage

```bash
npm run dev        # Electron app in dev mode
npm test           # typecheck both tsconfig trees (node + web)
npm run test:unit  # vitest unit tests (wire schemas, ChatStore, message mapping)
npm run ipc:test   # live end-to-end chat over the real IPC path (needs Ollama)
npm run smoke      # live agent smoke test (todos + file write + shell)
```

## Approvals

Every gated `execute`/`write_skill` call — including ones made by subagents — pauses the run and raises an **approval card** dialog in the app: approve, reject (your reason goes back to the model so it can adapt), bulk-allow all remaining batched actions, or edit the command inline before it runs. The card is deliberately the only affordance on screen (no dead X/Escape dismissal); the header's "New thread" stays clickable as the escape hatch for a hung gate, since it cancels the run before resetting. Canceling a running task (Stop button / "New thread") unwinds it cleanly with a `task cancelled` note in the transcript.

## Configuration

Config resolves in order: env vars → `~/.deepagents/hermes/config.json` → defaults.

| Env var | Default | Purpose |
|---|---|---|
| `OLLAMA_MODEL` | `deepseek-v4-flash:0731-cloud` | Any Ollama model with tool-calling |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama daemon |
| `AGENT_WORKSPACE` | `./workspace` | Agent sandbox directory |
| `OLLAMA_THINK` | `1` | Set `0` to disable think mode (for models that reject it) |
| `TAVILY_API_KEY` | _(unset)_ | Better web search; falls back to keyless DuckDuckGo |
| `LANGSMITH_TRACING` / `LANGSMITH_API_KEY` | _(unset)_ | Full tracing in LangSmith |

`config.json` may set `model`, `baseUrl`, `workspaceDir`, `memfs`, and `yolo`. Swapping providers (e.g. Anthropic) is a one-line change in `src/main/agent/agent.ts` — replace `ChatOllama` with any LangChain chat model.

## The agent core (hermes)

hermes' durable state lives in `~/.deepagents/hermes/`:

```
~/.deepagents/hermes/
├── agent.md            # your identity, loaded into every session
├── config.json         # optional settings (env vars override)
├── checkpoints.sqlite  # durable conversation threads
├── history             # command history (from the earlier CLI era)
├── skills/             # reusable skills (SKILL.md per dir)
└── memory/             # auto-generated Markdown notes + index.md
```

- **Durable threads:** every conversation is checkpointed to SQLite, so threads survive restarts (the desktop thread UI is a pending phase; the checkpointing itself already works).
- **Auto-memory:** after each completed turn, a consolidation pass extracts durable learnings (user facts, preferences, gotchas) into Markdown notes under `memory/`. The assistant surfaces a subtle "remembered N notes" line at the end of a turn; the agent reads that memory via `read_memory` before substantial work and can record notes via `write_memory`.
- **Skills:** `SKILL.md` files under `~/.deepagents/hermes/skills/` or the project `.deepagents/skills/`. The agent follows a skill via `load_skill` and proposes new ones via `write_skill` — which pauses for approval before anything is saved; rejecting sends your reason back so the agent can revise.
- **Knowledge base (OpenWiki):** the agent reads `/openwiki/index.md` before exploring and delegates durable learnings to the `librarian` subagent, which writes OKF-formatted notes in `workspace/openwiki/notes/`. `npm run wiki:update` / `wiki:init` regenerate the wiki with the OpenWiki CLI (`OPENWIKI_MODEL=... npm run wiki:update` to override the model, default `glm-5.2:cloud`).

## Architecture

```
src/
  main/                 Electron main process
    index.ts            window + lifecycle
    ipc/                typed IPC handlers (chat run/cancel/resolveApproval, app)
    agent/              the agent core, loaded in-process
      agent.ts          createDeepAgent wiring (model, backend, middleware)
      runtime.ts        agent service singleton: runTask / cancel / resolveApproval,
                        translating StreamEvents into renderer WireEvents
      agent-runner.ts   the stream loop, with an awaitable requestApproval callback
      stream-events.ts  chunk → StreamEvent parsing + HITL interrupt extraction
      config.ts         env + flags + ~/.deepagents/hermes/config.json
      paths.ts          canonical ~/.deepagents/hermes paths
      persistence.ts    SQLite checkpointer factory (durable threads)
      identity.ts       agent.md + AGENTS.md loaded into the prompt
      skills/           registry + load_skill / write_skill (gated)
      memory/           store, tools (read_memory / write_memory), consolidation pass
      subagents.ts      researcher / coder / critic definitions
      tools/search.ts   web_search (Tavily or DuckDuckGo)
      ollamaShim.ts     flattens tool-message content blocks for @langchain/ollama
      render.ts         stream-event pretty printer (console scripts use it)
  preload/              contextBridge exposing the typed `hermes.chat` API
  renderer/             React + Tailwind + shadcn/ui + assistant-ui
    src/App.tsx         shell layout (header, transcript, todos, composer)
    src/chat/           ChatRuntimeProvider (external-store runtime), ApprovalCard, ChatView
    src/lib/            ChatStore (transcript/status/approval state) + message mapping + typed ipc client
  shared/               WireEvent types + Zod schemas shared by main and renderer
```

The seam is layered and renderer-agnostic: `agent.stream(..., { streamMode: ["updates", "messages"], subgraphs: true })` yields raw chunks → `stream-events.ts` parses them into `StreamEvent`s → `agent-runner.ts` runs a task to completion behind an awaitable `requestApproval` callback → the main-process `runtime.ts` converts events into `WireEvent`s pushed over IPC → the renderer's `ChatStore` folds them into transcript entries. The Electron UI is currently the only consumer of the last hop (the old Ink REPL consumed the same seam via `render.ts` / console scripts).

> ⚠️ Real-FS mode executes shell commands on your machine unsandboxed (see `LocalShellBackend` docs) — the approval gate is the consent layer, not a sandbox. Use `memfs` mode for untrusted tasks, and never run fully-trusted-mode setups with tasks you don't fully trust.

## Verification scripts

`npm test` typechecks and `npm run test:unit` runs the vitest suites (wire/schemas, ChatStore, message mapping) with no model needed. The rest verify the agent live against a running Ollama daemon.

Because `better-sqlite3` is rebuilt for Electron's ABI, every live script runs TSX under **Electron's Node** (see [Fresh clone](#fresh-clone)) via the shared wrapper — plain `npx tsx scripts/...` fails with `ERR_DLOPEN_FAILED` (`ipc:test` uses the same wrapper).

| Script | Verifies |
|---|---|
| `npm run smoke` | planning todos, file write, shell execution, final summary |
| `npm run ipc:test` | real end-to-end chat over the typed IPC path |
| `npm run delegation-test` | `task`-tool delegation to coder + critic subagents |
| `npm run hitl-test` | approval gate pauses; rejection survives; approval executes |
| `npm run hitl-subagent-test` | the gate fires inside a delegated subagent and resumes |
| `npm run stream-test` | token-by-token prose + 🧠 reasoning deltas |
| `npm run gate-dual-check` | gate under dual stream mode |
| `npm run wiki-test` | knowledge write-back (librarian) + read-first on a fresh thread |
| `npm run persistence-test` | SQLite checkpointer; threads survive a restart and are recalled |
| `npm run skills-test` | `load_skill` returns the skill body; `write_skill` gate fires and writes on approve |
| `npm run memory-test` | post-turn consolidation appends a durable note (+ index) |
| `npm run runner-test` | agent-runner streams a gated task; the approval callback resolves it |

## Contributing

Issues and PRs welcome. Keep the small-modules spirit: no framework on top of the framework, typecheck the whole tree (`npm test`), and every agent-facing feature verified with a live script rather than a mock.

## License

[MIT](LICENSE)