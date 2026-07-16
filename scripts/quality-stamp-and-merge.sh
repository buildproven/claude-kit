#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
MANIFEST=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --manifest) MANIFEST="${2:-}"; shift 2 ;;
    *) echo "quality-stamp-and-merge: unknown argument '$1'" >&2; exit 1 ;;
  esac
done
[ -n "$MANIFEST" ] || { echo "quality-stamp-and-merge: --manifest is required" >&2; exit 1; }
ROOT="$(node "$SCRIPT_DIR/quality-invocation.js" locate "$MANIFEST")"
cd "$ROOT"
git diff --cached --quiet || {
  echo "❌ MERGE BLOCKED: index contains unreviewed staged changes." >&2
  exit 1
}
node "$SCRIPT_DIR/quality-invocation.js" review-authorization "$MANIFEST" >/dev/null
TRAILERS="$(node "$SCRIPT_DIR/quality-invocation.js" trailers "$MANIFEST")"
git commit --allow-empty -m "chore: quality review stamp

$TRAILERS"
git diff --quiet HEAD~1 HEAD || {
  echo "❌ MERGE BLOCKED: review stamp changed the tree." >&2
  exit 1
}
git push
bash "$SCRIPT_DIR/quality-authorize-merge.sh" --manifest "$MANIFEST"
bash "$SCRIPT_DIR/quality-merge-cleanup.sh" --preserve-branch
