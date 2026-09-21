# Beta / Unimplemented Surfaces — Inventory

Date: 2026-09-12
Status: Inventory + implementation record (rounds 1–3; stale rows corrected in round 4)
Sources: `docs/superpowers/specs/2026-08-29-desktop-app-design.md` (approved design),
`docs/superpowers/plans/2026-08-29-desktop-app-scaffold-chat.md` (phases 1–2 only),
`README.md:11-12`.

The desktop design's rollout order has seven steps. Steps 1–2 (scaffold, chat spine) shipped;
steps 3–7 were unimplemented **when this document was written in round 3**. Rounds 3 and 4 closed
them: everything below is kept as the historical record, and each now-false statement carries a
closure note. The round-4 audit (`2026-09-12-round-4-unimplemented-surfaces.md`) is the current inventory.

## Summary

| # | Surface | User-visible state | Evidence | Spec step |
|---|---|---|---|---|
| 1 | Threads | **Closed in round 3** — nav item enabled, page shipped; "disabled, soon chip" was the round-2 state | round-2 witness `src/renderer/src/App.tsx:15`; current nav `src/renderer/src/App.tsx:22-29` | 3 |
| 2 | Skills | **Closed in round 3** — nav item enabled, browser + editor shipped | round-2 witness `src/renderer/src/App.tsx:16`; current nav `src/renderer/src/App.tsx:22-29` | 5 |
| 3 | Memory | **Closed in round 3** — nav item enabled, browser shipped | round-2 witness `src/renderer/src/App.tsx:17`; current nav `src/renderer/src/App.tsx:22-29` | 5 |
| 4 | Settings / providers | **Closed in round 3** — nav item enabled, page shipped | round-2 witness `src/renderer/src/App.tsx:18`; current nav `src/renderer/src/App.tsx:22-29` | 4 |
| 5 | Auth (setup wizard + PIN lock) | **Closed in round 3** — wizard, lock screen, PIN store and lock menu shipped | `src/renderer/src/setup/`, `src/main/ipc/app.ts` (`app:isLocked`/`lock`/`unlock`/`setup`) | 6 |
| 6 | Packaging / distribution | **Closed in round 3** — see "Round 3 — remaining gaps closed" | `package.json` `build` block; `dist`/`dist:dir` | 7 |

Supporting subsystems absent in the whole tree **at the time of writing** (grep over `src/`,
`scripts/`, `package.json` returned zero hits): `app.sqlite`, any `CREATE TABLE`, `model-factory`,
`safeStorage`, `secrets.bin`, PIN hashing, `ProviderInfo` / `SkillInfo` / `NoteInfo` types.
**All of them now exist** — `src/main/app/db.ts`, `src/main/app/secrets.ts`,
`src/main/agent/model-factory.ts`, `src/shared/wire.ts` — so the "zero hits" sentence is history,
not current state.

## 1. Threads — `threads` table + list / resume / history

**Intended (spec, "Storage split"):** chat threads are LangGraph state in `checkpoints.sqlite`;
a `threads` table `(id, title, updatedAt)` lives in a new `app.sqlite`; titles are derived from
the first user message for the list UI.

**Closed in round 3.** Durable checkpointing worked (README:74) but nothing enumerated threads;
the `threads` table, `threads:list` / `threads:history` and the Threads page now ship, and round 4
added rename / search / delete on top. The evidence table below is the round-2 witness, kept as
history.

| Evidence | Proves |
|---|---|
| `src/renderer/src/App.tsx:15` | Nav item `threads` is `disabled: true` |
| `src/main/ipc/index.ts:4-7` | Only `registerChatIpc()` + `registerAppIpc()` are registered |
| `src/shared/wire.ts:64-72` | `HermesApi` exposes only `chat.*`, `app.getInfo`, `onEvent` |
| `src/main/agent/persistence.ts:5-7` | Only a checkpointer factory; no thread metadata store |
| no `CREATE TABLE` anywhere | No `app.sqlite`, no `threads` table |

**Required IPC:** `threads:list` → `ThreadSummary[]`; `threads:history` → `ThreadHistoryMessage[]`.

**Acceptance:** after a chat run, `threads:list` contains that thread with a non-empty title
derived from the prompt and an advanced `updatedAt`; `threads:history` returns the run's
user + assistant messages in order; clicking a thread in the UI loads it into the transcript
and continues the same checkpointed conversation.

## 2. Skills browser

**Intended (spec, "Skills manager"):** sidebar page listing skills from the registry dirs
(name + frontmatter description, user vs project badge); view renders `SKILL.md`; edit via a
plain Markdown textarea; "New skill" writes a scaffold.

**Closed in round 3.** The agent could read/write skills but nothing listed them and nothing
reached the UI; `skills:list` / `skills:read` / `skills:write` and the Skills page now ship, and
round 4 added create / rename / delete through the UI. The evidence table below is the round-2
witness, kept as history.

| Evidence | Proves |
|---|---|
| `src/renderer/src/App.tsx:16` | Nav item `skills` is `disabled: true` |
| `src/main/agent/skills/registry.ts:12-19` | Builds middleware only — returns no listable data |
| `src/main/agent/skills/tools.ts` | `write_skill` / `load_skill` are agent tools, not IPC |

**Required IPC:** `skills:list` → `SkillInfo[]`; `skills:read` → `string`; `skills:write`.

**Acceptance:** a skill written by the agent (`write_skill`, approved) appears in `skills:list`
with its frontmatter description and `source: "user"`; `skills:read` returns the file body;
`skills:write` creates/updates `SKILL.md` under the user skills dir and the new skill is
immediately loadable by the agent.

## 3. Memory browser

**Intended (spec, "Memory manager"):** page over the existing `memory/store.ts` — notes list
with search, Markdown view/edit, index regenerated on save.

**Closed in round 3.** The store was complete and used by the agent tools with no IPC exposing it;
`memory:list` / `search` / `read` / `write` (and, from round 3, `delete`) now ship, and round 4
added in-place rename with `index.md` regeneration. The evidence table below is the round-2
witness, kept as history.

| Evidence | Proves |
|---|---|
| `src/renderer/src/App.tsx:17` | Nav item `memory` is `disabled: true` |
| `src/main/agent/memory/store.ts:19,38,46` | `listNotes` / `writeNote` / `searchNotes` exist, unreferenced outside `memory/tools.ts` |
| `src/main/agent/memory/tools.ts` | `read_memory` / `write_memory` are agent tools, not IPC |

**Required IPC:** `memory:list` → `NoteInfo[]`; `memory:search`; `memory:read` → `string | null`;
`memory:write` (regenerates `index.md`).

**Acceptance:** notes produced by consolidation appear in `memory:list`; `memory:search`
matches on title and body; `memory:read` returns the exact file; `memory:write` updates the
note and `index.md`.

## 4. Settings / providers

**Intended (spec, "LLM provider config" + rollout step 4):** `app.sqlite` `providers` table
(`id, name, type, baseUrl?, chatModel?, isDefault, createdAt, updatedAt`); API keys encrypted
with `safeStorage` into `secrets.bin`; discovery per provider (Ollama `/api/tags`, OpenAI and
Anthropic model-list endpoints); validate = 1-token ping; `model-factory.ts` maps a provider row
to `ChatOllama` / `ChatOpenAI` / `ChatAnthropic`; changing the default rebuilds the agent.

**Closed in round 3.** Config was a static env/file read and the model was hardcoded; the
`providers` table, `model-factory.ts`, discovery, validation and the Settings page now ship, and
round 4 added provider delete / clear-key. There is no one-line provider swap in `agent.ts` any
more — the active provider row decides the model. The evidence table below is the round-2 witness,
kept as history.

| Evidence | Proves |
|---|---|
| `src/renderer/src/App.tsx:18` | Nav item `settings` is `disabled: true` |
| `src/main/agent/agent.ts:58-62` | Model is hardcoded `new ChatOllama({...})` — no factory |
| `src/main/agent/config.ts:44-53` | `loadConfig` reads env → `config.json` → defaults only |
| no `model-factory`, `discovery/`, `safeStorage` hits | None of the provider machinery exists |

**Required IPC:** `providers:list` / `providers:save` / `providers:discover` /
`providers:validate` / `providers:setDefault`.

**Acceptance:** a saved Ollama provider row appears in `providers:list` with
`credentialsConfigured: false`; `providers:discover` returns live model ids from the daemon;
an unreachable base URL fails validation with a field-level error and is never silently saved;
set-default rebuilds the agent so the next run uses the new model; an API key is never returned
to the renderer (name-only reporting).

## 5. Auth — setup wizard + PIN lock

**Intended (spec, "Auth: setup wizard + lock"):** first run (no providers + no lock) shows a
3-step wizard — identity, provider, optional PIN; if a PIN is set, `app.isLocked()` gates the
window at launch; PIN hashed in `app.sqlite`; wrong-attempt backoff; the PIN derives the key for
`secrets.bin`. Explicitly not in scope (spec): encrypting checkpoints/markdown at rest.

**Closed in round 3.** It was entirely absent — no `src/renderer/src/setup/`, no lock state, no PIN
store, no `app:getSettings` / `saveSettings` / `isLocked` / `unlock` / `setup` handlers.
All of them now ship (`src/main/ipc/app.ts:21-108`), together with `app:lock`, the `Lock Now` menu
item, the PIN-derived `secrets.bin` envelope and idle auto-lock. The evidence below is the round-2
witness, kept as history.

**Required IPC:** `app:getSettings`, `app:saveSettings`, `app:isLocked`, `app:unlock`, `app:setup`.

**Acceptance:** a fresh profile (no providers, no PIN) opens the wizard; completing it writes
settings + a provider row and drops into chat; `app:isLocked()` is true at launch once a PIN
exists; a wrong PIN is rejected with backoff; the correct PIN unlocks; secrets written while
locked are encrypted.

## 6. Packaging / distribution

**Intended (spec rollout step 7):** app icon, `electron-builder` config (signed/notarized macOS
dmg; Linux/Windows config-only), `bin/hermes.js` → `electron .`.

**Current state:** closed in round 3 (see "Round 3 — remaining gaps closed"). It was blocked on
`electron-builder` as a new devDependency; sign-off came, and the build config, icon and
`dist`/`dist:dir` scripts now ship. The rest of the surface list was unimplemented only for
engineering reasons and is implemented.

## Implementation record

Surfaces 1–5 are implemented end-to-end and verified twice: a live script per surface against
the real domain modules, and a CDP-driven pass over the running Electron app on an isolated
`HOME` (`HOME=$(mktemp -d) HERMES_TEST_HOME=1`). Surface 6 (packaging) was added in round 3 and
is verified by building and booting the packaged app. Round 4 re-ran that whole verification
ladder and added the Files surface; the counts in this section were updated then.

Shipped IPC as of round 4 — 40 channel names in `src/main/ipc/*.ts`, typed in `src/shared/wire.ts`
and bridged by `src/preload/index.ts`. All the `invoke` channels validate their payload with Zod;
`chat:event` and `app:event` are the two main→renderer push channels (`app:event` carries
`{type:"locked"}` and menu commands). Rows marked **r4** were added after this document was first
written:

| Group | Channels |
|---|---|
| `chat` | `run`, `cancel`, `resolveApproval`, `event` |
| `app` | `getInfo`, `getSettings`, `saveSettings`, `isLocked`, `lock`, `unlock`, `setup`, **r4** `log`, `exportTranscript`, `revealLog`, `resetSetup` |
| `threads` | `list`, `history`, **r4** `rename`, `delete` |
| `skills` | `list`, `read`, `write`, **r4** `delete` |
| `memory` | `list`, `search`, `read`, `write`, `delete` |
| `providers` | `list`, `save`, `discover`, `validate`, `setDefault`, **r4** `delete`, `clearKey` |
| `files` | **r4** `list`, `read`, `write`, `stage`, `reveal` |

New modules: `src/main/app/{paths,db,secrets,threads,providers,auth,settings}.ts`,
`src/main/agent/{identity,model-factory}.ts`, `src/main/agent/discovery/*`,
`src/main/agent/skills/file.ts`, `src/renderer/src/{setup,threads,skills,memory,settings}/`.
Round 4 added `src/main/app/files.ts`, `src/main/ipc/files.ts`,
`src/renderer/src/files/FilesView.tsx`, `src/renderer/src/theme.ts`,
`src/renderer/src/lib/log.ts` and `.github/workflows/ci.yml`.
`src/main/app/*` never static-imports `electron`: `safeStorage` is loaded lazily through
`createRequire` so the modules stay importable under `ELECTRON_RUN_AS_NODE` (the live-script
harness) and under vitest.

New dependencies declared in `package.json`: `better-sqlite3` (app state; needs
`npm run rebuild:native`), `@langchain/openai` and `@langchain/anthropic` (the non-Ollama
providers the spec requires). Verification scripts, one per implemented surface: `threads:test`,
`skills:ui-test`, `memory:ui-test`, `settings:test`, `auth:test` (all registered in
`package.json` and run under `scripts/run-in-electron-node.sh` with an isolated `HOME`).

Live-app evidence (fresh profile, real Ollama daemon): the wizard discovered 5 models, validated
`glm-5.2:cloud`, wrote the provider + PIN and dropped into the shell; chat streamed a reply; the
Threads row showed title/age/message count and reopened the checkpointed transcript; Skills
created and previewed `release-notes`, and the agent then listed that skill by name (proving the
UI write reaches the skill middleware); Memory created, searched (hit + no-match) and previewed a
note; Settings rendered the assistant, the provider rows (default badge, `Set default` switching
the header model, and a second provider that did not steal the default), and the PIN card; both
lock paths held — explicit `Lock now` (wrong PIN rejected, correct PIN resumed) and the 1-minute
idle auto-lock.

Known limitation: the renderer evaluates the lock gate at mount, so a main-process restart under
`electron-vite dev` leaves the already-mounted window interactive; the main process is still the
authority (`chat:run` returns `LOCKED`), and in production the window is recreated with the
process, so the gate re-runs.

## Round 2 — approved-design details closed

Surfaces 1–5 shipped; the approved design (`2026-08-29-desktop-app-design.md`) still described
behaviour that had no implementation. Round 2 closes those details rather than adding features:

| Spec item | Implementation | Evidence |
|---|---|---|
| §Error handling — "agent errors log to `~/.deepagents/hermes/logs/` (rotating file logger)" | `src/main/app/logger.ts` (`logInfo`/`logError`, one JSON line per entry), `paths.ts:logsDir()`, log dir created by the app | `src/main/app/logger.test.ts` (line shape + rotation at 512 KiB keeping `.1`–`.3`); live run wrote `{"scope":"agent.run","message":"fetch failed"}` for a dead provider |
| §Error handling — "`ECONNREFUSED` → friendly hint with a retry button and a link to provider settings" | failure row above the composer in `chat/ChatView.tsx` (`Last run failed.` + `Retry` + `Provider settings`), shown only while idle with the newest transcript entry an error; `Retry` re-sends the last user prompt through `sendPrompt`, `Provider settings` switches the shell to Settings | CDP pass: prompt against a dead base URL rendered the row, `Provider settings` landed on the Settings page, `Retry` after restoring the URL streamed a reply and cleared the row |
| §Auth — lock "via a 'Lock' menu item" | `src/main/menu.ts` (`Lock Now`, `Cmd+L`/`Ctrl+L`, enabled only when a PIN is configured), `refreshAppMenu()` called at startup and after every settings/setup write; main pushes `{type:"locked"}` on the new `app:event` channel and `App.tsx` mirrors it into the gate | main-process inspector: menu read back as `jobapex > Lock Now` (`enabled: true`, `Cmd+L`), invoking the item's click turned the window into the lock screen and `app:isLocked` returned `true`; log line `scope:"app", "locked from the application menu"` |
| §Testing — "model-factory mapping" unit test | `src/main/agent/model-factory.test.ts` (config fallback, provider-row precedence, ollama/openai/anthropic mapping, keyless refusal) | `npm run test:unit` → 6 files / 40 tests in round 2; **11 files / 137 tests as of round 4** |
| Logging reach | `logError` at `ipc/*` (`failResult`), `chat.run`, `agent.run`, `memory.consolidate`; `uncaughtException`/`unhandledRejection` handlers in `main/index.ts` | typecheck + live run above |

Deliberately not implemented, with the reason:

- **PIN-derived key for `secrets.bin`.** Recorded in round 2 as a deviation (the design's locked
  decision table says `safeStorage`); **closed in round 3** — see the v2 envelope below. A v2 store
  is read only after `installSecretsKey(pin)` on unlock, and `hasSecret` answers from the envelope's
  `ids` so the lock screen and provider cards work while locked.
- **Renderer lock gate re-evaluation.** The gate is evaluated at mount; main remains the authority,
  so a dev-mode main restart leaves an interactive window while `chat:run` still answers `LOCKED`.
  Production recreates the window with the process, so the gate re-runs.
- **Packaging (spec step 7).** Was awaiting sign-off on the `electron-builder` devDependency;
  **closed in round 3**.

## Round 3 — remaining gaps closed

Round 2 left four items open: the design's composer slash commands, memory-note pruning, packaging
(spec step 7) and the PIN-derived key for `secrets.bin`. All four are implemented and verified.

| Gap | Implementation | Evidence |
|---|---|---|
| Composer slash commands (design: the Ink-era `/` affordances, now page navigation) | `src/renderer/src/chat/commands.ts` (`SLASH_COMMANDS`, `COMMAND_HELP`, `parseSlashCommand`), intercepted at submit in `chat/ChatRuntimeProvider` and dispatched by `App.tsx:runCommand`; the composer prints the static hint line | `commands.test.ts` (nav map, `/reset`, `/help`, `/files`, unknown, prose passthrough); CDP pass: `/memory` → Memory page active with the draft swallowed and no `user` transcript row, `/help` → system row listing every command, `/reset` → fresh thread with the empty-state hero, `/files` → "no page here" row, `/bogus` → unknown-command row, `/threads` → Threads page |
| Memory-note pruning | `deleteNote` + `writeIndex` in `src/main/agent/memory/store.ts`, `memory.delete` in the wire/preload/handler chain, `MemoryView.tsx` **Delete** button + confirmation `Dialog` | CDP pass: created `cdp-round3-check` through the "New note" dialog (file + `index.md` line written), then deleted it through the confirm dialog — the file and its index line are gone and the list is back to "No notes yet". `memory:ui-test` covers list/search/read/edit |
| Packaging (spec step 7) | `electron-builder ^26.15.3`, the `build` block in `package.json`, `build/icon.svg` → `build/icon.png` → `icon.icns`, `dist` / `dist:dir` scripts | `npm run dist:dir` → `dist/mac-arm64/hermes.app` boots on an isolated `HOME` and renders the first-run wizard; `npm run dist` → `dist/hermes-1.0.0-arm64.dmg` (161.6 MB) + blockmap; `Resources/icon.icns` (215,629 B) and `Info.plist` (`CFBundleIdentifier com.jobapex.hermes`, `CFBundleIconFile icon.icns`) |
| PIN-derived key for `secrets.bin` | `src/main/app/secrets.ts` v2 envelope — scrypt(PIN, salt) → AES-256-GCM over the whole map, `{v:2, kdf:"scrypt", salt, iv, tag, data, ids}`; `installSecretsKey` / `clearSecretsKey` / `releaseSecretsKey` wired into `settings.ts`, `ipc/app.ts`, `menu.ts`, `runtime.ts` | `auth:test` (setup, PIN gate, wrong-PIN backoff, unlock, PIN removal), `settings:test` (PIN set/keep/remove), `npm run test:unit` |

`bin/hermes.js` is unchanged: it stays the from-source launcher (`electron .` against `out/`). The
distributed artifact is the app bundle/dmg itself.

Packaging detail that is not visible in the config: `@langchain/langgraph-sdk` ships a nested
pnpm-style `dist/node_modules` tree, and electron-builder's node_modules walker excludes every child
named `node_modules` before any glob is considered (`excludedFiles` in `app-builder-lib`'s
`NodeModuleCopyHelper.js`), so no `files` glob can place it. A `files` **FileSet** entry

```json
{ "from": "node_modules/@langchain/langgraph-sdk/dist/node_modules",
  "to": "node_modules/@langchain/langgraph-sdk/dist/node_modules" }
```

goes through the app-file walker instead and does ship it —
`npx --no-install asar list dist/mac-arm64/hermes.app/Contents/Resources/app.asar | grep -c
"langgraph-sdk/dist/node_modules"` → 50, with `p-retry`, `p-queue` and `eventemitter3` all present.
`npmRebuild` is `false`, so `dist` reuses the Electron-ABI `better-sqlite3` produced by
`npm run rebuild:native` instead of invoking node-gyp.

### Keyring fix found while verifying round 3

Both the dev app and the packaged app wedged on the first launch that had a provider row: the main
thread sat in `SecItemAdd` → `Security::KeychainCore::StorageManager::makeLoginAuthUI` →
`AuthorizationCopyRights` → a synchronous XPC wait (`sample` showed 2316/2316 samples in that
stack), i.e. the macOS login-keychain authorization prompt was raised and never answered. Cause:
`readMap()` → `decryptV1()` called `safeStorage.isEncryptionAvailable()`, and that is what
initializes Electron's keychain entry — so an empty `secrets.bin` (a profile with no stored API
key) touched the OS keyring for nothing. `decryptV1` now returns an empty map before loading
`safeStorage`, so a launch with nothing stored never reaches the keychain. Verified by the same
profile — wedged twice before, boots and chats after.

## Round 4 — closure and corrections to this document

Round 4 audited the tree for surfaces that were still unimplemented, unreachable, or described
inaccurately, then closed them. Full inventory, per-item evidence and the verification ledger:
`docs/superpowers/specs/2026-09-12-round-4-unimplemented-surfaces.md`.

Shipped in round 4: the **Files / Workspace** page (`files:*` — round 3's CDP pass recorded `/files`
as a "no page here" row, so the surface is new here), composer **attachments** staged into
`<workspace>/uploads/`, **transcript export**, **theme** (system/light/dark), **thread search /
rename / delete**, **skill create/rename/delete** from the UI with directory pruning, **memory
rename** with `index.md` regeneration, **provider delete / clear-key**, the **About & diagnostics**
card (reveal log, open workspace, run setup again), the renderer→main **log bridge**, and a
**CI workflow** with the unit suite grown to 11 files / 137 tests.

Two defects were found and fixed in round 4:

1. **Run setup again duplicated the provider row and reset the assistant name.** The wizard only
   ever knew the provider it had just created in that session, so finishing a second run inserted a
   new row instead of editing the saved one, and `assistantName` went back to `hermes` —
   contradicting the UI's own "keeps your providers, notes, skills, PIN and theme" copy.
   `SetupWizard.tsx` now seeds its state from the saved settings and provider list on mount
   (`pristine` ref so a seed can never clobber typing; `hasKey` satisfied by a key already in
   `secrets.bin` for that type).
2. **Update metadata for a nonexistent updater.** `app-update.yml` was being written into the app
   bundle and `latest-mac.yml` into `dist/`, while nothing in the project depends on
   `electron-updater`. `build.publish: null` stops it; verified that `npm run dist:dir` emits
   neither file.

Corrections applied to this document: the Summary rows above carried the round-2 "disabled, 'soon'
chip" state against `App.tsx:15-18`, which no longer exists (the nav is six enabled pages); the
"Supporting subsystems absent … zero hits" paragraph is false today; the shipped-IPC table was
missing every round-3/round-4 channel beyond `threads:list|history` (it now lists all 40); and the
stale `6 files / 40 tests` counts were updated. History was kept, not deleted.
