#!/bin/bash
ROOT="$(cd "$(dirname "$0")" && pwd)"

# Load .env if it exists
if [[ -f "$ROOT/.env" ]]; then
  set -a
  . "$ROOT/.env"
  set +a
fi

# Define standard paths
STATE_DIR="$HOME/.openclaw"
CONFIG_PATH="$STATE_DIR/openclaw.json"

# Resolve TOKEN
TOKEN="${TOKEN:-dev-local-token}"
export OPENCLAW_GATEWAY_TOKEN="$TOKEN"

# Sync API Keys
if [[ -z "${OPENAI_API_KEY:-}" && -n "${BYTEDANCE_API_KEY:-}" ]]; then
  export OPENAI_API_KEY="$BYTEDANCE_API_KEY"
fi
if [[ -z "${BYTEDANCE_API_KEY:-}" && -n "${OPENAI_API_KEY:-}" ]]; then
  export BYTEDANCE_API_KEY="$OPENAI_API_KEY"
fi

# Set OPENCLAW environment variables and execute the CLI
export OPENCLAW_STATE_DIR="$STATE_DIR"
export OPENCLAW_USE_SYSTEM_CONFIG=1
export OPENCLAW_CONFIG_PATH="$CONFIG_PATH"

exec "$ROOT/bin/cli.sh" "$@"
