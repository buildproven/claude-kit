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
TRACKED_PIDS_FILE="$(mktemp "${TMPDIR:-/tmp}/quality-provider-pids.XXXXXX")"
rm -f "$TRACKED_PIDS_FILE"
set -m
"$@" &
CHILD_PID=$!
set +m
process_tree_postorder() {
  local pid="$1" child
  # Snapshot descendants before signalling the process group. A native helper
  # can call setsid(2), and would otherwise survive a group kill then become
  # reparented before we can find it with pgrep -P.
  while IFS= read -r child; do
    [ -n "$child" ] || continue
    process_tree_postorder "$child"
  done < <(pgrep -P "$pid" 2>/dev/null || true)
  printf '%s\n' "$pid"
}
track_provider_tree() {
  # A provider can exit while a native helper it spawned is still alive. Once
  # the leader exits that helper is reparented, so a one-shot pgrep at cleanup
  # cannot find it. Snapshot the tree while the leader is alive and retain the
  # exact PIDs for the bounded cleanup path.
  while kill -0 "$CHILD_PID" 2>/dev/null; do
    process_tree_postorder "$CHILD_PID" >> "$TRACKED_PIDS_FILE"
    sleep 0.05
  done
  process_tree_postorder "$CHILD_PID" >> "$TRACKED_PIDS_FILE"
}
track_provider_tree &
TRACKER_PID=$!
stop_tracker() {
  if kill -0 "$CHILD_PID" 2>/dev/null; then
    kill -TERM "$TRACKER_PID" 2>/dev/null || true
  fi
  wait "$TRACKER_PID" 2>/dev/null || true
}
terminate_provider() {
  local targets tracked
  tracked="$(cat "$TRACKED_PIDS_FILE" 2>/dev/null || true)"
  targets="$(printf '%s\n' "$tracked" "$(process_tree_postorder "$CHILD_PID")" |
    awk 'NF && !seen[$1]++ { print $1 }')"
  # Descendants first, then the provider leader. This ordering preserves the
  # PID list long enough to kill escaped session leaders as well.
  [ -z "$targets" ] || kill -TERM $targets 2>/dev/null || true
  sleep 1
  [ -z "$targets" ] || kill -KILL $targets 2>/dev/null || true
  # A normal descendant created after the snapshot remains in this group.
  kill -TERM "-${CHILD_PID}" 2>/dev/null || true
  kill -KILL "-${CHILD_PID}" 2>/dev/null || true
}
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
  terminate_provider
}
watchdog &
WATCHDOG_PID=$!
set +m
stop_watchdog() {
  local targets
  # The timeout marker is written before terminate_provider's one-second TERM
  # grace period. Once it exists, the watchdog owns escalation; stopping it
  # here would cancel the required SIGKILL after the leader exits and leave a
  # session-escaped, TERM-ignoring helper running.
  if [ -f "$MARKER" ]; then
    wait "$WATCHDOG_PID" 2>/dev/null || true
    return
  fi
  # The watchdog is a shell with a sleeping child. Killing only the shell
  # queues its trap until that sleep ends on macOS Bash, turning every fast
  # command into a full timeout wait. Terminate its descendants first.
  targets="$(process_tree_postorder "$WATCHDOG_PID")"
  [ -z "$targets" ] || kill -TERM $targets 2>/dev/null || true
  wait "$WATCHDOG_PID" 2>/dev/null || true
}
cleanup_provider() {
  local status="${1:-130}"
  trap - INT TERM HUP EXIT
  stop_tracker
  terminate_provider
  stop_watchdog
  wait "$CHILD_PID" 2>/dev/null || true
  rm -f "$MARKER"
  rm -f "$TRACKED_PIDS_FILE"
  exit "$status"
}
trap 'cleanup_provider 130' INT
trap 'cleanup_provider 143' TERM
trap 'cleanup_provider 129' HUP
trap 'cleanup_provider $?' EXIT
wait "$CHILD_PID"; RC=$?
stop_tracker
stop_watchdog
terminate_provider
trap - INT TERM HUP EXIT
rm -f "$TRACKED_PIDS_FILE"
if [ -f "$MARKER" ]; then rm -f "$MARKER"; exit 124; fi
rm -f "$MARKER"
exit "$RC"
