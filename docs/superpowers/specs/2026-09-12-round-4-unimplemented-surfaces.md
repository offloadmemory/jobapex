# Unimplemented / Beta Surfaces — Round 4 Audit

Date: 2026-09-12
Status: Audit + implementation record for round 4
Sources: `docs/superpowers/specs/2026-08-29-desktop-app-design.md` (approved design),
`docs/superpowers/specs/2026-08-28-hermes-assistant-design.md`,
`docs/superpowers/specs/2026-09-12-beta-surfaces.md` (rounds 1–3 record), `README.md`.

Round 3 closed the seven design rollout steps. Round 4 asked for the opposite pass: find what is
*still* unimplemented, disabled, stubbed, or only half-wired — including the places where the
codebase's own claims (nav chips, doc comments, README) no longer match the code — then implement
what is in scope. This document is the inventory and the record of what was closed.

Rounds 1–3 shipped and are **not** re-reported here: threads, skills, memory + delete, settings and
providers, auth (setup wizard / PIN / lock / backoff), the rotating file logger, `model-factory`,
the chat error row with **Retry**, composer slash commands, packaging (`dist` / `dist:dir` / icon /
dmg) and the PIN-derived `secrets.bin` envelope. See `2026-09-12-beta-surfaces.md`.

## Method

1. Sweep for explicit stub markers and disabled surfaces across `src/`, `scripts/`, `bin/`:
   `disabled: true`, `soon`, `TODO`, `FIXME`, `not implemented`, `throw new Error("unimplemented")`,
   empty handlers, `console.*` in app code.
2. Diff the contract against the wiring: every method in `HermesApi` (`src/shared/wire.ts`) against
   every `ipcMain.handle(...)` registration (`src/main/ipc/*.ts` — 40 channels) against every
   `ipcRenderer.invoke` in `src/preload/index.ts`. A channel that exists in one layer and not the
   others is a half-wired surface.
3. Diff the contract against the UI: for each `NavId` in `src/renderer/src/lib/nav.ts`, is there a
   view, does it reach every channel it needs, and does every mutating channel have a control?
4. Walk the app live. The dev app was driven over CDP (`--remote-debugging-port=9334`, main-process
   inspector on 9336) on an isolated `HOME=$(mktemp -d)`, and the packaged app over 9335; each
   claimed behavior was exercised against the real UI and, where it writes state, against
   `app.sqlite` / the filesystem.
5. Compare the approved design's explicit out-of-scope list against the tree, so that "not built"
   is a decision with a reason rather than an omission.

## Tier 1 — implemented in round 4

| # | Surface | What shipped | Evidence |
|---|---|---|---|
| 1 | Files / Workspace page | Nav item 5 was a "soon" chip; now a real page: tree, read, edit, save, new file (parents created), reveal in the OS file manager, drag-and-drop staging. Workspace-relative only | `src/main/app/files.ts:31` (`WorkspacePathError`), `:74-104` (NUL / absolute / `..` / symlink-escape refusals), `:152` `listFiles`, `:186` `readFile` (1 MiB cap, binary refusal), `:208` `writeFile`, `:221` `revealPath`, `:273` `stageFile`; `src/main/ipc/files.ts:19-83` (`files:list/read/write/stage/reveal`); `src/renderer/src/files/FilesView.tsx` |
| 2 | Attachments | Dropping files on the composer copies them into `<workspace>/uploads/<yyyyMMdd-HHmmss>-<slug>.<ext>` (collision-suffixed), shows a byte-count chip, and hands the model a workspace-relative path | `src/renderer/src/chat/ChatView.tsx:110,151-164,204,220,307-317`; `src/main/app/files.ts:262-284` |
| 3 | Transcript export | Header **Export** writes the whole transcript through a native save dialog; the path is echoed back in the UI | `src/main/ipc/app.ts:122-145` (`app:exportTranscript`); `src/renderer/src/chat/ChatView.tsx:265` |
| 4 | Theme | System / Light / Dark, applied to `<html>` and persisted in `settings.theme`; follows the OS in `system` mode | `src/renderer/src/theme.ts:29`; `src/renderer/src/settings/SettingsView.tsx:683-713`; `src/main/app/settings.ts` |
| 5 | Thread management | Rename inline, search with a filtered count and an empty state, delete behind a confirmation that says the checkpoints go too | `src/renderer/src/threads/ThreadsView.tsx:108,144,189,250,342,352,383`; `src/main/app/threads.ts:32,47`; `src/main/ipc/threads.ts` |
| 6 | Skills management | New skill dialog (name / description / body, prefilled template), edit, delete; renaming prunes the previous directory so no orphan `SKILL.md` is left behind | `src/renderer/src/skills/SkillsView.tsx:114,389,418,508`; `src/main/agent/skills/file.ts:52,67,75,90` |
| 7 | Memory management | Notes can be edited in place and renamed (slug change moves the file and regenerates `index.md`) | `src/renderer/src/memory/MemoryView.tsx:198,373,444,499`; `src/main/agent/memory/store.ts` |
| 8 | Provider lifecycle | Delete a provider (its stored key goes with it) and clear a stored key while keeping the row; deleting the default promotes the oldest survivor and repairs `defaultProviderId` | `src/main/app/providers.ts:158,172,206`; `src/main/ipc/providers.ts` (`providers:delete`, `providers:clearKey`); `src/renderer/src/settings/SettingsView.tsx:80-95,958` |
| 9 | About & diagnostics | Version, workspace path, log path, **Reveal log**, **Open workspace**, **Run setup again** — the last one behind a `confirm()` that says the wizard takes over the window | `src/renderer/src/settings/SettingsView.tsx:575,889-940`; `src/main/ipc/app.ts:146,155` |
| 10 | Renderer → main log bridge | A packaged renderer has no console, so renderer failures are mirrored into the rotating main log on `app:log` | `src/renderer/src/lib/log.ts`; `src/main/ipc/app.ts:109` |
| 11 | Approval-gate affordances | Gate shows Reject / Edit command / Approve, bulk-allow for the remaining batch, `Esc rejects the remaining actions`, and a **Stop run** button; a pending gate survives a window reload | `src/renderer/src/chat/ApprovalCard.tsx:169-206`; `src/main/ipc/chat.ts:34` `replayPendingApproval`, called on `did-finish-load` at `src/main/index.ts:47` |
| 12 | Chat rendering | Markdown/GFM in assistant and user turns; tool calls render as collapsible cards with pretty-printed JSON | `src/renderer/src/components/assistant-ui/thread.tsx` |
| 13 | Failure row | `Last run failed.` + **Retry** + **Provider settings** above the composer, shown only while idle with an error as the newest entry | `src/renderer/src/chat/ChatView.tsx:254,283,298` |
| 14 | Test suite + CI | 11 vitest files / 137 tests (round-3 baseline: 7 / 46) — adds `files.test.ts`, `config.test.ts`, `log.test.ts`, `discovery/ollama.test.ts`, a rewritten 40-case `schemas.test.ts`; GitHub Actions runs typecheck + unit on `macos-latest` | `.github/workflows/ci.yml`; `src/main/app/files.test.ts`; `src/renderer/src/lib/log.test.ts` |
| 15 | Packaging honesty | `build.publish: null` plus the restored `repository` field stops electron-builder emitting update metadata for an updater that is not installed; packaged workspace root is `userData/workspace` and is seeded with `AGENTS.md` | `package.json:56-57,58-67,104-107`; `src/main/index.ts:17-27`; `src/main/agent/config.ts:23,96` (`configureWorkspaceRoot`, `ensureWorkspaceSeed`) |

Nav is now six real pages with no disabled entries: `src/renderer/src/App.tsx:22-29`. The round-3
document's "Nav item disabled, 'soon' chip" rows are stale — see the correction note added there.

## Tier 2 — defects found and closed this round

Everything in this round is uncommitted working-tree state, so "shipped" below means "present in
the tree". Each defect was reproduced before the fix and re-checked after it.

| # | Defect | Symptom | Fix | Evidence |
|---|---|---|---|---|
| 1 | `App: Run setup again` duplicated the provider row and reset the assistant name | Second run of the wizard started from built-in defaults: `providerId` was only ever set by *this* wizard session's step 1, so Finish inserted a new row instead of updating the saved one; `assistantName` was hardcoded to `"hermes"`, so a customised name was overwritten. Contradicted the UI's own promise — "Running setup again keeps your providers, notes, skills, PIN and theme" | `SetupWizard` now seeds provider id / type / label / base URL / model and the assistant name from `app:getSettings` + `providers:list` on mount (skipping the seed if the user already typed, guarded by a `pristine` ref flipped by the form's bubbling `onChange`); a key already in `secrets.bin` satisfies the key requirement for its own type only | Before: `select count(*) from providers` → `2` (`local,local`). After: wizard opened with `Label=local`, `Model=glm-5.2:cloud`, identity step `Aria`; Finish → `providers` count `1`, `settings.assistantName=Aria`, `theme=dark`, `setupComplete=1`, header shows `Aria`. `providers.save` keeps a stored key when the input carries none (`src/main/app/providers.ts:134`) |
| 2 | Update metadata emitted for a nonexistent updater | `app-update.yml` inside the packaged bundle and `latest-mac.yml` in `dist/`, with no `electron-updater` dependency anywhere: an artifact implying an update channel that does not exist | `build.publish: null` (`package.json:57`) | `npm run dist:dir` → `find dist -name app-update.yml` → empty; `dist/latest-mac.yml` was round-3 residue (12:01, older than the 13:17 `app.asar`) and was deleted |
| 3 | Dead UI module and dependencies | `src/renderer/src/components/ui/separator.tsx` with **0** references, dragging `zustand` and `@radix-ui/react-separator` into the dependency tree | Deleted the module and both dependencies; `package-lock.json` synced | `separator` no longer appears as a component anywhere under `src/renderer/`; neither `zustand` nor `@radix-ui/react-separator` is in `package.json`; `npm test` + `npm run test:unit` clean |
| 4 | Live scripts could touch the real profile | Scripts wrote to the developer's real `~/.deepagents/hermes/` if `HOME` was not overridden | `requireIsolatedHome()` (`scripts/lib/isolated-home.ts`) refuses to start without `HERMES_TEST_HOME=1`; all 17 scripts call it and all 17 `package.json` script entries pass `HOME=$(mktemp -d)` | All five `*:test` scripts still exit 0 with their `*_DONE` sentinel |
| 5 | False comment in the Ollama discovery module | A comment described behavior the code did not have | Reworded to the actual contract | `src/main/agent/discovery/ollama.ts:9` |
| 6 | Integration-level type/fixture drift (caught while wiring the round-4 contract) | `app:resetSetup` returned `undefined` instead of a `void` result; chat-store fixtures missed the new `depth` / `allowedDecisions` fields; `thread.tsx` had an unannotated props parameter | `okResult<T>()` helper (`src/main/ipc/errors.ts:5`); fixtures updated; props type at `src/renderer/src/components/assistant-ui/thread.tsx:67` | `npm test` exit 0; `npm run test:unit` 11 files / 137 tests |

## Tier 3 — deliberately not built (out of scope for v1)

| Item | Why it stays out | What exists instead |
|---|---|---|
| Agent studio (visual agent builder) | Design §"Out of scope (v1)" | Subagents are declared in `src/main/agent/subagents.ts` |
| Multi-tenancy / RBAC | Design out-of-scope | Single local profile |
| Dashboards, analytics, eval harness | Design out-of-scope | Live verification scripts; unit tests |
| MCP servers | Design out-of-scope | Built-in tools (`search`, skills, memory, shell, files) |
| SDK / embeddable widget | Design out-of-scope | Electron renderer is the only consumer of the wire seam |
| Third-party connectors | Design out-of-scope | — |
| Background workers / schedulers | Design out-of-scope | Runs are user-initiated only |
| Full at-rest encryption | Design out-of-scope, and it is a separate product decision | `secrets.bin` only: PIN-derived scrypt → AES-256-GCM (v2), `safeStorage` when no PIN is set; the PIN itself is hashed in `app.sqlite`; checkpoints, notes and skills are plaintext on disk |
| Auto-update infrastructure | No `electron-updater` dependency, no release feed, no signing identity to trust an update | `build.publish: null`, verified to emit no `app-update.yml` / `latest-mac.yml`; updates are a reinstall |
| Code signing + notarization | No Developer ID certificate in this environment; round 3 explicitly deferred it to whoever ships | `build.mac.identity: null`; `electron-builder` logs `skipped macOS code signing`; Gatekeeper will warn on first open |
| Cross-platform packaging verification | `better-sqlite3` + `npmRebuild: false` means each platform needs its own rebuilt native module; only macOS arm64 has been built and booted | Linux AppImage and Windows NSIS targets are config-only (`package.json:68-79`) |
| OpenWiki generation inside the app | Generation is an external CLI run (`npx openwiki code`), needs the network and a strong model, and belongs to repo tooling rather than the desktop runtime | `scripts/wiki.sh` + `npm run wiki:update` / `wiki:init` (model `glm-5.2:cloud`); the packaged app browses the generated files through the Files page. No `workspace/openwiki/` directory exists until the script is run |
| `bin/hermes.js` forwarding extra argv | The launcher is the from-source convenience entry point; the packaged binary takes the switches | `bin/hermes.js:50` spawns `["."]`, so `--yolo`, `--memfs`, `--user-data-dir` cannot be passed through it; the packaged app accepts them directly |
| Job-search domain features (application tracker, auto-apply, outreach) | README states they are being built on top of this foundation | The `package.json` `description` describes JobApex while the package name is `jobapex` and the desktop app ships as **hermes** — the product-identity mismatch is unresolved in v1 |
| Providers beyond Ollama / OpenAI / Anthropic | The design fixes the provider set | `TYPE_DEFAULTS` in `src/renderer/src/setup/SetupWizard.tsx:18-22` and the corresponding main-process discovery modules |
| Renderer lock gate re-evaluation under a dev-mode main restart | Known limitation carried since round 2; main is the authority | The window is recreated with the process in production; `chat:run` still answers `LOCKED` |
| Guarding `hermes.app.log` against a wholly absent bridge | The preload exposes the bridge synchronously before the renderer runs, so the state is unreachable; the file's "never throws" guarantee covers a rejected IPC call | Accepted risk, documented here: `src/renderer/src/lib/log.ts` |

## Audit items checked and closed as non-issues

- **Theme `<select>` accessible name.** Suspected missing `aria-label`; the control is wrapped in a
  `<label>` with `Theme` (`src/renderer/src/settings/SettingsView.tsx:690-704`). CDP
  `Accessibility.getPartialAXTree` reports `name="Theme"`, `role="combobox"` — no change needed, and
  an extra `aria-label` would only duplicate the name.
- **`⌘6` for Settings.** The sidebar tooltip (`src/renderer/src/App.tsx:319`) advertises `⌘6` while
  the application menu binds Settings to `⌘,` (`src/main/menu.ts:101`). Both are real: the renderer
  keydown handler maps `⌘1…⌘6` to nav order, the menu covers `⌘1…⌘5` plus `⌘,`, and both paths end
  in the same idempotent `setActive`. Verified live: `⌘2`/`⌘6` switch pages without double-rendering.
- **`matchThreadPrefix` test.** Superseded by the removal of the Ink TUI (`resume.ts`); adding it
  back would test dead code.
- **`settings:test` reports `safeStorage unavailable`.** Expected in the harness: the live scripts
  run under `ELECTRON_RUN_AS_NODE`, where `require("electron")` resolves to the binary path. The
  script prints the degraded path instead of failing.

## Verification ledger (round 4)

| Check | Result |
|---|---|
| `npm test` (typecheck both TS projects) | exit 0 |
| `npm run test:unit` | 11 files / 137 tests passed |
| `npm run build` | clean; `out/` regenerated |
| `npm run dist:dir` | clean; `dist/mac-arm64/hermes.app` built, unsigned (`identity: null`) |
| Packaged app boot | `--user-data-dir=/tmp/... --remote-debugging-port=9335` on `HOME=/tmp/...`: first-run wizard, live Ollama discovery (5 models), shell, `workspace/AGENTS.md` seeded under userData, Files tree over that root, About shows the same path; the real `~/.deepagents/hermes` mtime unchanged |
| Live scripts | `threads:test`, `skills:ui-test`, `memory:ui-test`, `settings:test`, `auth:test` — all exit 0 with one `*_DONE` sentinel each |
| CDP pass (dev app) | Setup wizard (validation, live model test, PIN gating); shell nav; markdown + collapsible tool cards; approval gate (Reject / Edit / Approve, `Esc` → "The user declined this command.", Stop → `task cancelled`); retry against a dead base URL without duplicating the user turn; attachment drop → `uploads/…` + chip + prompt path; transcript export (78 lines, user/assistant/tool markers); thread rename/search/delete; skills create/rename/delete with directory pruning; memory create/edit/rename with `index.md` regeneration; files tree/read/save/new/escape refusal; settings theme → `html.dark` + `settings.theme`; provider edit/delete; **Run setup again** |
| Re-run of the wizard after the Tier-2 fix | seeded label/model/name; `providers` row count unchanged at 1; `assistantName` preserved |

## Residual risk and open items

- **Packaged `userData` ignores `HOME` on macOS.** Chromium resolves the app-data path from the real
  user, so a packaged boot under a throwaway `HOME` still uses `~/Library/Application Support/jobapex`
  (observed: that directory's `workspace/AGENTS.md` was seeded by the packaged run). Isolating a
  packaged test requires `--user-data-dir`. The app's own *state* directory does honour `HOME`
  (verified: `$HOME/.deepagents/hermes/app.sqlite` created in the throwaway home).
- **Dev and packaged instances share `userData`.** Both resolve the name `jobapex`, so a packaged
  launch while the dev app runs loses `requestSingleInstanceLock()` and exits 0
  (`src/main/index.ts:63`) after seeding its workspace. Not a defect, but the reason the first
  packaged boot attempt "failed" during this round's verification.
- **No packaged-artifact test in CI.** CI runs typecheck + unit tests only; booting a GUI app on a
  runner is out of scope for this round.
- **The entire round-4 change set is uncommitted** in the working tree (no git operations were run
  this session).
