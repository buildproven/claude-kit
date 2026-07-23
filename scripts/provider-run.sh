#!/usr/bin/env bash
# Run one headless prompt through the selected provider with typed fallback.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=provider-policy.sh
source "$SCRIPT_DIR/provider-policy.sh"

PROVIDER=""
FALLBACK=""
PROMPT_FILE=""
TARGET_DIR="$(pwd)"
TIMEOUT_SECONDS=1800
SANDBOX="workspace-write"
OUTPUT_DIR=""

usage() {
  echo "usage: provider-run.sh --prompt-file file [--provider auto|codex|claude] [--fallback none|codex|claude] [--target-dir dir] [--timeout seconds] [--sandbox read-only|workspace-write] [--output-dir dir]" >&2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --provider) PROVIDER="${2:-}"; shift 2 ;;
    --fallback) FALLBACK="${2:-}"; shift 2 ;;
    --prompt-file) PROMPT_FILE="${2:-}"; shift 2 ;;
    --target-dir) TARGET_DIR="${2:-}"; shift 2 ;;
    --timeout) TIMEOUT_SECONDS="${2:-}"; shift 2 ;;
    --sandbox) SANDBOX="${2:-}"; shift 2 ;;
    --output-dir) OUTPUT_DIR="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
done

[ -r "$PROMPT_FILE" ] || { echo "provider-run: unreadable prompt file" >&2; exit 2; }
[ -d "$TARGET_DIR" ] || { echo "provider-run: target directory does not exist" >&2; exit 2; }
[[ "$TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || { echo "provider-run: timeout must be positive" >&2; exit 2; }
case "$SANDBOX" in read-only|workspace-write) ;; *) echo "provider-run: invalid sandbox" >&2; exit 2 ;; esac

read -r POLICY_PRIMARY POLICY_FALLBACK < <(bs_provider_load)
PROVIDER="${PROVIDER:-$POLICY_PRIMARY}"
FALLBACK="${FALLBACK:-$POLICY_FALLBACK}"
if [ "$PROVIDER" = auto ]; then PROVIDER=$(bs_provider_invoker); fi
bs_provider_validate "$PROVIDER" "$FALLBACK" || { echo "provider-run: invalid provider selection" >&2; exit 2; }

OUTPUT_DIR="${OUTPUT_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/provider-run.XXXXXX")}"
mkdir -p "$OUTPUT_DIR"
DEADLINE="$SCRIPT_DIR/run-with-deadline.py"

run_one() {
  local provider="$1" rc detail
  local stdout_file="$OUTPUT_DIR/$provider.stdout"
  local stderr_file="$OUTPUT_DIR/$provider.stderr"
  : > "$stdout_file"
  : > "$stderr_file"
  case "$provider" in
    codex)
      command -v codex >/dev/null 2>&1 || return 74
      if python3 "$DEADLINE" --timeout-seconds "$TIMEOUT_SECONDS" -- \
        codex exec --ephemeral -C "$TARGET_DIR" -s "$SANDBOX" - \
        < "$PROMPT_FILE" > "$stdout_file" 2> "$stderr_file"; then
        rc=0
      else
        rc=$?
      fi
      ;;
    claude)
      command -v claude >/dev/null 2>&1 || return 74
      if (
        cd "$TARGET_DIR"
        python3 "$DEADLINE" --timeout-seconds "$TIMEOUT_SECONDS" -- \
          claude -p "$(cat "$PROMPT_FILE")" --no-session-persistence --dangerously-skip-permissions
      ) > "$stdout_file" 2> "$stderr_file"; then
        rc=0
      else
        rc=$?
      fi
      ;;
    *) return 74 ;;
  esac
  [ "$rc" -eq 0 ] && return 0
  if bs_provider_exhausted "$stdout_file" || bs_provider_exhausted "$stderr_file"; then
    detail=$(grep -Eih 'reset|429|weekly (usage )?limit|usage limit|rate.?limit|quota|try again at' "$stdout_file" "$stderr_file" 2>/dev/null | head -1 || true)
    echo "$provider exhausted${detail:+: $detail}" >&2
    return 75
  fi
  [ "$rc" -eq 124 ] && return 76
  if bs_provider_unavailable "$stdout_file" || bs_provider_unavailable "$stderr_file"; then return 74; fi
  return "$rc"
}

set +e
run_one "$PROVIDER"
RC=$?
set -e
if [ "$RC" -eq 0 ]; then
  printf '%s\n' "$PROVIDER" > "$OUTPUT_DIR/provider"
  cat "$OUTPUT_DIR/$PROVIDER.stdout"
  exit 0
fi

if [ "$FALLBACK" != none ] && [ "$FALLBACK" != "$PROVIDER" ] && { [ "$RC" -eq 74 ] || [ "$RC" -eq 75 ] || [ "$RC" -eq 76 ]; }; then
  echo "provider-run: $PROVIDER unavailable/exhausted; trying $FALLBACK" >&2
  set +e
  run_one "$FALLBACK"
  FALLBACK_RC=$?
  set -e
  if [ "$FALLBACK_RC" -eq 0 ]; then
    printf '%s\n' "$FALLBACK" > "$OUTPUT_DIR/provider"
    cat "$OUTPUT_DIR/$FALLBACK.stdout"
    exit 0
  fi
  echo "provider-run: both providers failed; evidence: $OUTPUT_DIR" >&2
  exit "$FALLBACK_RC"
fi

echo "provider-run: $PROVIDER failed (rc=$RC); evidence: $OUTPUT_DIR" >&2
exit "$RC"
