ROOT="$(cd "$(dirname "$0")" && pwd)"
if [[ -f "$ROOT/.env" ]]; then
  set -a
  . "$ROOT/.env"
  set +a
fi

STATE_DIR="$HOME/.openclaw"
CONFIG_PATH="$STATE_DIR/openclaw.json"

# TOKEN is loaded from .env
TOKEN="${TOKEN:-dev-local-token}"
export OPENCLAW_GATEWAY_TOKEN="$TOKEN"

if [[ -z "${OPENAI_API_KEY:-}" && -n "${BYTEDANCE_API_KEY:-}" ]]; then
  export OPENAI_API_KEY="$BYTEDANCE_API_KEY"
fi
if [[ -z "${BYTEDANCE_API_KEY:-}" && -n "${OPENAI_API_KEY:-}" ]]; then
  export BYTEDANCE_API_KEY="$OPENAI_API_KEY"
fi

OPENCLAW_STATE_DIR="$STATE_DIR" OPENCLAW_USE_SYSTEM_CONFIG=1 OPENCLAW_CONFIG_PATH="$CONFIG_PATH" exec ./bin/cli.sh gateway --force --token "$TOKEN" "$@"
