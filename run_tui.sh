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
OPENCLAW_STATE_DIR="$STATE_DIR" OPENCLAW_USE_SYSTEM_CONFIG=1 OPENCLAW_CONFIG_PATH="$CONFIG_PATH" exec ./bin/cli.sh tui --token "$TOKEN" "$@"
