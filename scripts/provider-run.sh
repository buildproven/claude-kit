#!/usr/bin/env bash
# Run one headless prompt through the selected provider with typed fallback.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=provider-policy.sh
source "$SCRIPT_DIR/provider-policy.sh"
PROVIDER_ERROR_JS="$SCRIPT_DIR/quality-provider-error.js"

PROVIDER=""
FALLBACK=""
PROMPT_FILE=""
TARGET_DIR="$(pwd)"
TIMEOUT_SECONDS=1800
SANDBOX="workspace-write"
OUTPUT_DIR=""
EXECUTION_PLAN=""
GOVERNED_MODEL=""
GOVERNED_EFFORT=""

usage() {
  echo "usage: provider-run.sh --prompt-file file [--execution-plan plan.json] [--provider auto|codex|claude] [--fallback none|codex|claude] [--target-dir dir] [--timeout seconds] [--sandbox read-only|workspace-write] [--output-dir dir]" >&2
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
    --execution-plan) EXECUTION_PLAN="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
done

[ -r "$PROMPT_FILE" ] || { echo "provider-run: unreadable prompt file" >&2; exit 2; }
[ -d "$TARGET_DIR" ] || { echo "provider-run: target directory does not exist" >&2; exit 2; }
[[ "$TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || { echo "provider-run: timeout must be positive" >&2; exit 2; }
case "$SANDBOX" in read-only|workspace-write) ;; *) echo "provider-run: invalid sandbox" >&2; exit 2 ;; esac
[ -z "$EXECUTION_PLAN" ] || [ -r "$EXECUTION_PLAN" ] || { echo "provider-run: unreadable execution plan" >&2; exit 2; }

read -r POLICY_PRIMARY POLICY_FALLBACK < <(bs_provider_load)
REQUESTED_PROVIDER="$PROVIDER"
PROVIDER="${PROVIDER:-$POLICY_PRIMARY}"
FALLBACK="${FALLBACK:-$POLICY_FALLBACK}"
if [ "$PROVIDER" = auto ]; then PROVIDER=$(bs_provider_invoker); fi
bs_provider_validate "$PROVIDER" "$FALLBACK" || { echo "provider-run: invalid provider selection" >&2; exit 2; }

# A governed invocation may not inherit the interactive session's model or
# effort. Validate the versioned plan before any provider subprocess starts,
# then require its provider to match an explicit --provider if one was supplied.
if [ -n "$EXECUTION_PLAN" ]; then
  node "$SCRIPT_DIR/compute-governor.js" validate-plan "$EXECUTION_PLAN" >/dev/null \
    || { echo "provider-run: invalid execution plan" >&2; exit 2; }
  PLAN_PROVIDER=$(jq -r '.provider' "$EXECUTION_PLAN")
  if [ -n "$REQUESTED_PROVIDER" ] && [ "$REQUESTED_PROVIDER" != auto ] && [ "$REQUESTED_PROVIDER" != "$PLAN_PROVIDER" ]; then
    echo "provider-run: explicit provider conflicts with execution plan" >&2
    exit 2
  fi
  PROVIDER="$PLAN_PROVIDER"
  GOVERNED_MODEL=$(jq -r '.model' "$EXECUTION_PLAN")
  GOVERNED_EFFORT=$(jq -r '.effort // empty' "$EXECUTION_PLAN")
  FALLBACK=none
fi

OUTPUT_DIR="${OUTPUT_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/provider-run.XXXXXX")}"
mkdir -p "$OUTPUT_DIR"
DEADLINE="$SCRIPT_DIR/run-with-deadline.py"

write_governed_record() {
  local status="$1" effective_provider="$2"
  [ -n "$EXECUTION_PLAN" ] || return 0
  jq -n \
    --argjson plan "$(cat "$EXECUTION_PLAN")" \
    --arg status "$status" \
    --arg provider "$effective_provider" \
    '{schemaVersion:1, plan:$plan, effective:{provider:$provider,model:$plan.model,effort:$plan.effort}, outcome:{status:$status}, usage:null}' \
    > "$OUTPUT_DIR/run-record.json"
  node "$SCRIPT_DIR/compute-governor.js" validate-run-record "$OUTPUT_DIR/run-record.json" >/dev/null
}

# Classify a provider failure from STRUCTURED error metadata only — never by
# grepping the raw transcript (BUI-325). Model output can legitimately contain
# incidental exhaustion-marker text (this repo's own quality docs mention
# "429" and "weekly usage limits"), so scanning stdout/stderr text as a whole
# false-positives whenever an agentic run reads a file containing those
# strings. `quality-provider-error.js` only matches typed error events (a
# `{"type":"error",...}` / `{"is_error":true,...}` envelope with a numeric
# status/code, or Codex's own typed usage-limit message) and ignores ordinary
# review/tool-output text — same contract as claude-review-companion.sh and
# quality-run-review.sh use for the blocking review path.
classify_provider_failure() {
  local evidence="$1" failure_json
  failure_json="$(node "$PROVIDER_ERROR_JS" describe "$evidence" 2>/dev/null)" || return 1
  printf '%s' "$failure_json" | jq -r '.category'
}

run_one() {
  local provider="$1" rc last_message_file events_file result category detail
  local -a CODEX_PLAN_ARGS=() CLAUDE_MODEL_ARGS=()
  local stdout_file="$OUTPUT_DIR/$provider.stdout"
  local stderr_file="$OUTPUT_DIR/$provider.stderr"
  : > "$stdout_file"
  : > "$stderr_file"
  case "$provider" in
    codex)
      command -v codex >/dev/null 2>&1 || return 74
      last_message_file="$OUTPUT_DIR/$provider.last-message"
      events_file="$OUTPUT_DIR/$provider.events.jsonl"
      : > "$last_message_file"
      [ -z "$GOVERNED_MODEL" ] || CODEX_PLAN_ARGS+=(--model "$GOVERNED_MODEL")
      [ -z "$GOVERNED_EFFORT" ] || CODEX_PLAN_ARGS+=(-c "model_reasoning_effort=\"$GOVERNED_EFFORT\"")
      if python3 "$DEADLINE" --timeout-seconds "$TIMEOUT_SECONDS" -- \
        codex exec --ephemeral -C "$TARGET_DIR" -s "$SANDBOX" --json \
        "${CODEX_PLAN_ARGS[@]}" \
        -o "$last_message_file" - \
        < "$PROMPT_FILE" > "$events_file" 2> "$stderr_file"; then
        rc=0
      else
        rc=$?
      fi
      cp "$last_message_file" "$stdout_file"
      [ "$rc" -eq 0 ] && return 0
      [ "$rc" -eq 124 ] && return 76
      # The JSONL event stream is the provider's own structured status
      # channel; classify from it (and stderr) instead of the last-message
      # transcript, which is model output and may contain arbitrary text.
      category="$(classify_provider_failure "$events_file")" || category=""
      [ -n "$category" ] || category="$(classify_provider_failure "$stderr_file")" || category=""
      if [ "$category" = provider-exhaustion ]; then
        detail=$(node "$PROVIDER_ERROR_JS" describe "$events_file" 2>/dev/null | jq -r '.resetAt // empty' || true)
        [ -n "$detail" ] || detail=$(node "$PROVIDER_ERROR_JS" describe "$stderr_file" 2>/dev/null | jq -r '.resetAt // empty' || true)
        echo "$provider exhausted${detail:+: reset $detail}" >&2
        return 75
      fi
      if bs_provider_unavailable "$stderr_file"; then return 74; fi
      return "$rc"
      ;;
    claude)
      command -v claude >/dev/null 2>&1 || return 74
      if (
        cd "$TARGET_DIR"
        [ -z "$GOVERNED_MODEL" ] || CLAUDE_MODEL_ARGS+=(--model "$GOVERNED_MODEL")
        [ -z "$GOVERNED_EFFORT" ] || CLAUDE_MODEL_ARGS+=(--effort "$GOVERNED_EFFORT")
        python3 "$DEADLINE" --timeout-seconds "$TIMEOUT_SECONDS" -- \
          claude -p "$(cat "$PROMPT_FILE")" --no-session-persistence \
            --dangerously-skip-permissions --output-format json "${CLAUDE_MODEL_ARGS[@]}"
      ) > "$stdout_file" 2> "$stderr_file"; then
        rc=0
      else
        rc=$?
      fi
      # The CLI's JSON envelope is authoritative even when the process exits
      # 0 (some provider CLIs report is_error inside a status-0 envelope);
      # classify it before trusting rc alone.
      category="$(classify_provider_failure "$stdout_file")" || category=""
      [ -n "$category" ] || { [ "$rc" -ne 0 ] && category="$(classify_provider_failure "$stderr_file")"; } || category=""
      if [ "$category" = provider-exhaustion ]; then
        detail=$(node "$PROVIDER_ERROR_JS" describe "$stdout_file" 2>/dev/null | jq -r '.resetAt // empty' || true)
        [ -n "$detail" ] || detail=$(node "$PROVIDER_ERROR_JS" describe "$stderr_file" 2>/dev/null | jq -r '.resetAt // empty' || true)
        echo "$provider exhausted${detail:+: reset $detail}" >&2
        return 75
      fi
      if [ "$rc" -eq 0 ]; then
        result="$(jq -r 'if (.is_error == true) or (.result == null) then empty else .result end' "$stdout_file" 2>/dev/null || true)"
        [ -n "$result" ] && printf '%s\n' "$result" > "$stdout_file"
        return 0
      fi
      [ "$rc" -eq 124 ] && return 76
      if bs_provider_unavailable "$stdout_file" || bs_provider_unavailable "$stderr_file"; then return 74; fi
      return "$rc"
      ;;
    *) return 74 ;;
  esac
}

set +e
run_one "$PROVIDER"
RC=$?
set -e
if [ "$RC" -eq 0 ]; then
  printf '%s\n' "$PROVIDER" > "$OUTPUT_DIR/provider"
  write_governed_record passed "$PROVIDER"
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
