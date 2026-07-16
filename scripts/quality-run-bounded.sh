#!/usr/bin/env bash
# Run one provider command in its own process group with a hard wall-clock cap.
set -u
TIMEOUT=""
if [ "${1:-}" = --timeout ]; then TIMEOUT="$2"; shift 2; fi
[ -n "$TIMEOUT" ] && [ "${1:-}" = -- ] || { echo "usage: quality-run-bounded.sh --timeout <seconds> -- <command>" >&2; exit 1; }
shift
MARKER="$(mktemp "${TMPDIR:-/tmp}/quality-timeout.XXXXXX")"
rm -f "$MARKER"
set -m
"$@" &
CHILD_PID=$!
set +m
set -m
(
  sleep "$TIMEOUT"
  : > "$MARKER"
  kill -TERM "-${CHILD_PID}" 2>/dev/null || kill -TERM "$CHILD_PID" 2>/dev/null
  sleep 1
  kill -KILL "-${CHILD_PID}" 2>/dev/null || kill -KILL "$CHILD_PID" 2>/dev/null
) &
WATCHDOG_PID=$!
set +m
cleanup_provider() {
  local status="${1:-130}"
  trap - INT TERM HUP EXIT
  kill -TERM "-${CHILD_PID}" 2>/dev/null || kill -TERM "$CHILD_PID" 2>/dev/null || true
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
