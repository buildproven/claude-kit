#!/usr/bin/env bash
# Wait for required checks to register, then hand off to gh's check watcher.
set -u

PR=""
INTERVAL=2
while [ "$#" -gt 0 ]; do
  case "$1" in
    --pr) PR="${2:-}"; shift 2 ;;
    --interval) INTERVAL="${2:-}"; shift 2 ;;
    *) echo "quality-wait-required-checks: unknown argument '$1'" >&2; exit 1 ;;
  esac
done
[ -n "$PR" ] || {
  echo "quality-wait-required-checks: --pr is required" >&2
  exit 1
}
case "$INTERVAL" in
  ''|*[!0-9]*)
    echo "quality-wait-required-checks: --interval must be seconds" >&2
    exit 1
    ;;
esac

while true; do
  OUTPUT="$(gh pr checks "$PR" --required 2>&1)"
  RC=$?
  if [ "$RC" -eq 0 ] || [ "$RC" -eq 8 ]; then
    exec gh pr checks "$PR" --required --watch --interval 10
  fi
  case "$OUTPUT" in
    "no checks reported"*)
      echo "[quality] required checks are not registered yet; retrying" >&2
      sleep "$INTERVAL"
      ;;
    "no required checks reported"*)
      # An explicitly unprotectable repository can still have CI even though
      # GitHub reports no branch-rule-required checks. Wait on every registered
      # check in that case; this preserves CI evidence instead of burning the
      # full timeout polling for a required-check set that cannot exist.
      ALL_OUTPUT="$(gh pr checks "$PR" 2>&1)"
      ALL_RC=$?
      case "$ALL_OUTPUT" in
        "no checks reported"*)
          echo "[quality] CI checks are not registered yet; retrying" >&2
          sleep "$INTERVAL"
          ;;
        *)
          if [ "$ALL_RC" -eq 0 ] || [ "$ALL_RC" -eq 1 ] || [ "$ALL_RC" -eq 8 ]; then
            exec gh pr checks "$PR" --watch --interval 10
          fi
          [ -n "$ALL_OUTPUT" ] && printf '%s\n' "$ALL_OUTPUT" >&2
          exit "$ALL_RC"
          ;;
      esac
      ;;
    *)
      [ -n "$OUTPUT" ] && printf '%s\n' "$OUTPUT" >&2
      exit "$RC"
      ;;
  esac
done
