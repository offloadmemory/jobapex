# Unbuilt functionality — inventory and build plans

Date: 2026-09-12
Status: Open backlog. Nothing here is implemented yet; each row is a decision with a plan, not a stub.
Sources: `docs/superpowers/specs/2026-08-29-desktop-app-design.md` ("Out of scope (v1)"), the JobApex
positioning in `README.md`, and a fresh sweep of the tree (below).

## Why the app looks "beta" — and why it is not half-wired

Everything the approved design puts in v1 is implemented and reachable. Evidence from a sweep of the
current tree, not from earlier rounds' notes:

| Check | Result |
|---|---|
| Stub markers (`TODO`, `FIXME`, `not implemented`, `coming soon`, `soon`, empty handlers, `alert(`) across `src/**` | **0** real hits — every match is a form `placeholder=` attribute |
| Typed contract ↔ IPC handlers ↔ preload | `HermesApi` has **39** methods; `src/main/ipc/*.ts` registers **39** `ipcMain.handle` channels; `src/preload/index.ts` invokes the same **39**. No orphan in any of the three directions. Push channels: `chat:event`, `app:event` |
| Navigation | 6 `NavId`s in `src/renderer/src/lib/nav.ts`, each with a mounted view; no `disabled` / "soon" chip (`src/renderer/src/App.tsx:22-29`) |
| Settings keys (`assistantName`, `idleLockMinutes`, `theme`, `defaultProviderId`, `setupComplete`) | every key written is read back, including `resetSetup` clearing `setupComplete` (`src/main/app/settings.ts:35-44,109`) |
| `console.*` in app code | only `src/main/agent/render.ts` (the CLI renderer the console scripts use) |
| Disabled controls | all of them are conditional on real state (`busy`, `dirty`, `deleting`), none hardcoded `true` |

So the "beta" impression comes from the **deferred set** below — the design's explicit v1 exclusions plus
the JobApex domain that the README says is still to come. This document is the backlog for those.

## Open items

Effort: **S** ≤ half a day, **M** ~1–2 days, **L** multi-day. "Verifiable here" = can be exercised
end-to-end on this machine without third-party accounts.

| # | Item | State today | What building it needs | Blockers / inputs | Verifiable here | Effort |
|---|---|---|---|---|---|---|
| 1 | **MCP servers** | Absent. No MCP dependency in `package.json`. Agent tools come only from the built-in tool set | `@langchain/mcp-adapters` (install), a `mcp_servers` table in `app.sqlite` + CRUD IPC + a Settings section (transport: stdio command / http url, args, env, enable), merging discovered tools into the agent's tool list, and routing MCP tool calls through the existing approval gate | Network for the package install; a server to talk to (can ship a tiny stdio MCP fixture in `scripts/`) | Yes (stdlib fixture + `scripts/mcp-test.ts`) | M |
| 2 | **Background workers / scheduled runs** | Absent. Every run is started by the user in the composer; no timer, cron, or job table | A `schedules` table (prompt, thread, interval/cron, enabled, last/next run), a main-process scheduler that survives window close, run records, a Settings section to create/pause/delete, and a notification path when a scheduled run finishes or needs approval | None | Yes (1-minute interval observed live + unit tests on the cron/next-run math) | M |
| 3 | **Dashboards / analytics / evaluation** | Absent. No metrics tables; `app.sqlite` holds `auth`, `providers`, `settings`, `threads` only | Per-run metric rows (thread, model, tokens, tool calls, duration, outcome) written by `runtime.ts`, an aggregate page (runs per day, latency, approval/rejection counts, error rate), and an optional eval runner (fixed prompt set → scored transcripts) | None for analytics; eval needs a model (Ollama is enough) | Yes | M |
| 4 | **Additional providers** | **OpenRouter and vLLM work today** — they are OpenAI-compatible, and the `openai` type accepts any base URL: discovery hits `{baseUrl}/v1/models` (`src/main/agent/discovery/openai.ts:19`) and chat hits `{baseUrl}/v1/chat/completions`. Steps: Settings → Add provider → type *OpenAI* → Base URL `https://openrouter.ai/api` (OpenRouter) or `http://host:8000` (vLLM) → key (any non-empty string for vLLM) → Discover | Nothing for OpenRouter/vLLM. Only **Bedrock** needs real work: `@langchain/aws` + a `bedrock` type, its own auth (AWS credential chain, not a bearer key), discovery via `ListFoundationModels`, and `model-factory` mapping | Bedrock needs the package install and AWS credentials to verify a live call; mapping/discovery are unit-testable without them | Partly (Bedrock live call needs AWS) | S for OpenRouter/vLLM (a label + defaults row), M for Bedrock |
| 5 | **Full at-rest encryption** | Partial by design: `secrets.bin` is PIN-derived AES-256-GCM; `checkpoints.sqlite`, `app.sqlite`, markdown skills/memory are plaintext on disk | Swap `better-sqlite3` for a SQLCipher build (rebuild + ship the native module on all platforms) or encrypt the LangGraph checkpoint payloads at the saver seam, plus key derivation from the PIN and an unlock path for headless scripts | Native module rebuild per platform; migration for existing plaintext DBs; conflicts with `npmRebuild: false` packaging story | Yes on macOS, but it changes the native dependency story | L |
| 6 | **Auto-update infrastructure** | Removed on purpose: `build.publish: null`, no `electron-updater` dependency, no `app-update.yml` / `latest-mac.yml`. Updates are a reinstall | A real publish channel (GitHub Releases or a server), code signing + notarization so the update is trusted, `electron-updater` wiring, a "Check for updates" affordance in About | Apple Developer certificate + notary credentials, and a release repo/channel owned by you. Unsigned updates are a security regression | No (needs your signing + publishing identity) | M once credentials exist |
| 7 | **Connectors (Telegram / WhatsApp)** | Absent. The agent is reachable only from the desktop window | A transport adapter per service, a message→thread mapping, an inbound webhook or long-poll loop, and an outbound sender. Approval gates would need a remote approve/reject path | Bot token / phone number + a decision on where inbound traffic terminates (a long-poll loop can stay laptop-only; webhooks need a public endpoint) | Telegram yes with a token; WhatsApp needs a business account | M each |
| 8 | **Agent studio (visual graph builder)** | Absent; subagents are code-defined in `src/main/agent/subagents.ts` | Subagent/prompt graph model, persistence, an editor UI, and a compiler into the existing `subagents.ts` shape | None technically, but it is a product of its own | Yes | L |
| 9 | **Multi-tenancy / RBAC / orgs** | Absent by design — this is a local single-user app (no users, sessions, or server; `auth` holds one PIN row) | Users/roles table, per-user scoping of threads/providers/settings, a server or at least per-profile data roots | Contradicts the locked design decision ("Local: first-run setup wizard + optional PIN lock"). Cheaper 80% alternative: **profiles** — several local data roots the app can switch between | Yes | L |
| 10 | **SDK widget** | Absent | An embeddable component/iframe plus a transport back to the agent (the `contextBridge` IPC surface only exists inside this app) | Requires deciding the embedding target (web page? Electron window?) and a transport | Only with a stated target | L |
| 11 | **Code signing / notarization** | Unsigned (`mac.identity: null`), so Gatekeeper warns on first open; dmg builds and boots | Apple Developer ID certificate, `notarize` step in the build, hardened runtime | Your Apple account | No | S once credentials exist |
| 12 | **Cross-platform packaging verification** | macOS arm64 built + booted; Linux AppImage / Windows NSIS are config-only | Run each target's build and boot it; `npmRebuild: false` means each platform needs its native `better-sqlite3` built there | A Linux and a Windows machine (or CI runners) | Partly (this machine is macOS arm64 only) | S–M |

## Recommended order

1. **MCP servers** — biggest capability jump for a local agent app, fully testable here, no credentials.
2. **Background workers** — turns the agent into something that works while you are away; no credentials.
3. **Analytics (and later eval)** — cheap once run metrics exist; makes the other two observable.
4. **Bedrock provider**, then **connectors** — each gated on an account/token you control.
5. **Profiles** instead of multi-tenancy; **signing + auto-update** when you have the Apple credentials.

Blocked pending your input: #6 and #11 (Apple signing/notary identity + a publish channel), #7
(Telegram bot token or WhatsApp business account), #4-Bedrock (AWS credentials for a live check).
