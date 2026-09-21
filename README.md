# JobApex

Your job search at its peak. A specialized AI job-search assistant that tracks every application, auto-applies, and handles outreach — being built on the CodeApex agent foundation: a Claude Code-style harness in pure TypeScript on [LangChain Deep Agents](https://docs.langchain.com/oss/javascript/deepagents/overview) with **planning/todo list, subagent delegation, real filesystem + shell, durable threads, auto-memory, and skills**, running on local [Ollama](https://ollama.com).

The foundation ships as **hermes**, a personal agent consumed here through an **Electron desktop app**: a [React](https://react.dev)/[Tailwind](https://tailwindcss.com)/[shadcn/ui](https://ui.shadcn.com)/[assistant-ui](https://www.assistant-ui.com/) chat window in the renderer, wired over typed, Zod-validated IPC to an in-process agent in the Electron main process.

> This is the starter codebase — the job tracker, auto-apply, and outreach features are being built on top of this agent foundation. The JobApex product identity and the shipped binary do not line up yet: `package.json` keeps `name: jobapex` plus the job-search `description`, while the desktop app ships as **hermes**. The mismatch is deliberate for now and resolves when the domain features land.

## Current status

- **Done (spec Phases 1-2):** Electron scaffold + typed IPC contract; chat spine with token streaming (thinking + text), todo panel, and the human-approval gate for shell commands; durable transcripts in the renderer; live IPC verification scripts.
- **Done (spec Phases 3-6):** thread list/resume backed by a `threads` table in `app.sqlite`; assistant + provider settings with per-provider model discovery and validation (`ChatOllama` / `ChatOpenAI` / `ChatAnthropic`); skills browser over `SKILL.md`; memory browser with search + Markdown editing; first-run setup wizard and a PIN lock (scrypt hash, attempt backoff, idle auto-lock) that gates the app and the agent in the main process. See [docs/superpowers/specs/2026-09-12-beta-surfaces.md](docs/superpowers/specs/2026-09-12-beta-surfaces.md) for the per-surface inventory, IPC and acceptance criteria.
- **Done (spec hardening):** a rotating file log at `~/.deepagents/hermes/logs/hermes.log` for main-process failures, an application-menu **Lock Now** item (`⌘L`, enabled once a PIN is stored) that locks in the main process and pushes the state to the window, and a chat failure row above the composer with **Retry** / **Provider settings**.
- **Done (spec Phase 7):** packaging via `electron-builder` — `npm run dist:dir` builds `dist/mac-arm64/hermes.app`, `npm run dist` the `dist/hermes-1.0.0-arm64.dmg` (icon generated from `build/icon.svg`); Linux AppImage and Windows NSIS are config-only. The same round closed the composer slash commands (`/todos`, `/threads`, `/skills`, `/memory`, `/settings`, `/reset`, `/help`), memory-note deletion from the Memory page, and the PIN-derived key for `secrets.bin` (scrypt → AES-256-GCM). See "Round 3 — remaining gaps closed" in the same spec.
- **Done (appearance — accent colors):** the Appearance card carries **accent colors** on top of the mode. System / Light / Dark stays, and Neutral / Blue / Violet / Emerald / Amber / Rose repaint `--primary`, `--primary-foreground` and `--ring`, so buttons, the selected sidebar row, the logo tile and focus rings take the hue in both modes. Mode and accent are stored together in `settings` (`theme`, `accent`) and applied to `<html>` as `dark` + `data-accent`; every accent holds ≥4.9:1 contrast between its fill and its foreground text in both modes. The unit suite is now 12 files / 142 tests, and `npm run settings:test` covers the accent round-trip plus the unknown-value fallback.
- **Done (round 4 — beta sweep):** every remaining beta surface is either implemented or documented as out of scope. New in the app: the **Files / Workspace** page (tree, read, edit, save, new file, reveal, drag-and-drop attachments staged into `workspace/uploads/`), **Export transcript**, **theme** (system/light/dark), **thread search / rename / delete**, **skill create / rename / delete**, **memory-note rename**, **provider delete / clear-key**, the **About & diagnostics** card, and a renderer→main log bridge so packaged failures land in `hermes.log`. CI (`.github/workflows/ci.yml`) runs typecheck + unit tests on every push/PR; the unit suite is now 11 files / 137 tests. See [docs/superpowers/specs/2026-09-12-round-4-unimplemented-surfaces.md](docs/superpowers/specs/2026-09-12-round-4-unimplemented-surfaces.md) for the per-surface inventory, the two defects fixed (re-running setup duplicated the provider row; update metadata was emitted for an updater that does not exist) and what stays out of scope for v1 (code signing/notarization, auto-update, connectors, dashboards, at-rest encryption beyond `secrets.bin`).

What is still not built — with a per-item plan, blockers and effort, rather than a bare "out of scope" list — lives in [docs/superpowers/specs/2026-09-12-unbuilt-features.md](docs/superpowers/specs/2026-09-12-unbuilt-features.md). Every v1 surface is wired (39/39 IPC channels, six nav pages, no stubs); the open items are the deferred set: MCP servers, scheduled runs, analytics/eval, Bedrock, at-rest encryption, auto-update, connectors, agent studio, multi-tenancy, SDK widget, signing, cross-platform packaging.

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
npm run test:unit  # vitest unit tests (wire schemas, ChatStore, message mapping, workspace file containment)
npm run ipc:test   # live end-to-end chat over the real IPC path (needs Ollama)
npm run smoke      # live agent smoke test (todos + file write + shell)
npm run dist:dir   # package dist/mac-arm64/hermes.app (no installer)
npm run dist       # package the installer (macOS .dmg; Linux/Windows config-only)
npm run wiki:update # regenerate the OpenWiki knowledge base (npx + Ollama; wiki:init to seed it)
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

`config.json` may set `model`, `baseUrl`, `workspaceDir`, `memfs`, and `yolo`; that path is the fallback for headless runs and the live scripts. In the app, providers are rows in `app.sqlite` managed under **Settings → Add provider**, and `src/main/agent/model-factory.ts` maps the active row to `ChatOllama` / `ChatOpenAI` / `ChatAnthropic` — switching providers is a UI action, not a code change.

## The agent core (hermes)

hermes' durable state lives in `~/.deepagents/hermes/`:

```
~/.deepagents/hermes/
├── agent.md            # your identity, loaded into every session
├── config.json         # optional settings (env vars override)
├── app.sqlite          # app state: threads index, providers, settings, PIN + auth backoff
├── secrets.bin         # API keys: PIN-derived AES-256-GCM (v2), Electron safeStorage when no PIN is set
├── checkpoints.sqlite  # durable conversation threads
├── history             # command history (from the earlier CLI era)
├── logs/hermes.log     # rotating JSON-line log (512 KiB, keeps .1-.3)
├── skills/             # reusable skills (SKILL.md per dir)
└── memory/             # auto-generated Markdown notes + index.md
```

- **Durable threads:** every conversation is checkpointed to SQLite, so threads survive restarts. Thread titles/`updatedAt` live in `app.sqlite`; the transcript itself is read back from the checkpointer, so the Threads view and a reopened thread both show the real conversation.
- **Auto-memory:** after each completed turn, a consolidation pass extracts durable learnings (user facts, preferences, gotchas) into Markdown notes under `memory/`. The assistant surfaces a subtle "remembered N notes" line at the end of a turn; the agent reads that memory via `read_memory` before substantial work and can record notes via `write_memory`.
- **Skills:** `SKILL.md` files under `~/.deepagents/hermes/skills/` or the project `.deepagents/skills/`. The agent follows a skill via `load_skill` and proposes new ones via `write_skill` — which pauses for approval before anything is saved; rejecting sends your reason back so the agent can revise.
- **Knowledge base (OpenWiki):** the agent reads `/openwiki/index.md` before exploring and delegates durable learnings to the `librarian` subagent, which writes OKF-formatted notes in `workspace/openwiki/notes/`. `npm run wiki:update` / `wiki:init` regenerate the wiki with the OpenWiki CLI (`OPENWIKI_MODEL=... npm run wiki:update` to override the model, default `glm-5.2:cloud`).

## Architecture

```
src/
  main/                 Electron main process
    index.ts            window + lifecycle
    ipc/                typed IPC handlers (chat, app/auth, threads, skills, memory, providers, files)
    app/                app state, separate from the agent: paths, app.sqlite,
                        secrets (PIN-derived AES-256-GCM, safeStorage fallback),
                        threads index, providers, PIN/auth, settings + setup
    agent/              the agent core, loaded in-process
      model-factory.ts  provider row → ChatOllama / ChatOpenAI / ChatAnthropic
      discovery/        per-provider model discovery + validation (ollama, openai, anthropic)
      agent.ts          createDeepAgent wiring (model, backend, middleware)
      runtime.ts        agent service singleton: runTask / cancel / resolveApproval,
                        translating StreamEvents into renderer WireEvents
      agent-runner.ts   the stream loop, with an awaitable requestApproval callback
      stream-events.ts  chunk → StreamEvent parsing + HITL interrupt extraction
      config.ts         env + flags + ~/.deepagents/hermes/config.json
      paths.ts          canonical ~/.deepagents/hermes paths
      persistence.ts    SQLite checkpointer factory (durable threads)
      identity.ts       agent.md + AGENTS.md loaded into the prompt
      skills/           registry + load_skill / write_skill (gated) + file store for the UI
      memory/           store, tools (read_memory / write_memory), consolidation pass
      subagents.ts      researcher / coder / critic definitions
      tools/search.ts   web_search (Tavily or DuckDuckGo)
      ollamaShim.ts     flattens tool-message content blocks for @langchain/ollama
      render.ts         stream-event pretty printer (console scripts use it)
  preload/              contextBridge exposing the typed `hermes` API (chat, app, threads,
                        skills, memory, providers)
  renderer/             React + Tailwind + shadcn/ui + assistant-ui
    src/App.tsx         shell + nav + gate (setup wizard → PIN lock → main shell)
    src/chat/           ChatRuntimeProvider (external-store runtime), ApprovalCard, ChatView,
                        commands.ts (slash-command table + parser)
    src/setup/          SetupWizard (identity/provider/PIN) + LockScreen
    src/threads/        thread list (title, age, message count) → resume into Chat
    src/skills/         skills list/preview + Markdown editor + "New skill"
    src/memory/         notes list, search, Markdown view/edit, rename, delete with confirmation
    src/settings/       assistant identity + idle lock, providers, theme/accent, About/diagnostics, PIN security
    src/files/          workspace tree, reader/editor, new file, reveal, attachment drop target
    src/theme.ts        system/light/dark + accent color applied to <html> and persisted in settings
    src/lib/            ChatStore (transcript/status/approval state) + message mapping + typed ipc client
                        + log.ts (renderer failures mirrored into the main-process log)
  shared/               WireEvent/wire types + Zod schemas shared by main and renderer
```

The seam is layered and renderer-agnostic: `agent.stream(..., { streamMode: ["updates", "messages"], subgraphs: true })` yields raw chunks → `stream-events.ts` parses them into `StreamEvent`s → `agent-runner.ts` runs a task to completion behind an awaitable `requestApproval` callback → the main-process `runtime.ts` converts events into `WireEvent`s pushed over IPC → the renderer's `ChatStore` folds them into transcript entries. The Electron UI is currently the only consumer of the last hop (the old Ink REPL consumed the same seam via `render.ts` / console scripts).

> ⚠️ Real-FS mode executes shell commands on your machine unsandboxed (see `LocalShellBackend` docs) — the approval gate is the consent layer, not a sandbox. Use `memfs` mode for untrusted tasks, and never run fully-trusted-mode setups with tasks you don't fully trust.

## Verification scripts

`npm test` typechecks and `npm run test:unit` runs the vitest suites (11 files / 137 tests: wire schemas, ChatStore, message mapping, slash commands, model-factory provider mapping, log rotation, workspace file containment and path-escape refusal, agent config, provider discovery) with no model needed; CI runs the same two commands on every push and PR (`.github/workflows/ci.yml`). The rest verify the agent live against a running Ollama daemon.

When the main process fails, the reason is in `~/.deepagents/hermes/logs/hermes.log` (one JSON
object per line: `ts`, `level`, `scope`, `message`, `detail`) — IPC failures, agent-run errors and
unhandled exceptions all land there.

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
| `npm run threads:test` | thread list newest-first, history replay, resume continues the same thread |
| `npm run skills:ui-test` | skills list/read/overwrite through the UI store (byte-for-byte body) |
| `npm run memory:ui-test` | note list, search hit/miss, read and edit round-trip, delete pruning the file and `index.md` |
| `npm run settings:test` | provider discovery/validation/save + default, assistant/idle settings, PIN set/keep/remove |
| `npm run auth:test` | setup wizard, PIN gate, wrong-PIN backoff, lock/unlock, PIN removal |

The five `*:test` scripts above run against a throwaway `HOME` (`HOME=$(mktemp -d)` +
`HERMES_TEST_HOME=1`); `scripts/lib/isolated-home.ts` refuses to start if that flag is absent, so
they can never touch your real `~/.deepagents/hermes/`.

## Packaging

`npm run dist:dir` produces `dist/mac-arm64/hermes.app`; `npm run dist` also builds the installer (`dist/hermes-<version>-<arch>.dmg` plus its `.blockmap` on macOS). The config lives in the `build` block of `package.json` — app id `com.jobapex.hermes`, icon from `build/icon.png` (generated once from `build/icon.svg`), `asar: true`, `npmRebuild: false`, `mac.identity: null` (unsigned; signing/notarization is left to whoever ships it), Linux AppImage and Windows NSIS config-only.

Two things to know before building:

1. **Rebuild the native module first.** `npmRebuild: false` makes electron-builder reuse the Electron-ABI `better-sqlite3` from `npm run rebuild:native` instead of invoking node-gyp at dist time, so a fresh clone goes `npm install` → `npm run rebuild:native` → `npm run dist`.
2. **One dependency needs an explicit `files` entry.** `@langchain/langgraph-sdk` ships a nested pnpm-style `dist/node_modules` tree (`p-retry`, `p-queue`, `eventemitter3`), and electron-builder's node_modules walker skips any child named `node_modules` no matter what the `files` globs say (`excludedFiles` in `app-builder-lib`'s `NodeModuleCopyHelper.js`). `build.files` therefore carries a FileSet entry that copies that directory through the app-file walker instead. Without it the packaged app dies on launch with `ERR_MODULE_NOT_FOUND` for `…/p-retry/index.js`.

`bin/hermes.js` is unchanged: it stays the from-source launcher (`electron .` against `out/`), not the packaged bundle. It forwards no arguments to Electron (`bin/hermes.js:50` spawns `["."]`), so `--yolo`, `--memfs` and `--user-data-dir` only work on the packaged binary.

`build.publish` is `null` and nothing depends on `electron-updater`, so the build emits no `app-update.yml` / `latest-mac.yml`: an earlier config wrote update metadata for an updater that does not exist (removed in round 4). The `hermes-1.0.0-arm64.dmg.blockmap` the dmg target writes is a differential-download map, not update-channel metadata, and nothing consumes it today. There is no auto-update path at all — updates are a reinstall, and the mac build is unsigned (`mac.identity: null`), so Gatekeeper warns on first open.

The packaged app keeps its workspace under `userData/workspace` and seeds it with `AGENTS.md` on first launch, because `app.asar` is read-only (`src/main/index.ts:17-27`). When testing a packaged build next to a dev app, pass `--user-data-dir=<dir>`: both resolve the same `userData` name, so the second instance loses `requestSingleInstanceLock()` and exits immediately — and on macOS `HOME` alone does not move `userData`, because Chromium ignores it there.

## Contributing

Issues and PRs welcome. Keep the small-modules spirit: no framework on top of the framework, typecheck the whole tree (`npm test`), and every agent-facing feature verified with a live script rather than a mock.

## License

[MIT](LICENSE)