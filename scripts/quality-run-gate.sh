#!/usr/bin/env bash
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
MANIFEST=""
NAME=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --manifest) MANIFEST="${2:-}"; shift 2 ;;
    --name) NAME="${2:-}"; shift 2 ;;
    --) shift; break ;;
    *) echo "quality-run-gate: unknown argument '$1'" >&2; exit 1 ;;
  esac
done
[ -n "$MANIFEST" ] && [ -n "$NAME" ] && [ "$#" -gt 0 ] || {
  echo "quality-run-gate: --manifest, --name, and a command are required" >&2
  exit 1
}
ROOT="$(node "$SCRIPT_DIR/quality-invocation.js" locate "$MANIFEST")" || exit 1
STATE_ROOT="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" stateRoot)"
HEAD="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" revisions.currentHead)"
LOG_DIR="$STATE_ROOT/gates/$HEAD"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/$NAME.log"
COMMAND="$(printf '%q ' "$@")"
cd "$ROOT" || exit 1
"$@" >"$LOG" 2>&1 || {
  cat "$LOG" >&2
  exit 1
}
node "$SCRIPT_DIR/quality-invocation.js" gate "$MANIFEST" \
  --name "$NAME" --command "$COMMAND" --log "$LOG" || exit 1
cat "$LOG"
