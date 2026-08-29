# Hermes Assistant — Design

**Date:** 2026-08-28
**Status:** Approved (verbally in session)

## Goal

Evolve the `deep-agents-101` POC into a **personal assistant CLI** shaped like the Hermes Agent framework — same capability categories (skills toolset, auto-memory, global + project identity, subagents, CLI) — but designed cleanly on top of the existing LangChain Deep Agents stack, not a line-for-line clone of Hermes's API.

The assistant must gain three capabilities the POC lacks today:

1. **Skill loading** — a catalog of `SKILL.md` files the agent can list and load on demand.
2. **Auto skill generation** — the agent proposes new skills when it notices a repeatable workflow; the user approves before a skill becomes loadable.
3. **Auto memory generation** — durable learnings are captured automatically after each task, without explicit delegation.

Plus the foundations a personal assistant needs: durable threads, a global identity, and a real CLI.

## Decisions

- **Target:** Hermes-shaped, LangChain-native. Same capability categories as Hermes, designed for the Deep Agents stack. No `SOUL.md`/`skill_view`/`delegate_task` API cloning.
- **Autonomy:** Hybrid. Memory capture is fully automatic and append-only (low risk). Skill generation is gated — the agent proposes, the user approves via the existing HITL gate.
- **Persistence:** Full. Conversation threads survive restarts (durable checkpointer), and memory + skills live on disk.
- **Provider:** Keep Ollama as the default model; keep the provider seam swappable (already true — `ChatOllama` is one line in `agent.ts`).
- **Approach:** Incremental evolution. Keep everything that works (subagents, HITL gate, streaming, OpenWiki) and add the missing subsystems as new modules, in four independently shippable phases.
- **Phase order:** Foundation-first — persistence + identity → skills → auto-memory → CLI.

## Architecture

```
src/
  config.ts            # env + ~/.hermes-assistant/config.json + flags (extended)
  agent.ts             # createDeepAgent wiring (extended: skills tools, memory, durable checkpointer)
  subagents.ts         # researcher / coder / critic / librarian (unchanged)
  persistence.ts       # durable checkpointer factory (NEW)
  identity.ts          # load SOUL.md + AGENTS.md as memory (NEW)
  skills/
    registry.ts        # discover + read SKILL.md files (NEW)
    tools.ts           # list_skills / load_skill / write_skill (NEW)
  memory/
    store.ts           # durable memory store (Markdown notes + index) (NEW)
    consolidate.ts     # post-turn auto-capture pass (NEW)
  tools/search.ts      # web_search (unchanged)
  render.ts            # stream renderer (extend: skill + memory events)
  index.ts             # REPL (extend: slash commands, history, post-turn consolidation)
  ollamaShim.ts        # unchanged
```

### Phase 1 — Persistence + identity

- **Durable threads:** replace `MemorySaver` with a SQLite-backed checkpointer (`@langchain/langgraph-checkpoint-sqlite`) at `~/.hermes-assistant/checkpoints.sqlite`. Threads survive restarts. Add `/threads` (list past threads) and `/resume <id>` (resume one).
- **Identity:** global `~/.hermes-assistant/SOUL.md` — the assistant's persistent identity, preferences, and standing instructions — loaded as memory alongside project `AGENTS.md`.

### Phase 2 — Skill system

Skills are `SKILL.md` files (frontmatter `name` + `description`, then instructions), in two scopes:

- Global: `~/.hermes-assistant/skills/<name>/SKILL.md`
- Project: `.skills/<name>/SKILL.md` (in the workspace)

Three tools added to the agent:

- **`list_skills`** — returns the catalog (name + description) so the agent knows what's available.
- **`load_skill(name)`** — reads a `SKILL.md` and returns its content; the agent follows it. On-demand loading, no dynamic prompt injection.
- **`write_skill(name, description, content)`** — **gated** via `interruptOn` (same pattern as the existing `execute` gate). The agent proposes a new skill when it notices a repeatable workflow; the HITL gate pauses for approve/edit/reject; on approve the file is written and becomes loadable.

The system prompt gains a rule: *when you've done a non-obvious procedure more than once, propose it as a skill via `write_skill`.*

### Phase 3 — Auto-memory

- **Post-turn consolidation:** after each task finishes, the REPL automatically runs a cheap consolidation pass (a small model call) that reads the just-finished conversation, extracts durable learnings (decisions, gotchas, user preferences, verified commands), and **appends** them to memory — no explicit librarian delegation, no approval (append-only).
- **Store:** `~/.hermes-assistant/memory/` — Markdown notes (one topic per file) + an `index.md`, mirroring the OpenWiki OKF pattern but simpler and global (it's about the *user*, not the project). Project-specific knowledge stays in OpenWiki via the existing librarian.
- **Read-first:** the system prompt tells the agent to consult memory before starting substantial work, so past learnings inform new sessions.

### Phase 4 — CLI polish

- **Named binary:** `bin` entry in `package.json` → `hermes` (installable via `npm i -g`).
- **Config file:** `~/.hermes-assistant/config.json` (model, baseUrl, workspace, defaults), merged env > file > defaults.
- **History:** readline history persisted to `~/.hermes-assistant/history`.
- **Richer commands:** `/threads`, `/resume <id>`, `/skills`, `/memory <query>`, `/help`.

## Error handling

- Skill-load failures, memory-write failures, and checkpointer errors degrade gracefully (log + continue the REPL) — never crash the session.
- The consolidation pass is best-effort: if it fails, the task result is still delivered and the failure is logged, not surfaced as a task error.
- Missing Ollama daemon or model → clear startup error with fix hint (existing behavior, preserved).

## Testing

Keep the repo's "live script, not mock" ethos — one verification script per phase, plus `tsc --noEmit` as the gate:

| Script | Verifies |
|---|---|
| `scripts/persistence-test.ts` | threads survive a restart; `/resume` continues a past thread |
| `scripts/skills-test.ts` | `list_skills` + `load_skill` work; `write_skill` pauses for approval and writes on approve |
| `scripts/memory-test.ts` | post-turn consolidation appends a durable note; a fresh thread reads it back |

## Risks to verify during implementation

Not design blockers — each is checked at the start of its phase, with a fallback:

1. **SQLite checkpointer compatibility** with the pinned `@langchain/langgraph` version. Fallback: a small JSON-file checkpointer.
2. **`deepagents` `memory` option** may only take workspace-relative paths. If so, inject `SOUL.md` into the system prompt instead.
3. **Gating a non-`execute` tool** (`write_skill`) via `interruptOn` — confirm the gate fires for arbitrary tools, not just `execute`.
4. **Consolidation cost** — keep the post-turn pass cheap (small model or summary) so it doesn't stall the REPL.

## Out of scope (YAGNI)

- Plugin registry / third-party plugin loading (Hermes's `~/.hermes/plugins/`).
- Multi-provider abstraction layer (Ollama stays default; swapping is already one line).
- Web UI (the `agent.ts` / `render.ts` seam is preserved for a future UI, but none is built).
- Multi-agent kanban board (`hermes kanban`).
- LangSmith setup (works via env vars if the user exports them).

## Addendum (2026-08-28): native deepagents systems

Skills, memory/identity, and settings are wired through deepagents' native systems rather than built from scratch: `createSkillsMiddleware` (progressive disclosure + registry), `createMemoryMiddleware` (identity file loading), and the LangGraph checkpointer (`SqliteSaver`) for durable threads. Custom additions: the `load_skill` tool (the agent's filesystem is jailed to the workspace, so skill bodies are fetched via node:fs instead of read_file), the gated `write_skill` tool (HITL approval before any skill is saved), and the post-turn consolidation pass that writes Markdown memory notes. Directory convention: `~/.deepagents/hermes/` (agent.md, skills/, memory/, checkpoints.sqlite, config.json, history) — this supersedes the `~/.hermes-assistant/` path used in the phase sections above, and the user identity file is `agent.md` rather than `SOUL.md`.
