#!/usr/bin/env bash
# Run one provider command in its own process group with a hard wall-clock cap.
set -u
TIMEOUT=""
GOVERNOR_FILE=""
CAP=""
RESERVE=0
while [ "$#" -gt 0 ]; do
  case "${1:-}" in
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --governor) GOVERNOR_FILE="$2"; shift 2 ;;
    --cap) CAP="$2"; shift 2 ;;
    --reserve) RESERVE="$2"; shift 2 ;;
    --) break ;;
    *) break ;;
  esac
done
if [ -n "$GOVERNOR_FILE" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  GOVERNOR="$SCRIPT_DIR/quality-run-governor.js"
  [ -f "$GOVERNOR" ] || {
    echo "quality-run-bounded: governor script missing" >&2
    exit 1
  }
  EFFECTIVE_CAP="${CAP:-${TIMEOUT:-2147483647}}"
  TIMEOUT="$(node "$GOVERNOR" remaining "$GOVERNOR_FILE" \
    --reserve "$RESERVE" --cap "$EFFECTIVE_CAP")"
  GOVERNOR_RC=$?
  case "$GOVERNOR_RC" in
    0) ;;
    1) exit 124 ;; # Valid governor, but no budget remains.
    *)
      echo "quality-run-bounded: governor state is unreadable or invalid" >&2
      exit "$GOVERNOR_RC"
      ;;
  esac
fi
[ -n "$TIMEOUT" ] && [ "${1:-}" = -- ] || { echo "usage: quality-run-bounded.sh --timeout <seconds> -- <command>" >&2; exit 1; }
shift
MARKER="$(mktemp "${TMPDIR:-/tmp}/quality-timeout.XXXXXX")"
rm -f "$MARKER"
set -m
"$@" &
CHILD_PID=$!
set +m
set -m
watchdog() {
  local sleeper=""
  stop_watchdog() {
    [ -z "$sleeper" ] || kill -TERM "$sleeper" 2>/dev/null || true
    [ -z "$sleeper" ] || wait "$sleeper" 2>/dev/null || true
    exit 0
  }
  trap stop_watchdog INT TERM HUP
  sleep "$TIMEOUT" &
  sleeper=$!
  wait "$sleeper" || exit 0
  : > "$MARKER"
  kill -TERM "-${CHILD_PID}" 2>/dev/null || kill -TERM "$CHILD_PID" 2>/dev/null
  sleep 1
  kill -KILL "-${CHILD_PID}" 2>/dev/null || kill -KILL "$CHILD_PID" 2>/dev/null
}
watchdog &
WATCHDOG_PID=$!
set +m
cleanup_provider() {
  local status="${1:-130}"
  trap - INT TERM HUP EXIT
  kill -TERM "-${CHILD_PID}" 2>/dev/null || kill -TERM "$CHILD_PID" 2>/dev/null || true
  sleep 1
  kill -KILL "-${CHILD_PID}" 2>/dev/null || kill -KILL "$CHILD_PID" 2>/dev/null || true
  kill -TERM "-${WATCHDOG_PID}" 2>/dev/null || kill "$WATCHDOG_PID" 2>/dev/null || true
  wait "$CHILD_PID" 2>/dev/null || true
  wait "$WATCHDOG_PID" 2>/dev/null || true
  rm -f "$MARKER"
  exit "$status"
}
trap 'cleanup_provider 130' INT
trap 'cleanup_provider 143' TERM
trap 'cleanup_provider 129' HUP
trap 'cleanup_provider $?' EXIT
wait "$CHILD_PID"; RC=$?
kill -TERM "-${WATCHDOG_PID}" 2>/dev/null || kill "$WATCHDOG_PID" 2>/dev/null || true
wait "$WATCHDOG_PID" 2>/dev/null || true
trap - INT TERM HUP EXIT
if [ -f "$MARKER" ]; then rm -f "$MARKER"; exit 124; fi
exit "$RC"
