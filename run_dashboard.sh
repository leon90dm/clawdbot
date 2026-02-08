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
CONFIG_PATH="$ROOT/links/.openclaw/openclaw.json"
STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"

resolve_token_from_config() {
  local file_path="$1"
  if [[ ! -f "$file_path" ]]; then
    return 1
  fi
  node -e "const fs=require('fs'); let json5; try{json5=require('json5')}catch{} const raw=fs.readFileSync(process.argv[1],'utf8'); const cfg=(json5?json5.parse(raw):JSON.parse(raw)); const v=cfg?.gateway?.auth?.token; if (typeof v==='string' && v.trim()) process.stdout.write(v);" "$file_path" 2>/dev/null
}

resolve_gateway_port_from_config() {
  local file_path="$1"
  if [[ ! -f "$file_path" ]]; then
    return 1
  fi
  node -e "const fs=require('fs'); let json5; try{json5=require('json5')}catch{} const raw=fs.readFileSync(process.argv[1],'utf8'); const cfg=(json5?json5.parse(raw):JSON.parse(raw)); const v=cfg?.gateway?.port; if (typeof v==='number' && Number.isFinite(v) && v>0) process.stdout.write(String(v));" "$file_path" 2>/dev/null
}

resolve_control_ui_base_path_from_config() {
  local file_path="$1"
  if [[ ! -f "$file_path" ]]; then
    return 1
  fi
  node -e "const fs=require('fs'); let json5; try{json5=require('json5')}catch{} const raw=fs.readFileSync(process.argv[1],'utf8'); const cfg=(json5?json5.parse(raw):JSON.parse(raw)); const v=cfg?.gateway?.controlUi?.basePath; if (typeof v==='string' && v.trim()) process.stdout.write(v);" "$file_path" 2>/dev/null
}

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

TOKEN="${OPENCLAW_GATEWAY_TOKEN:-}"
if [[ -z "${TOKEN:-}" ]]; then
  TOKEN="$(resolve_token_from_config "$CONFIG_PATH" | tr -d '\n' | tr -d '\r' | awk '{$1=$1;print}' || true)"
fi
TOKEN="${TOKEN:-dev-local-token}"
TOKEN="$(printf '%s' "$TOKEN" | tr -d '\n' | tr -d '\r' | awk '{$1=$1;print}')"
export OPENCLAW_GATEWAY_TOKEN="$TOKEN"
if [[ -z "${OPENAI_API_KEY:-}" && -n "${BYTEDANCE_API_KEY:-}" ]]; then
  export OPENAI_API_KEY="$BYTEDANCE_API_KEY"
fi
if [[ -z "${BYTEDANCE_API_KEY:-}" && -n "${OPENAI_API_KEY:-}" ]]; then
  export BYTEDANCE_API_KEY="$OPENAI_API_KEY"
fi

PORT="${OPENCLAW_GATEWAY_PORT:-}"
if [[ -z "${PORT:-}" ]]; then
  PORT="$(resolve_gateway_port_from_config "$CONFIG_PATH" | tr -d '\n' | tr -d '\r' | awk '{$1=$1;print}' || true)"
fi
PORT="${PORT:-18789}"

BASE_PATH="${OPENCLAW_CONTROL_UI_BASE_PATH:-}"
if [[ -z "${BASE_PATH:-}" ]]; then
  BASE_PATH="$(resolve_control_ui_base_path_from_config "$CONFIG_PATH" | tr -d '\n' | tr -d '\r' | awk '{$1=$1;print}' || true)"
fi
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
