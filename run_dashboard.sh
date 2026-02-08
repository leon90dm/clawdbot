ROOT="$(cd "$(dirname "$0")" && pwd)"
if [[ -f "$ROOT/.env" ]]; then
  set -a
  . "$ROOT/.env"
  set +a
fi

STATE_DIR="$HOME/.openclaw"
CONFIG_PATH="$STATE_DIR/openclaw.json"

# TOKEN from .env
TOKEN="${TOKEN:-dev-local-token}"
export OPENCLAW_GATEWAY_TOKEN="$TOKEN"

if [[ -z "${OPENAI_API_KEY:-}" && -n "${BYTEDANCE_API_KEY:-}" ]]; then
  export OPENAI_API_KEY="$BYTEDANCE_API_KEY"
fi
if [[ -z "${BYTEDANCE_API_KEY:-}" && -n "${OPENAI_API_KEY:-}" ]]; then
  export BYTEDANCE_API_KEY="$OPENAI_API_KEY"
fi

PORT="${OPENCLAW_GATEWAY_PORT:-18789}"
BASE_PATH="${OPENCLAW_CONTROL_UI_BASE_PATH:-}"

BASE_PATH="$(printf '%s' "$BASE_PATH" | awk '{$1=$1;print}')"
if [[ -n "$BASE_PATH" && "$BASE_PATH" != /* ]]; then
  BASE_PATH="/$BASE_PATH"
fi
if [[ "$BASE_PATH" == "/" ]]; then
  BASE_PATH=""
fi
if [[ -n "$BASE_PATH" && "$BASE_PATH" == */ ]]; then
  BASE_PATH="${BASE_PATH%/}"
fi

control_ui_supports_url_token() {
  local assets_dir="$ROOT/dist/control-ui/assets"
  if [[ ! -d "$assets_dir" ]]; then
    return 1
  fi
  local js_file
  js_file="$(ls -1 "$assets_dir"/index-*.js 2>/dev/null | head -n 1 || true)"
  if [[ -z "${js_file:-}" ]]; then
    return 1
  fi
  grep -Eq "hashParams|location\\.hash" "$js_file" 2>/dev/null
}

ensure_control_ui_supports_url_token() {
  if control_ui_supports_url_token; then
    return 0
  fi
  if command -v pnpm >/dev/null 2>&1; then
    pnpm ui:build >/dev/null 2>&1
    return $?
  fi
  if command -v npm >/dev/null 2>&1; then
    npm run -s ui:build >/dev/null 2>&1
    return $?
  fi
  return 1
}

TOKEN_URLENCODED="$(node -e "process.stdout.write(encodeURIComponent(String(process.argv[1] ?? '')))" "$TOKEN" 2>/dev/null || printf '%s' "$TOKEN")"
ensure_control_ui_supports_url_token || true
DASHBOARD_URL="http://127.0.0.1:${PORT}${BASE_PATH}/#token=${TOKEN_URLENCODED}"

if [[ " $* " == *" --no-open "* ]]; then
  printf '%s\n' "$DASHBOARD_URL"
  exit 0
fi

printf '%s\n' "$DASHBOARD_URL"
if command -v open >/dev/null 2>&1; then
  open "$DASHBOARD_URL" >/dev/null 2>&1 || true
fi
