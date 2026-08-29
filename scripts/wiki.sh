#!/usr/bin/env bash
# Refresh the agent's OpenWiki knowledge base using the local Ollama daemon.
# Usage: scripts/wiki.sh [--init|--update] [extra openwiki args...]
set -euo pipefail
cd "$(dirname "$0")/../workspace"

export OPENWIKI_PROVIDER=openai-compatible
export OPENAI_COMPATIBLE_API_KEY="${OPENAI_COMPATIBLE_API_KEY:-ollama}"
export OPENAI_COMPATIBLE_BASE_URL="${OLLAMA_BASE_URL:-http://localhost:11434}/v1"
# Wiki generation benefits from a strong reasoning model regardless of the REPL model.
export OPENWIKI_MODEL_ID="${OPENWIKI_MODEL:-glm-5.2:cloud}"

exec npx openwiki code "${@:---update}" --print
