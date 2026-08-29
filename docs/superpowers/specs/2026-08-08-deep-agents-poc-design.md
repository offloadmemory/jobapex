# Deep Agents POC — Design

**Date:** 2026-08-08
**Status:** Approved (verbally in session)

## Goal

A pure-TypeScript proof of concept of LangChain Deep Agents (`deepagents` npm package) with the full Claude Code-style harness: planning/todo list, subagent delegation, real filesystem + shell access, and web search — driven from an interactive terminal REPL. The agent module must be UI-agnostic so a web UI can be layered on later.

## Decisions

- **Model:** Ollama, default `glm-5.2:cloud` (strong tool-calling, runs through the local `ollama` daemon with cloud offload). Overridable via `OLLAMA_MODEL` env var. Swapping providers later is a one-line change in `config.ts`.
- **Capabilities:** Real filesystem + shell via `LocalShellBackend` rooted at `./workspace`. `--memfs` flag swaps to `StateBackend` (in-memory virtual FS, nothing touches disk). Web search via Tavily when `TAVILY_API_KEY` is set, otherwise a keyless DuckDuckGo fallback (`duck-duck-scrape`).
- **Interface:** Interactive REPL with streamed progress rendering.

## Architecture

```
src/
  config.ts       # env parsing, model factory (ChatOllama), workspace root, flags
  tools/search.ts # web_search tool: Tavily if key present, else DuckDuckGo
  subagents.ts    # researcher / coder / critic subagent definitions
  agent.ts        # createDeepAgent wiring (tools, subagents, backend, checkpointer)
  render.ts       # pretty-printing of stream events (todos, tool calls, subagents)
  index.ts        # REPL loop
  ollamaShim.ts   # middleware: flattens ToolMessage content blocks to strings
workspace/        # agent sandbox (real FS + shell working directory)
workspace/AGENTS.md # persistent instructions loaded via memory option
```

### Implementation notes (discovered while building)

- `todoListMiddleware` lives in `langchain` and is opt-in via `middleware:` — deepagents does not add it by default.
- `@langchain/ollama` rejects ToolMessages with content-block arrays ("Non string tool message content is not supported"); deepagents FS tools emit them. Fixed with `ollamaToolContentShim`, attached to the main agent and to every custom subagent (custom subagents don't inherit main-agent middleware).
- `LocalShellBackend` options are `{ rootDir, virtualMode, inheritEnv }`; FS tool paths are virtual (`/file.txt`) while `execute` runs with the workspace as cwd — the system prompt explains this to the model.

### Addendum (2026-08-08): human-in-the-loop approval gate

Added after a live incident: the model refused a shell task claiming it was "in an isolated sandbox" — a hallucinated self-model, since `execute` is unsandboxed on the host.

- `interruptOn: { execute: { allowedDecisions: ["approve","edit","reject"] } }` on the main agent AND injected into every subagent (subagents don't inherit it). Off with `--yolo`, and in `--memfs` mode.
- REPL pauses on `__interrupt__` chunks and prompts y/n/edit; rejection messages flow back to the model; resume via `Command({ resume: { decisions } })` on the same thread.
- System prompt and `workspace/AGENTS.md` now state capabilities honestly (real machine, unsandboxed shell, approval gate) so the model reasons from facts instead of trained priors.
- Live-verified: `scripts/hitl-test.ts` (pause → reject survives → approve executes) and `scripts/hitl-subagent-test.ts` (gate fires inside a delegated subagent and resumes).

### Addendum (2026-08-09): OpenWiki knowledge base

The agent now maintains persistent knowledge in `workspace/openwiki/`:

- Bootstrapped with `openwiki` CLI v0.3.1 (npm devDep) via its `openai-compatible` provider pointed at the local Ollama daemon (`scripts/wiki.sh`, `npm run wiki:init|wiki:update`). v0.3.1 init produces `index.md` + `_skeleton.md`; `--update` runs flesh out pages.
- Read path: OpenWiki's pointer block auto-inserted into `workspace/AGENTS.md` (already loaded as memory) + a read-first rule in the system prompt.
- Write path: new `librarian` subagent owns `/openwiki/notes/` (OKF front matter, one topic per file, index.md maintained); generated pages are never hand-edited, matching OpenWiki's contract.
- Live-verified by `scripts/wiki-test.ts`: a learnings task produced an OKF note + index entry, and a fresh thread answered from the knowledge base after reading `/openwiki` files (5 wiki reads observed).

### Components

- **`agent.ts`** — `createDeepAgent({ model, tools: [webSearch], subagents, backend, checkpointer: new MemorySaver(), memory: ["/AGENTS.md"] })`. Deep Agents provides the todo middleware, `task` delegation tool, and FS tools (`ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`, `execute`) out of the box.
- **Subagents** (`{ name, description, systemPrompt, tools }`):
  - `researcher` — web search focused; returns compressed findings.
  - `coder` — writes files and runs shell commands in the workspace.
  - `critic` — review of produced artifacts; read-only enforced by prompt, not `permissions` (deepagents rejects path permissions on exec-capable backends since shell can bypass them).
- **REPL** (`index.ts` + `render.ts`) — streams `agent.stream(..., { streamMode: "updates" })`; renders 📋 todo-list changes, 🤖 `task` (subagent) calls, 🔧 other tool calls with truncated args/results, and the final assistant message. Commands: `/todos`, `/files`, `/reset` (new thread), `/exit`.
- **Threading** — `MemorySaver` checkpointer + a `thread_id` per REPL session so multi-turn context persists; `/reset` mints a new thread id.

## Error handling

- Tool/shell failures return error text to the model (self-correction) — handled by deepagents.
- Shell inherits `LocalShellBackend` defaults; workspace dir is created on boot.
- Stream errors are caught per-turn: printed, REPL continues. Ctrl+C cancels the in-flight task (AbortController), second Ctrl+C exits.
- Missing Ollama daemon or model → clear startup error with fix hint.

## Testing

POC-level: an end-to-end smoke run (scripted task exercising todos, a subagent, file write, and shell) plus manual REPL use. No unit tests.

## Out of scope (YAGNI)

Web UI, persistence across process restarts (StoreBackend), human-in-the-loop interrupts, LangSmith setup (works via env vars if user exports them), multi-provider abstraction layer.
