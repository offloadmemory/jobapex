#!/usr/bin/env bash
#
# Run a TypeScript seam script under Electron's Node instead of the system's.
#
# Why: better-sqlite3 is rebuilt for Electron's ABI (`npm run rebuild:native`),
# so plain `node_modules/.bin/tsx` dies with ERR_DLOPEN_FAILED when it loads
# the sqlite native module. Electron's own Node is built for that ABI, so we
# exec tsx under `ELECTRON_RUN_AS_NODE=1 electron` — the same shape that
# scripts/ipc-test.ts uses.
#
# Usage: scripts/run-in-electron-node.sh scripts/smoke.ts [args...]
set -euo pipefail
cd "$(dirname "$0")/.."

# `require('electron')` in plain Node resolves to the Electron binary path.
# If it fails, the postinstall download was likely skipped.
ELECTRON_BIN="$(node -p "require('electron')" 2>/dev/null)" || {
  echo "error: could not resolve the Electron binary — run 'node node_modules/electron/install.js' and retry" >&2
  exit 1
}

exec env ELECTRON_RUN_AS_NODE=1 "$ELECTRON_BIN" ./node_modules/tsx/dist/cli.mjs "$@"