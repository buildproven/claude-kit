#!/usr/bin/env bash
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
MANIFEST=""
NAME=""
SKIP=false
REASON=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --manifest) MANIFEST="${2:-}"; shift 2 ;;
    --name) NAME="${2:-}"; shift 2 ;;
    --skip) SKIP=true; shift ;;
    --reason) REASON="${2:-}"; shift 2 ;;
    --) shift; break ;;
    *) echo "quality-run-gate: unknown argument '$1'" >&2; exit 1 ;;
  esac
done
[ -n "$MANIFEST" ] && [ -n "$NAME" ] || {
  echo "quality-run-gate: --manifest and --name are required" >&2
  exit 1
}
if [ "$SKIP" = true ]; then
  [ "$NAME" = test ] && [ -n "$REASON" ] && [ "$#" -eq 0 ] || {
    echo "quality-run-gate: --skip requires --name test, --reason, and no command" >&2
    exit 1
  }
elif [ "$#" -eq 0 ]; then
  :
else
  echo "quality-run-gate: commands are resolved from the persisted gate policy" >&2
  exit 1
fi
ROOT="$(node "$SCRIPT_DIR/quality-invocation.js" locate "$MANIFEST")" || exit 1
bash "$SCRIPT_DIR/quality-assert-clean.sh" \
  --manifest "$MANIFEST" --phase "gate '$NAME'" || exit 1
STATE_ROOT="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" stateRoot)"
HEAD="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" revisions.currentHead)"
LOG_DIR="$STATE_ROOT/gates/$HEAD"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/$NAME.log"
cd "$ROOT" || exit 1
PLAN="$(node "$SCRIPT_DIR/quality-invocation.js" gate-plan "$MANIFEST" --name "$NAME")" || exit 1
SOURCE="$(printf '%s' "$PLAN" | jq -er '.source')" || exit 1
COMMAND="$(printf '%s' "$PLAN" | jq -er '.command')" || exit 1
if [ "$SKIP" = true ]; then
  printf 'SKIPPED: %s\n' "$REASON" >"$LOG"
  node "$SCRIPT_DIR/quality-invocation.js" gate "$MANIFEST" \
    --name "$NAME" --status skipped --reason "$REASON" \
    --source "$SOURCE" --command "$COMMAND" --log "$LOG" || exit 1
  cat "$LOG"
  exit 0
fi
EXECUTABLE="$(printf '%s' "$PLAN" | jq -er '.executable')" || exit 1
mapfile -t COMMAND_ARGS < <(printf '%s' "$PLAN" | jq -er '.args[]')
GATE_TIMEOUT="$(node "$SCRIPT_DIR/quality-invocation.js" \
  field "$MANIFEST" risk.runtime.gateSeconds)" || exit 1
[ -n "$GATE_TIMEOUT" ] || GATE_TIMEOUT=300
CAMPAIGN_DEADLINE="$(node "$SCRIPT_DIR/quality-invocation.js" \
  field "$MANIFEST" governor.campaignDeadlineEpoch)" || exit 1
if [ -n "$CAMPAIGN_DEADLINE" ]; then
  CAMPAIGN_REMAINING=$((CAMPAIGN_DEADLINE - $(date +%s)))
  [ "$CAMPAIGN_REMAINING" -gt 0 ] || {
    echo "quality-run-gate: campaign budget is exhausted before '$NAME'" >&2
    exit 1
  }
  [ "$GATE_TIMEOUT" -le "$CAMPAIGN_REMAINING" ] ||
    GATE_TIMEOUT="$CAMPAIGN_REMAINING"
fi
bash "$SCRIPT_DIR/quality-run-bounded.sh" --timeout "$GATE_TIMEOUT" -- \
  "$EXECUTABLE" "${COMMAND_ARGS[@]}" >"$LOG" 2>&1 || {
  RC=$?
  cat "$LOG" >&2
  [ "$RC" -eq 124 ] &&
    echo "quality-run-gate: '$NAME' exceeded its proportional ${GATE_TIMEOUT}s budget" >&2
  exit "$RC"
}
bash "$SCRIPT_DIR/quality-assert-clean.sh" \
  --manifest "$MANIFEST" --phase "gate '$NAME' completion" || exit 1
node "$SCRIPT_DIR/quality-invocation.js" gate "$MANIFEST" \
  --name "$NAME" --source "$SOURCE" --command "$COMMAND" --log "$LOG" || exit 1
cat "$LOG"
