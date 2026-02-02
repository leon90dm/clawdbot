ROOT="$(cd "$(dirname "$0")" && pwd)"
if [[ -f "$ROOT/.env" ]]; then
  set -a
  . "$ROOT/.env"
  set +a
fi
if [[ -f "$ROOT/links/.openclaw/.env" ]]; then
  set -a
  . "$ROOT/links/.openclaw/.env"
  set +a
fi
TOKEN="${OPENCLAW_GATEWAY_TOKEN:-dev-local-token}"
STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
if [[ -z "${OPENAI_API_KEY:-}" && -n "${BYTEDANCE_API_KEY:-}" ]]; then
  export OPENAI_API_KEY="$BYTEDANCE_API_KEY"
fi
if [[ -z "${BYTEDANCE_API_KEY:-}" && -n "${OPENAI_API_KEY:-}" ]]; then
  export BYTEDANCE_API_KEY="$OPENAI_API_KEY"
fi
OPENCLAW_STATE_DIR="$STATE_DIR" OPENCLAW_USE_SYSTEM_CONFIG=1 OPENCLAW_CONFIG_PATH="$ROOT/links/.openclaw/openclaw.json" exec ./bin/cli.sh gateway --force --token "$TOKEN" "$@"
