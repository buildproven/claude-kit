#!/usr/bin/env bash
# Install one lean MCP capability profile across Claude Code and Codex.
set -euo pipefail

# SETUP_REPO must be the OVERLAY root, not wherever this script's own copy is
# checked out — config/mcp.json only exists at the overlay root (there is no
# core/config/mcp.json unless an overlay provides one), so a $BASH_SOURCE-
# relative default breaks silently when this file ships from core/scripts/
# inside the kit submodule. Resolve through the installed symlink target
# instead (see setup-codex-skill-profile.sh for the same fix pattern).
SETUP_MCP_PARITY_REAL_PATH="$(readlink -f "${HOME}/.claude/scripts/setup-mcp-parity.sh" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
SETUP_REPO="${SETUP_REPO:-$(cd "$(dirname "$SETUP_MCP_PARITY_REAL_PATH")/.." && pwd -P)}"
MANIFEST="$SETUP_REPO/config/mcp.json"
PROFILE=""
LOGIN=0
FORCE=0
CHECK=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --profile)
      [ "$#" -ge 2 ] || { echo "--profile requires a value" >&2; exit 2; }
      PROFILE="$2"
      shift
      ;;
    --login) LOGIN=1 ;;
    --force) FORCE=1 ;;
    --check) CHECK=1 ;;
    *) echo "usage: setup-mcp-parity.sh [--profile NAME] [--force] [--login] [--check]" >&2; exit 2 ;;
  esac
  shift
done

if [ "$CHECK" -eq 1 ] && { [ "$LOGIN" -eq 1 ] || [ "$FORCE" -eq 1 ]; }; then
  echo "--check cannot be combined with --force or --login" >&2
  exit 2
fi

command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 1; }
jq -e '
  . as $manifest |
  (.servers | type == "array") and
  (.profiles | type == "object") and
  ([.servers[].name] | length == (unique | length)) and
  ([.profiles[]][] | all(. as $name | [$manifest.servers[].name] | index($name) != null))
' "$MANIFEST" >/dev/null || {
  echo "invalid MCP manifest/profile configuration" >&2
  exit 1
}

if [ -z "$PROFILE" ]; then
  PROFILE="$(jq -r '.defaultProfile' "$MANIFEST")"
fi
jq -e --arg profile "$PROFILE" '.profiles[$profile] | type == "array"' "$MANIFEST" >/dev/null || {
  echo "unknown MCP profile: $PROFILE" >&2
  exit 2
}

for client in claude codex; do
  command -v "$client" >/dev/null 2>&1 || {
    echo "$client CLI is required for MCP profile sync" >&2
    exit 1
  }
done

managed_retired_registration() {
  client="$1"
  name="$2"
  expected_command="$3"
  if [ "$client" = claude ]; then
    python3 - "$HOME/.claude.json" "$name" "$expected_command" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
if not path.is_file():
    raise SystemExit(1)
try:
    definition = json.loads(path.read_text(encoding="utf8")).get("mcpServers", {}).get(sys.argv[2])
except (OSError, ValueError, TypeError):
    raise SystemExit(2)
raise SystemExit(0 if isinstance(definition, dict)
                 and definition.get("command") == sys.argv[3]
                 and definition.get("args", []) == [] else 1)
PY
    return
  fi

  definition="$("$client" mcp get "$name" 2>/dev/null)" || return 1
  printf '%s\n' "$definition" | grep -Fqx "  command: $expected_command" &&
    printf '%s\n' "$definition" | grep -Fqx '  args: -'
}

prune_retired_registration() {
  client="$1"
  name="$2"
  expected_command="$3"
  status=0
  managed_retired_registration "$client" "$name" "$expected_command" || status=$?
  [ "$status" -ne 2 ] || {
    echo "unable to inspect $client retired MCP registration: $name" >&2
    return 1
  }
  [ "$status" -eq 0 ] || return 0
  if [ "$CHECK" -eq 1 ]; then
    echo "$client has managed retired MCP server: $name" >&2
    DRIFT=1
  elif [ "$client" = claude ]; then
    "$client" mcp remove --scope user "$name"
  else
    "$client" mcp remove "$name"
  fi
}

SELECTED_MANIFEST="$(mktemp "${TMPDIR:-/tmp}/bs-mcp-profile.XXXXXX")"
cleanup() {
  rm -f "$SELECTED_MANIFEST"
}
trap cleanup EXIT

jq --arg profile "$PROFILE" '
  ((.profiles[.defaultProfile] + .profiles[$profile]) | unique) as $selected
  | {servers: [.servers[] | select(.name as $name | $selected | index($name) != null)]}
' "$MANIFEST" > "$SELECTED_MANIFEST"

args=(--manifest "$SELECTED_MANIFEST")
[ "$FORCE" -eq 0 ] || args+=(--force)
[ "$LOGIN" -eq 0 ] || args+=(--login)
[ "$CHECK" -eq 0 ] || args+=(--check)

# Add/refresh the desired profile before pruning anything. A failed connection
# or auth step leaves a safe superset of capabilities.
#
# mcp-sync.py lives alongside THIS script (same layer — core/scripts/ if this
# ships from the kit, an overlay's scripts/ if overridden there), not
# necessarily under $SETUP_REPO/core/ — a standalone kit install has no
# core/ subdirectory at all.
MCP_SYNC_PY="$(dirname "$SETUP_MCP_PARITY_REAL_PATH")/mcp-sync.py"
DRIFT=0
python3 "$MCP_SYNC_PY" "${args[@]}" || DRIFT=1
[ "$CHECK" -eq 1 ] || [ "$DRIFT" -eq 0 ] || exit 1

# Prune only names owned by this manifest. Unknown/user-managed servers are
# never touched.
while IFS= read -r server; do
  for client in claude codex; do
    jq -e --arg server "$server" --arg client "$client" '
      any(.servers[];
        .name == $server and
        ((.clients // ["claude", "codex"]) | index($client) != null)
      )
    ' "$SELECTED_MANIFEST" >/dev/null && continue
    if "$client" mcp get "$server" >/dev/null 2>&1; then
      if [ "$CHECK" -eq 1 ]; then
        echo "$client has out-of-profile MCP server: $server" >&2
        DRIFT=1
        continue
      fi
      if [ "$client" = claude ]; then
        "$client" mcp remove --scope user "$server"
      else
        "$client" mcp remove "$server"
      fi
    fi
  done
done < <(jq -r '.servers[].name, "sequential-thinking", "claude-kit-license"' "$MANIFEST")

# These names were removed from the manifest, so prune only the exact
# registrations previously installed by this repository.
for client in claude codex; do
  prune_retired_registration \
    "$client" ideabrowser "$SETUP_REPO/scripts/run-ideabrowser-mcp.sh"
  prune_retired_registration \
    "$client" readwise "$SETUP_REPO/scripts/run-readwise-mcp.sh"
done

[ "$DRIFT" -eq 0 ] || exit 1
echo "MCP profile active: $PROFILE ($(jq '.servers | length' "$SELECTED_MANIFEST") server(s))"
