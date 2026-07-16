#!/usr/bin/env bash
# Executable final merge authorization gate. This script authorizes; it does
# not push or merge.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
MANIFEST=""
BLOCKING_COUNT=""
CI_STATUS=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --manifest) MANIFEST="${2:-}"; shift 2 ;;
    --blocking-count) BLOCKING_COUNT="${2:-}"; shift 2 ;;
    --ci-status) CI_STATUS="${2:-}"; shift 2 ;;
    *) echo "quality-authorize-merge: unknown argument '$1'" >&2; exit 1 ;;
  esac
done
[ -n "$MANIFEST" ] && [ -n "$BLOCKING_COUNT" ] && [ -n "$CI_STATUS" ] || {
  echo "quality-authorize-merge: --manifest, --blocking-count, and --ci-status are required" >&2
  exit 1
}
[ "$BLOCKING_COUNT" -eq 0 ] 2>/dev/null || {
  echo "❌ MERGE BLOCKED: $BLOCKING_COUNT unresolved BLOCKING finding(s)." >&2
  exit 1
}
[ "$CI_STATUS" = success ] || {
  echo "❌ MERGE BLOCKED: required CI is not successful ($CI_STATUS)." >&2
  exit 1
}

node "$SCRIPT_DIR/quality-invocation.js" review-authorization "$MANIFEST" >/dev/null || exit 1
TIER="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" risk.tier)"
if [ "$TIER" = critical ]; then
  node "$SCRIPT_DIR/quality-invocation.js" approval-valid "$MANIFEST" || {
    echo "❌ MERGE BLOCKED: critical break-glass approval is missing or stale." >&2
    exit 1
  }
fi
BASE_REF="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" revisions.baseRef)"
bash "$SCRIPT_DIR/quality-validate-review-trailers.sh" \
  --manifest "$MANIFEST" --base "$BASE_REF" || exit 1
echo "[quality] merge authorized for exact reviewed revision"
