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
EXECUTION_FACTS=""
GOVERNED_MODEL=""
GOVERNED_EFFORT=""
PROMPT_SNAPSHOT=""
GOVERNED_TARGET_SNAPSHOT=""
ORIGINAL_TARGET_DIR=""
GOVERNED_PATCH=""
GOVERNED_HANDOFF_LOCK=""
PLAN_SNAPSHOT=""

cleanup_governed_inputs() {
  if [ -n "$GOVERNED_TARGET_SNAPSHOT" ] && [ -n "$ORIGINAL_TARGET_DIR" ]; then
    git -C "$ORIGINAL_TARGET_DIR" worktree remove --force "$GOVERNED_TARGET_SNAPSHOT" >/dev/null 2>&1 || true
  fi
  [ -z "$PROMPT_SNAPSHOT" ] || rm -f "$PROMPT_SNAPSHOT"
  [ -z "$GOVERNED_PATCH" ] || rm -f "$GOVERNED_PATCH"
  [ -z "$PLAN_SNAPSHOT" ] || rm -f "$PLAN_SNAPSHOT"
  if [ -n "$GOVERNED_HANDOFF_LOCK" ]; then
    rm -f "$GOVERNED_HANDOFF_LOCK/owner"
    rmdir "$GOVERNED_HANDOFF_LOCK" 2>/dev/null || true
  fi
}
trap cleanup_governed_inputs EXIT

usage() {
  echo "usage: provider-run.sh --prompt-file file [--execution-plan plan.json | --execution-facts facts.json] [--provider auto|codex|claude] [--fallback none|codex|claude] [--target-dir dir] [--timeout seconds] [--sandbox read-only|workspace-write] [--output-dir dir]" >&2
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
    --execution-facts) EXECUTION_FACTS="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
done

[ -r "$PROMPT_FILE" ] || { echo "provider-run: unreadable prompt file" >&2; exit 2; }
[ -d "$TARGET_DIR" ] || { echo "provider-run: target directory does not exist" >&2; exit 2; }
[[ "$TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || { echo "provider-run: timeout must be positive" >&2; exit 2; }
case "$SANDBOX" in read-only|workspace-write) ;; *) echo "provider-run: invalid sandbox" >&2; exit 2 ;; esac
[ -z "$EXECUTION_PLAN" ] || [ -r "$EXECUTION_PLAN" ] || { echo "provider-run: unreadable execution plan" >&2; exit 2; }
[ -z "$EXECUTION_FACTS" ] || [ -r "$EXECUTION_FACTS" ] || { echo "provider-run: unreadable execution facts" >&2; exit 2; }
[ -z "$EXECUTION_PLAN" ] || [ -z "$EXECUTION_FACTS" ] || { echo "provider-run: choose execution plan or facts, not both" >&2; exit 2; }

OUTPUT_DIR="${OUTPUT_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/provider-run.XXXXXX")}"
mkdir -p "$OUTPUT_DIR"
for evidence_name in run-record.json provider; do
  [ ! -e "$OUTPUT_DIR/$evidence_name" ] || { echo "provider-run: output directory already contains governed evidence" >&2; exit 2; }
done
if [ -e "$OUTPUT_DIR/execution-plan.json" ]; then
  [ -n "$EXECUTION_PLAN" ] || { echo "provider-run: output directory already contains governed evidence" >&2; exit 2; }
  OUTPUT_PLAN_REAL=$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$OUTPUT_DIR/execution-plan.json")
  INPUT_PLAN_REAL=$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$EXECUTION_PLAN")
  [ "$OUTPUT_PLAN_REAL" = "$INPUT_PLAN_REAL" ] || { echo "provider-run: output directory already contains governed evidence" >&2; exit 2; }
fi

# Governed launches validate and execute the same private prompt snapshot.
# This closes the gap where another process could replace the caller-owned
# prompt between plan validation and provider stdin expansion.
if [ -n "$EXECUTION_PLAN" ] || [ -n "$EXECUTION_FACTS" ]; then
  PROMPT_SNAPSHOT=$(mktemp "${TMPDIR:-/tmp}/provider-prompt.XXXXXX") \
    || { echo "provider-run: cannot allocate prompt snapshot" >&2; exit 2; }
  cp "$PROMPT_FILE" "$PROMPT_SNAPSHOT"
  chmod 400 "$PROMPT_SNAPSHOT"
  PROMPT_FILE="$PROMPT_SNAPSHOT"
fi

read -r POLICY_PRIMARY POLICY_FALLBACK < <(bs_provider_load)
REQUESTED_PROVIDER="$PROVIDER"
PROVIDER="${PROVIDER:-$POLICY_PRIMARY}"
FALLBACK="${FALLBACK:-$POLICY_FALLBACK}"
if [ "$PROVIDER" = auto ]; then PROVIDER=$(bs_provider_invoker); fi
bs_provider_validate "$PROVIDER" "$FALLBACK" || { echo "provider-run: invalid provider selection" >&2; exit 2; }

if [ -n "$EXECUTION_FACTS" ]; then
  EXECUTION_PLAN="$OUTPUT_DIR/execution-plan.json"
  PLAN_TEMP=$(mktemp "$OUTPUT_DIR/.execution-plan.XXXXXX") \
    || { echo "provider-run: cannot allocate execution plan" >&2; exit 2; }
  if ! jq --arg provider "$PROVIDER" '. + {provider:$provider}' "$EXECUTION_FACTS" \
    | node "$SCRIPT_DIR/compute-governor.js" resolve-execution - "$PROMPT_FILE" "$TARGET_DIR" > "$PLAN_TEMP"; then
    rm -f "$PLAN_TEMP"
    echo "provider-run: execution facts cannot be resolved" >&2
    exit 2
  fi
  mv "$PLAN_TEMP" "$EXECUTION_PLAN"
fi

# A governed invocation may not inherit the interactive session's model or
# effort. Validate the versioned plan before any provider subprocess starts,
# then require its provider to match an explicit --provider if one was supplied.
if [ -n "$EXECUTION_PLAN" ]; then
  PLAN_SNAPSHOT=$(mktemp "${TMPDIR:-/tmp}/provider-plan.XXXXXX") \
    || { echo "provider-run: cannot allocate execution plan snapshot" >&2; exit 2; }
  cp "$EXECUTION_PLAN" "$PLAN_SNAPSHOT"
  chmod 400 "$PLAN_SNAPSHOT"
  EXECUTION_PLAN="$PLAN_SNAPSHOT"
  node "$SCRIPT_DIR/compute-governor.js" validate-execution-plan "$EXECUTION_PLAN" "$PROMPT_FILE" "$TARGET_DIR" >/dev/null \
    || { echo "provider-run: invalid execution plan" >&2; exit 2; }
  PLAN_PROVIDER=$(jq -r '.provider' "$EXECUTION_PLAN")
  if [ -n "$REQUESTED_PROVIDER" ] && [ "$REQUESTED_PROVIDER" != auto ] && [ "$REQUESTED_PROVIDER" != "$PLAN_PROVIDER" ]; then
    echo "provider-run: explicit provider conflicts with execution plan" >&2
    exit 2
  fi
  PROVIDER="$PLAN_PROVIDER"
  GOVERNED_MODEL=$(jq -r '.model' "$EXECUTION_PLAN")
  GOVERNED_EFFORT=$(jq -r '.effort // empty' "$EXECUTION_PLAN")
  PLAN_TIMEOUT=$(jq -r '.caps.maxWallSeconds' "$EXECUTION_PLAN")
  if [ "$TIMEOUT_SECONDS" -gt "$PLAN_TIMEOUT" ]; then
    TIMEOUT_SECONDS="$PLAN_TIMEOUT"
  fi
  FALLBACK=none

  # Execute from a detached worktree at the exact bound HEAD. The provider can
  # never observe concurrent edits to the caller's live target. Its resulting
  # binary patch is applied back only if that target is still clean and at the
  # same HEAD, preventing either overwrite or mixed-state delivery.
  ORIGINAL_TARGET_DIR="$TARGET_DIR"
  GOVERNED_TARGET_SNAPSHOT=$(mktemp -d "${TMPDIR:-/tmp}/provider-target.XXXXXX") \
    || { echo "provider-run: cannot allocate target snapshot" >&2; exit 2; }
  PLAN_TARGET_HEAD=$(jq -r '.executionBinding.targetHead' "$EXECUTION_PLAN")
  git -C "$ORIGINAL_TARGET_DIR" worktree add --detach "$GOVERNED_TARGET_SNAPSHOT" "$PLAN_TARGET_HEAD" >/dev/null \
    || { echo "provider-run: cannot create immutable target snapshot" >&2; exit 2; }
  node "$SCRIPT_DIR/compute-governor.js" validate-execution-plan \
    "$EXECUTION_PLAN" "$PROMPT_FILE" "$ORIGINAL_TARGET_DIR" >/dev/null \
    || { echo "provider-run: governed inputs changed before launch" >&2; exit 2; }
  TARGET_DIR="$GOVERNED_TARGET_SNAPSHOT"
fi

DEADLINE="$SCRIPT_DIR/run-with-deadline.py"
GOVERNED_STARTED_AT_MS=""
[ -z "$EXECUTION_PLAN" ] || GOVERNED_STARTED_AT_MS=$(python3 -c 'import time; print(time.time_ns() // 1000000)')

write_governed_record() {
  local status="$1" effective_provider="$2" exit_code="$3" failure_category="$4" finished_at_ms record_temp
  [ -n "$EXECUTION_PLAN" ] || return 0
  finished_at_ms=$(python3 -c 'import time; print(time.time_ns() // 1000000)')
  record_temp=$(mktemp "$OUTPUT_DIR/.run-record.XXXXXX") \
    || { echo "provider-run: cannot allocate run record" >&2; return 1; }
  jq -n \
    --argjson plan "$(cat "$EXECUTION_PLAN")" \
    --arg status "$status" \
    --arg provider "$effective_provider" \
    --arg failureCategory "$failure_category" \
    --argjson exitCode "$exit_code" \
    --argjson startedAt "$GOVERNED_STARTED_AT_MS" \
    --argjson finishedAt "$finished_at_ms" \
    '{schemaVersion:1, plan:$plan, requested:{provider:$plan.provider,model:$plan.model,effort:$plan.effort}, effective:{provider:$provider,model:$plan.model,effort:$plan.effort}, attempts:1, timing:{startedAtEpochMs:$startedAt,finishedAtEpochMs:$finishedAt}, outcome:{status:$status,exitCode:$exitCode,providerFailureCategory:(if $failureCategory == "" then null else $failureCategory end)}, usage:null}' \
    > "$record_temp"
  if ! node "$SCRIPT_DIR/compute-governor.js" validate-run-record "$record_temp" >/dev/null; then
    rm -f "$record_temp"
    return 1
  fi
  mv "$record_temp" "$OUTPUT_DIR/run-record.json"
}

fail_governed_handoff() {
  local message="$1"
  write_governed_record failed "$PROVIDER" 78 delivery-failed >/dev/null 2>&1 || true
  echo "$message" >&2
  exit 78
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
  # Persist a non-success receipt before handoff. It is promoted to `passed`
  # only after delivery succeeds, so a failed state transition can never leave
  # an undelivered run represented as successful.
  if ! write_governed_record failed "$PROVIDER" 78 delivery-pending; then
    echo "provider-run: provider succeeded but pending delivery evidence could not be persisted: $OUTPUT_DIR" >&2
    exit 78
  fi
  if [ -n "$EXECUTION_PLAN" ]; then
    GOVERNED_GIT_COMMON_DIR=$(git -C "$ORIGINAL_TARGET_DIR" rev-parse --path-format=absolute --git-common-dir)
    GOVERNED_HANDOFF_LOCK="$GOVERNED_GIT_COMMON_DIR/buildproven-governed-handoff.lock"
    mkdir "$GOVERNED_HANDOFF_LOCK" 2>/dev/null || {
      fail_governed_handoff "provider-run: another governed target handoff is active"
    }
    printf '%s\n' "pid=$$ head=$PLAN_TARGET_HEAD" > "$GOVERNED_HANDOFF_LOCK/owner"
    [ "$(git -C "$ORIGINAL_TARGET_DIR" rev-parse HEAD)" = "$PLAN_TARGET_HEAD" ] &&
      [ -z "$(git -C "$ORIGINAL_TARGET_DIR" status --porcelain=v1 --untracked-files=all)" ] || {
        fail_governed_handoff "provider-run: original target changed during governed execution; refusing to apply provider changes"
      }
    GOVERNED_PATCH=$(mktemp "${TMPDIR:-/tmp}/provider-changes.XXXXXX") || {
      fail_governed_handoff "provider-run: cannot allocate governed change handoff"
    }
    git -C "$TARGET_DIR" add -N --all
    git -C "$TARGET_DIR" diff --binary "$PLAN_TARGET_HEAD" -- > "$GOVERNED_PATCH"
    if [ -s "$GOVERNED_PATCH" ]; then
      git -C "$ORIGINAL_TARGET_DIR" apply --index --binary "$GOVERNED_PATCH" || {
        fail_governed_handoff "provider-run: governed provider changes could not be applied atomically"
      }
      GOVERNED_LIVE_PATCH=$(mktemp "${TMPDIR:-/tmp}/provider-live.XXXXXX") ||
        fail_governed_handoff "provider-run: cannot allocate handoff verification"
      git -C "$ORIGINAL_TARGET_DIR" add -N --all
      git -C "$ORIGINAL_TARGET_DIR" diff --binary "$PLAN_TARGET_HEAD" -- > "$GOVERNED_LIVE_PATCH"
      if ! cmp -s "$GOVERNED_PATCH" "$GOVERNED_LIVE_PATCH"; then
        git -C "$ORIGINAL_TARGET_DIR" apply --reverse --binary "$GOVERNED_PATCH" >/dev/null 2>&1 || true
        git -C "$ORIGINAL_TARGET_DIR" reset --mixed "$PLAN_TARGET_HEAD" --
        rm -f "$GOVERNED_LIVE_PATCH"
        fail_governed_handoff "provider-run: target changed during governed handoff; provider changes rolled back"
      fi
      rm -f "$GOVERNED_LIVE_PATCH"
      git -C "$ORIGINAL_TARGET_DIR" reset --mixed "$PLAN_TARGET_HEAD" --
    fi
  fi
  if ! write_governed_record passed "$PROVIDER" 0 ""; then
    if [ -n "$EXECUTION_PLAN" ] && [ -s "$GOVERNED_PATCH" ]; then
      git -C "$ORIGINAL_TARGET_DIR" apply --reverse --binary "$GOVERNED_PATCH" >/dev/null 2>&1 || true
      git -C "$ORIGINAL_TARGET_DIR" reset --mixed "$PLAN_TARGET_HEAD" --
    fi
    echo "provider-run: delivery completed but terminal success evidence could not be persisted: $OUTPUT_DIR" >&2
    exit 78
  fi
  if [ -n "$GOVERNED_HANDOFF_LOCK" ]; then
    rm -f "$GOVERNED_HANDOFF_LOCK/owner"
    rmdir "$GOVERNED_HANDOFF_LOCK"
    GOVERNED_HANDOFF_LOCK=""
  fi
  printf '%s\n' "$PROVIDER" > "$OUTPUT_DIR/provider"
  cat "$OUTPUT_DIR/$PROVIDER.stdout"
  exit 0
fi

case "$RC" in
  74) GOVERNED_STATUS="unavailable"; GOVERNED_FAILURE="provider-unavailable" ;;
  75) GOVERNED_STATUS="exhausted"; GOVERNED_FAILURE="provider-exhaustion" ;;
  76) GOVERNED_STATUS="timeout"; GOVERNED_FAILURE="provider-timeout" ;;
  *) GOVERNED_STATUS="failed"; GOVERNED_FAILURE="provider-error" ;;
esac
if ! write_governed_record "$GOVERNED_STATUS" "$PROVIDER" "$RC" "$GOVERNED_FAILURE"; then
  echo "provider-run: provider failed and terminal evidence could not be persisted: $OUTPUT_DIR" >&2
  exit 78
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
