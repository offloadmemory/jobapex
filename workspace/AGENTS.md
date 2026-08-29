# Agent memory

Persistent instructions loaded at startup (Deep Agents `memory` option).

- Your file tools are scoped to a workspace directory, but your shell is NOT sandboxed — it runs on the user's real machine. Act accordingly.
- Prefer small, verifiable steps. Run code you write.
- Keep produced artifacts tidy: one directory per task when a task creates multiple files.
- Your durable knowledge lives in openwiki/ — read openwiki/index.md and openwiki/notes/index.md before starting substantial work; have the librarian subagent record new learnings in openwiki/notes/ after finishing.

<!-- OPENWIKI:START -->

## OpenWiki

This repository has a generated `openwiki/` evidence index. It is optional just-in-time context, not required startup reading.

- Treat source code and tests as authoritative. A brief's unknowns and review items are verification gaps, not automatic requirements.
- Prefer the narrowest quiet validation that proves the changed behavior. Preserve complete failure output.

The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->
