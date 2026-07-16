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
bash "$SCRIPT_DIR/quality-assert-clean.sh" \
  --manifest "$MANIFEST" --phase "quality stamp" || exit 1
node "$SCRIPT_DIR/quality-invocation.js" review-authorization "$MANIFEST" >/dev/null
REVIEWED_HEAD="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" revisions.currentHead)"
STAMP_HEAD="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" merge.stampHead)"
PR="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" repo.pr)"
EXPECTED_REPOSITORY="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" repo.githubRepository)"
EXPECTED_HEAD_REF="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" repo.headRefName)"
LOCAL_HEAD="$(git rev-parse HEAD)"

# Prove remote identity and server-side merge freshness before creating a stamp
# or pushing anything. A failed authorization prerequisite must be non-mutating.
PREFLIGHT_OUTPUT="$(bash "$SCRIPT_DIR/quality-authorize-merge.sh" \
  --manifest "$MANIFEST" --preflight)"
printf '%s\n' "$PREFLIGHT_OUTPUT"
if printf '%s\n' "$PREFLIGHT_OUTPUT" |
  grep -Fxq 'BS_QUALITY_ALREADY_MERGED=true'; then
  bash "$SCRIPT_DIR/quality-merge-cleanup.sh" --preserve-branch
  exit 0
fi

if [ -n "$STAMP_HEAD" ]; then
  [ "$LOCAL_HEAD" = "$STAMP_HEAD" ] || {
    echo "❌ MERGE BLOCKED: persisted quality stamp $STAMP_HEAD is not checked out." >&2
    exit 1
  }
else
  if [ "$LOCAL_HEAD" = "$REVIEWED_HEAD" ]; then
    TRAILERS="$(node "$SCRIPT_DIR/quality-invocation.js" trailers "$MANIFEST")"
    git commit --allow-empty -m "chore: quality review stamp

$TRAILERS"
    LOCAL_HEAD="$(git rev-parse HEAD)"
  fi
  node "$SCRIPT_DIR/quality-invocation.js" record-stamp "$MANIFEST" \
    --head "$LOCAL_HEAD" >/dev/null
  STAMP_HEAD="$LOCAL_HEAD"
fi

[ "$(git rev-parse "${STAMP_HEAD}~1")" = "$REVIEWED_HEAD" ] &&
  git diff --quiet "${STAMP_HEAD}~1" "$STAMP_HEAD" || {
    echo "❌ MERGE BLOCKED: persisted review stamp is not an empty child of reviewed HEAD." >&2
    exit 1
  }

[ -n "$PR" ] || { echo "❌ MERGE BLOCKED: manifest has no PR identity." >&2; exit 1; }
[ -n "$EXPECTED_REPOSITORY" ] && [ -n "$EXPECTED_HEAD_REF" ] || {
  echo "❌ MERGE BLOCKED: manifest lacks persisted GitHub repository/head identity." >&2
  exit 1
}
git push origin "$STAMP_HEAD:refs/heads/$EXPECTED_HEAD_REF"

PR_HEAD="$(gh pr view "$PR" --repo "$EXPECTED_REPOSITORY" \
  --json headRefOid --jq .headRefOid)"
[ "$PR_HEAD" = "$STAMP_HEAD" ] || {
  echo "❌ MERGE BLOCKED: pushed PR HEAD does not match persisted stamp $STAMP_HEAD." >&2
  exit 1
}
CI_TIMEOUT="${QUALITY_STAMP_CI_TIMEOUT:-900}"
case "$CI_TIMEOUT" in
  ''|*[!0-9]*) echo "❌ MERGE BLOCKED: QUALITY_STAMP_CI_TIMEOUT must be seconds." >&2; exit 1 ;;
esac
[ "$CI_TIMEOUT" -gt 0 ] || {
  echo "❌ MERGE BLOCKED: QUALITY_STAMP_CI_TIMEOUT must be positive." >&2
  exit 1
}
echo "[quality] waiting up to ${CI_TIMEOUT}s for required CI on stamp $STAMP_HEAD"
bash "$SCRIPT_DIR/quality-run-bounded.sh" --timeout "$CI_TIMEOUT" -- \
  bash "$SCRIPT_DIR/quality-wait-required-checks.sh" --pr "$PR" || {
    RC=$?
    [ "$RC" -eq 124 ] &&
      echo "❌ MERGE BLOCKED: timed out waiting for CI on stamp $STAMP_HEAD." >&2
    [ "$RC" -ne 124 ] &&
      echo "❌ MERGE BLOCKED: required CI failed on stamp $STAMP_HEAD." >&2
    exit 1
  }
[ "$(gh pr view "$PR" --repo "$EXPECTED_REPOSITORY" \
  --json headRefOid --jq .headRefOid)" = "$STAMP_HEAD" ] || {
  echo "❌ MERGE BLOCKED: PR HEAD changed while waiting for stamp CI." >&2
  exit 1
}
bash "$SCRIPT_DIR/quality-authorize-merge.sh" --manifest "$MANIFEST"
bash "$SCRIPT_DIR/quality-merge-cleanup.sh" --preserve-branch
