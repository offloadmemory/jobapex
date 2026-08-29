# JobApex

Your job search at its peak. A specialized AI job-search assistant that tracks every application, auto-applies, and handles outreach — built on the CodeApex agent foundation: a Claude Code-style agent harness in pure TypeScript on [LangChain Deep Agents](https://docs.langchain.com/oss/javascript/deepagents/overview) with **planning/todo list, subagent delegation, real filesystem + shell, and web search**, driven from an interactive Ink TUI.

> This is the starter codebase — the job tracker, auto-apply, and outreach features are being built on top of this agent foundation.

## Prerequisites

- Node.js 22+
- A running [Ollama](https://ollama.com) daemon, signed in to Ollama cloud (the default model is `deepseek-v4-flash:0731-cloud`) — or any local Ollama model with solid tool-calling.

## Run

```bash
npm install --legacy-peer-deps   # openwiki pins older ink/react; see dev notes below
npm start              # interactive Ink TUI, real FS + shell rooted at ./workspace
npm start -- --memfs   # in-memory virtual filesystem, nothing touches disk
npm start -- --yolo    # skip shell-command approval prompts (trusted tasks only)
npm run smoke          # cheap end-to-end check (todos + file write + shell)
```

**Shell approvals (on by default):** every `execute` call pauses the run before it touches your machine (details under the demo below). Disable with `--yolo`; `--memfs` has no shell at all.

Give it a task at the prompt, e.g.:

> Research the top 3 TypeScript test runners, write a comparison to notes.md, then have the critic verify the file cites sources.

You'll watch it work like Claude Code in a **React Ink TUI**: a scrolling transcript (streaming answers with 🧠 dim thinking, 🔧 tool calls with results, 🤖 delegations indented per subagent), a live 📋 plan panel, a bordered `❯` input with command history (↑/↓), and a spinner + `esc to interrupt` while a task runs.

Thinking display requires a reasoning-capable model — the default `deepseek-v4-flash:0731-cloud` emits 🧠 reasoning deltas, as do `glm-5.2:cloud`, `kimi-k3:cloud`, `qwen3`, … Models without thinking support stream answers fine but emit no thinking tokens. Set `OLLAMA_THINK=0` if a model errors on think mode.

**Approvals, Claude Code-style:** every gated `execute`/`write_skill` call — including ones made by subagents — pauses into a yellow approval card: `y` allows the action you're looking at, `n` rejects (your reason goes back to the model so it can adapt), `a` bulk-allows all remaining actions when several are batched, and `e` (execute only) edits the command inline before it runs. Disable with `--yolo` (approvals are also off in `--memfs` mode, which has no shell). Ctrl+C or Esc cancels a running task; Ctrl+C while idle exits (press twice).

**REPL commands:** `/todos` `/files` `/threads` `/resume <id-or-prefix>` `/skills` `/memory [query]` `/help` `/reset` `/exit` — `/resume` matches unique thread-id prefixes.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `OLLAMA_MODEL` | `deepseek-v4-flash:0731-cloud` | Any Ollama model with tool-calling |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama daemon |
| `AGENT_WORKSPACE` | `./workspace` | Agent sandbox directory |
| `OLLAMA_THINK` | `1` | Set `0` to disable think mode (for models that reject it) |
| `TAVILY_API_KEY` | _(unset)_ | Better web search; falls back to keyless DuckDuckGo |
| `LANGSMITH_TRACING` / `LANGSMITH_API_KEY` | _(unset)_ | Full tracing in LangSmith |

Swapping providers (e.g. Anthropic) is a one-line change in `src/agent.ts` — replace `ChatOllama` with any LangChain chat model.

## Knowledge base (OpenWiki)

The agent maintains durable knowledge in `workspace/openwiki/`, integrated with [OpenWiki](https://docs.langchain.com/oss/openwiki/overview):

- **Read-first**: the system prompt tells the agent to consult `/openwiki/index.md` and `/openwiki/notes/index.md` before exploring or researching — knowledge survives across threads and restarts because it lives on disk, not in conversation state.
- **Write-back**: after tasks that produce durable learnings, the agent delegates to the `librarian` subagent, which records OKF-formatted notes in `/openwiki/notes/` (agent-authored space; generated wiki pages are never hand-edited).
- **Regeneration**: `npm run wiki:update` (or `wiki:init`) runs the OpenWiki CLI against your Ollama daemon (`openai-compatible` provider) to re-document the workspace. Model override: `OPENWIKI_MODEL=... npm run wiki:update` (default `glm-5.2:cloud`).
- OpenWiki's pointer block in `workspace/AGENTS.md` is loaded as agent memory at startup, closing the discovery loop.

## Personal assistant (hermes)

The same agent ships as a personal assistant named **hermes** — `npx hermes` via the package `bin`, or `npm start`. Its durable state lives in `~/.deepagents/hermes/`:

```
~/.deepagents/hermes/
├── agent.md            # your identity, loaded into every session
├── config.json         # optional settings (env vars override)
├── checkpoints.sqlite  # durable conversation threads
├── history             # REPL command history
├── skills/             # reusable skills (SKILL.md per dir)
└── memory/             # auto-generated Markdown notes + index.md
```

- **Durable threads:** every conversation is checkpointed to SQLite, so threads survive restarts — `/threads` lists saved ones, `/resume <id>` continues one.
- **Auto-memory:** after each completed turn, a consolidation pass extracts durable learnings (user facts, preferences, gotchas) into Markdown notes under `memory/`. The system prompt tells the agent to read that memory via the `read_memory` tool before substantial work, so past learnings inform new sessions; the agent can also record notes itself via the `write_memory` tool; `/memory [query]` lists or searches the notes.
- **Skills:** skills are `SKILL.md` files in `~/.deepagents/hermes/skills/` or the project `.deepagents/skills/` dir. The agent follows a skill via the `load_skill` tool, and proposes new ones via `write_skill` — which pauses for your approval (`[y]es / [n]o`) before anything is saved; rejecting sends your reason back so the agent can revise. `/skills` lists what's available.
- **Settings:** `~/.deepagents/hermes/config.json` may set `model`, `baseUrl`, `workspaceDir`, `memfs`, and `yolo`; env vars take precedence over the file, which takes precedence over defaults — and the `--memfs` / `--yolo` flags still force.

## Architecture

```
src/
  config.ts       env + flags + ~/.deepagents/hermes/config.json
  paths.ts        canonical ~/.deepagents/hermes paths
  agent.ts        createDeepAgent wiring (model, backend, middleware, memory)
  persistence.ts  SQLite checkpointer factory (durable threads)
  identity.ts     agent.md + AGENTS.md loaded into the prompt
  skills/
    registry.ts   discovers SKILL.md files (user + project dirs)
    tools.ts      load_skill / write_skill (gated)
  memory/
    store.ts      Markdown memory notes + index.md
    tools.ts      read_memory / write_memory
    consolidate.ts  post-turn consolidation pass
  subagents.ts    researcher / coder / critic definitions
  tools/search.ts web_search (Tavily or DuckDuckGo)
  ollamaShim.ts   flattens tool-message content blocks for @langchain/ollama
  stream-events.ts  chunk → StreamEvent parsing + HITL interrupt extraction (shared)
  agent-runner.ts   the stream loop, with an awaitable requestApproval callback
  render.ts       stream-event pretty printer (console scripts use it)
  index.tsx       the Ink REPL entry (wiring + slash commands)
  ui/
    store.ts      observable UI state: interprets StreamEvents into transcript
    App.tsx       layout: Static transcript, live area, approval card, input
    resume.ts     pure /resume prefix matcher
    components/   Header, TodoPanel, LiveStream, TranscriptEntryView,
                  InputBox (history nav), ApprovalCard (y/n/a/e)
bin/hermes.js     the `hermes` binary launcher
workspace/        agent sandbox; AGENTS.md in it is loaded as persistent memory
```

What `deepagents` provides out of the box: the `write_todos` planning tool (via `todoListMiddleware`), the `task` tool that spawns isolated subagents, filesystem tools (`ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`) and `execute` for shell (via `LocalShellBackend`), context summarization, `AGENTS.md` memory loading, plus the native systems hermes builds on — `createSkillsMiddleware` (skill registry + progressive disclosure), `createMemoryMiddleware` (identity file loading), and the LangGraph `SqliteSaver` checkpointer.

The UI seam is layered: `agent.stream(..., { streamMode: ["updates", "messages"], subgraphs: true })` yields raw chunks → `stream-events.ts` parses them into `StreamEvent`s and extracts approval interrupts → `agent-runner.ts` streams a task to completion behind an awaitable `requestApproval` callback → consumers interpret events into their own presentation (`render.ts` for console scripts, `src/ui/store.ts` for the Ink UI). A web UI would be a third consumer of the same seam.

> ⚠️ Real-FS mode executes shell commands on your machine unsandboxed (see `LocalShellBackend` docs) — the approval gate is the consent layer, not a sandbox. Use `--memfs` for untrusted tasks, and never combine `--yolo` with tasks you don't fully trust.

## Verification scripts

There are no mocked unit tests — this is an integration POC, verified live against a running Ollama daemon (`npm test` runs the typecheck only):

| Script | Verifies |
|---|---|
| `npx tsx scripts/smoke.ts` | planning todos, file write, shell execution, final summary |
| `npx tsx scripts/delegation-test.ts` | `task`-tool delegation to coder + critic subagents |
| `npx tsx scripts/hitl-test.ts` | approval gate pauses; rejection survives; approval executes |
| `npx tsx scripts/hitl-subagent-test.ts` | the gate fires inside a delegated subagent and resumes |
| `npx tsx scripts/stream-test.ts` | token-by-token prose + 🧠 reasoning deltas |
| `npx tsx scripts/gate-dual-check.ts` | gate under dual stream mode (exact REPL path) |
| `npx tsx scripts/wiki-test.ts` | knowledge write-back (librarian) + read-first on a fresh thread |
| `npx tsx scripts/persistence-test.ts` | SQLite checkpointer; threads survive a restart and are recalled |
| `npx tsx scripts/skills-test.ts` | `load_skill` returns the skill body; `write_skill` gate fires and writes on approve |
| `npx tsx scripts/memory-test.ts` | post-turn consolidation appends a durable note (+ index) |
| `npx tsx scripts/runner-test.ts` | agent-runner streams a gated task; the approval callback resolves it |
| `npx tsx scripts/ui-test.ts` | deterministic Ink UI checks: store interpretation, components, approval card, App render (no model needed) |

## Contributing

Issues and PRs welcome. Keep the POC spirit: small modules, no framework on top of the framework, and every feature verified with a live script rather than a mock.

Dev note: `npm install` may need `--legacy-peer-deps` — the `openwiki` dev dependency pins older ink/react versions; npm resolves them nested under `node_modules/openwiki` and the top-level ink@7/react@19 are what the UI uses.

## License

[MIT](LICENSE)
