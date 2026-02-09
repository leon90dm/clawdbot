#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
if [[ -f "$ROOT/.env" ]]; then
  set -a
  . "$ROOT/.env"
  set +a
fi

STATE_DIR="${HOME}/.openclaw"
CONFIG_PATH="${STATE_DIR}/openclaw.json"

# Helper to read value from config
read_config_value() {
  local key="$1"
  if [[ -f "$CONFIG_PATH" ]]; then
    # Simple grep/sed extraction for standard formatted json
    # Falls back to node for robustness if simple extraction fails or for nested keys
    node -e "try { const fs=require('fs'); const c=JSON.parse(fs.readFileSync('${CONFIG_PATH}')); console.log(c.${key} || ''); } catch(e) {}"
  fi
}

# Try to load token from config if not provided in env
if [[ -z "${TOKEN:-}" ]]; then
  CFG_TOKEN=$(read_config_value "gateway.auth.token")
  if [[ -n "$CFG_TOKEN" ]]; then
    TOKEN="$CFG_TOKEN"
  else
    TOKEN="dev-local-token"
  fi
fi

PORT="${OPENCLAW_GATEWAY_PORT:-18789}"
APP_BUNDLE="${OPENCLAW_APP_BUNDLE:-}"
MODE="local"
REMOTE_URL=""
OPEN_WEBCHAT=0
OPEN_PERMISSIONS=0
RESET_TCC=0
ATTACH_ONLY=0

usage() {
  cat <<'EOF'
Usage: run_app.sh [--app <OpenClaw.app>] [--port <port>] [--token <token>] [--mode <local|remote>] [--remote-url <ws://...>] [--webchat] [--attach-only] [--permissions] [--reset-tcc]

Environment:
  TOKEN                 Gateway token (default: dev-local-token)
  OPENCLAW_GATEWAY_PORT Gateway port (default: 18789)
  OPENCLAW_APP_BUNDLE   Path to OpenClaw.app (optional)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)
      APP_BUNDLE="${2:-}"; shift 2
      ;;
    --port)
      PORT="${2:-}"; shift 2
      ;;
    --token)
      TOKEN="${2:-}"; shift 2
      ;;
    --mode)
      MODE="${2:-}"; shift 2
      ;;
    --remote-url)
      REMOTE_URL="${2:-}"; shift 2
      ;;
    --webchat)
      OPEN_WEBCHAT=1; shift
      ;;
    --attach-only)
      ATTACH_ONLY=1; shift
      ;;
    --permissions)
      OPEN_PERMISSIONS=1; shift
      ;;
    --reset-tcc)
      RESET_TCC=1; shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

choose_app_bundle() {
  if [[ -n "${APP_BUNDLE}" && -d "${APP_BUNDLE}" ]]; then
    return 0
  fi
  if [[ -d "/Applications/OpenClaw.app" ]]; then
    APP_BUNDLE="/Applications/OpenClaw.app"
    return 0
  fi
  if [[ -d "${ROOT}/dist/OpenClaw.app" ]]; then
    APP_BUNDLE="${ROOT}/dist/OpenClaw.app"
    return 0
  fi
  echo "OpenClaw.app not found. Set OPENCLAW_APP_BUNDLE or pass --app <path>." >&2
  exit 1
}

open_permissions() {
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture" || true
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera" || true
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone" || true
}

reset_tcc() {
  local bundle_id="ai.openclaw.mac"
  /usr/bin/tccutil reset ScreenCapture "${bundle_id}" || true
  /usr/bin/tccutil reset Camera "${bundle_id}" || true
  /usr/bin/tccutil reset Microphone "${bundle_id}" || true
}

choose_app_bundle

export OPENCLAW_RUNAPP_TOKEN="${TOKEN}"
export OPENCLAW_RUNAPP_PORT="${PORT}"
export OPENCLAW_RUNAPP_MODE="${MODE}"
export OPENCLAW_RUNAPP_REMOTE_URL="${REMOTE_URL}"


if [[ "${RESET_TCC}" == "1" ]]; then
  reset_tcc
fi

# Ensure we are using a compatible Node version if possible
# If the current node is too old (e.g. from NVM), try to find a newer one
current_node_ver=$(node -v 2>/dev/null || echo "v0.0.0")
if [[ "${current_node_ver}" =~ ^v([0-9]+) ]]; then
  major_ver="${BASH_REMATCH[1]}"
  if (( major_ver < 22 )); then
    echo "Warning: Current node is ${current_node_ver}, but OpenClaw requires >= v22." >&2
    # Try to find a better node in common locations
    if [[ -x "/opt/homebrew/bin/node" ]]; then
      hb_ver=$(/opt/homebrew/bin/node -v)
      if [[ "${hb_ver}" =~ ^v([0-9]+) && "${BASH_REMATCH[1]}" -ge 22 ]]; then
        echo "Found compatible node at /opt/homebrew/bin/node (${hb_ver}). Prepending to PATH." >&2
        export PATH="/opt/homebrew/bin:$PATH"
      fi
    fi
  fi
fi

ARGS=()
if [[ "${OPEN_WEBCHAT}" == "1" ]]; then
  ARGS+=(--webchat)
fi
if [[ "${ATTACH_ONLY}" == "1" ]]; then
  ARGS+=(--attach-only)
else
  # If we are NOT in attach-only mode, remove the disable marker so the gateway starts.
  if [[ -f "${STATE_DIR}/disable-launchagent" ]]; then
    echo "Clearing ${STATE_DIR}/disable-launchagent to allow gateway auto-start..."
    rm -f "${STATE_DIR}/disable-launchagent"
  fi
fi

# Use direct executable to ensure environment variables (like PATH and NODE_PATH) are inherited.
# This fixes issues where 'open' command resets the environment, causing the app to find
# the wrong Node version (e.g. system node or old NVM version) instead of the one in current shell.
APP_EXECUTABLE="${APP_BUNDLE}/Contents/MacOS/OpenClaw"

if [[ ! -x "${APP_EXECUTABLE}" ]]; then
  echo "Executable not found or not executable: ${APP_EXECUTABLE}" >&2
  echo "Falling back to 'open' command..." >&2
  if (( ${#ARGS[@]} > 0 )); then
    /usr/bin/open -n "${APP_BUNDLE}" --args "${ARGS[@]}"
  else
    /usr/bin/open -n "${APP_BUNDLE}"
  fi
else
  echo "Launching ${APP_EXECUTABLE}..."
  if (( ${#ARGS[@]} > 0 )); then
    "${APP_EXECUTABLE}" "${ARGS[@]}"
  else
    "${APP_EXECUTABLE}"
  fi
fi

if [[ "${OPEN_PERMISSIONS}" == "1" ]]; then
  open_permissions
fi
