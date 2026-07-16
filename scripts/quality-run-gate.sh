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
if [ "$SKIP" = true ]; then
  node "$SCRIPT_DIR/quality-invocation.js" gate-run "$MANIFEST" \
    --name "$NAME" --skip --reason "$REASON" || exit 1
  cat "$LOG"
  exit 0
fi
node "$SCRIPT_DIR/quality-invocation.js" gate-run "$MANIFEST" \
  --name "$NAME" || exit 1
bash "$SCRIPT_DIR/quality-assert-clean.sh" \
  --manifest "$MANIFEST" --phase "gate '$NAME' completion" || exit 1
