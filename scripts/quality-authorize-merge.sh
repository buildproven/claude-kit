#!/usr/bin/env bash
# Executable final merge authorization gate. This script authorizes; it does
# not push or merge.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
MANIFEST=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --manifest) MANIFEST="${2:-}"; shift 2 ;;
    *) echo "quality-authorize-merge: unknown argument '$1'" >&2; exit 1 ;;
  esac
done
[ -n "$MANIFEST" ] || {
  echo "quality-authorize-merge: --manifest is required" >&2
  exit 1
}

node "$SCRIPT_DIR/quality-invocation.js" review-authorization "$MANIFEST" >/dev/null || exit 1
PR="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" repo.pr)"
EXPECTED_HEAD="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" revisions.currentHead)"
ROOT="$(node "$SCRIPT_DIR/quality-invocation.js" locate "$MANIFEST")" || exit 1
[ -n "$PR" ] || { echo "❌ MERGE BLOCKED: manifest has no PR identity." >&2; exit 1; }
ACTUAL_HEAD="$(gh pr view "$PR" --json headRefOid --jq .headRefOid)" || exit 1
LOCAL_HEAD="$(git -C "$ROOT" rev-parse HEAD)"
[ "$ACTUAL_HEAD" = "$LOCAL_HEAD" ] || {
  echo "❌ MERGE BLOCKED: PR HEAD does not match reviewed HEAD." >&2
  exit 1
}
if [ "$LOCAL_HEAD" != "$EXPECTED_HEAD" ]; then
  [ "$(git -C "$ROOT" rev-parse HEAD~1)" = "$EXPECTED_HEAD" ] &&
    git -C "$ROOT" diff --quiet HEAD~1 HEAD || {
      echo "❌ MERGE BLOCKED: PR HEAD is not an empty stamp of reviewed HEAD." >&2
      exit 1
    }
fi
gh pr checks "$PR" --required >/dev/null || {
  echo "❌ MERGE BLOCKED: required CI is not successful." >&2
  exit 1
}
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
