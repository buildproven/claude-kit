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
    "no checks reported"*|"no required checks reported"*)
      echo "[quality] required checks are not registered yet; retrying" >&2
      sleep "$INTERVAL"
      ;;
    *)
      [ -n "$OUTPUT" ] && printf '%s\n' "$OUTPUT" >&2
      exit "$RC"
      ;;
  esac
done
