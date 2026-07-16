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
(
  sleep "$TIMEOUT"
  : > "$MARKER"
  kill -TERM "-${CHILD_PID}" 2>/dev/null || kill -TERM "$CHILD_PID" 2>/dev/null
  sleep 1
  kill -KILL "-${CHILD_PID}" 2>/dev/null || kill -KILL "$CHILD_PID" 2>/dev/null
) &
WATCHDOG_PID=$!
wait "$CHILD_PID"; RC=$?
kill "$WATCHDOG_PID" 2>/dev/null || true
wait "$WATCHDOG_PID" 2>/dev/null || true
if [ -f "$MARKER" ]; then rm -f "$MARKER"; exit 124; fi
exit "$RC"
