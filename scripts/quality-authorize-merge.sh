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
MERGE_REQUESTED="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" options.merge)"
[ "$MERGE_REQUESTED" = true ] || {
  echo "❌ MERGE BLOCKED: invocation was created without --merge." >&2
  exit 1
}
PR="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" repo.pr)"
EXPECTED_HEAD="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" revisions.currentHead)"
ROOT="$(node "$SCRIPT_DIR/quality-invocation.js" locate "$MANIFEST")" || exit 1
cd "$ROOT" || exit 1
bash "$SCRIPT_DIR/quality-assert-clean.sh" \
  --manifest "$MANIFEST" --phase "merge authorization" || exit 1
[ -n "$PR" ] || { echo "❌ MERGE BLOCKED: manifest has no PR identity." >&2; exit 1; }
PR_JSON="$(gh pr view "$PR" --json headRefOid,baseRefName)" || exit 1
ACTUAL_HEAD="$(printf '%s' "$PR_JSON" | jq -r '.headRefOid')"
ACTUAL_BASE_NAME="$(printf '%s' "$PR_JSON" | jq -r '.baseRefName')"
ACTUAL_BASE_OID="$(git ls-remote origin "refs/heads/$ACTUAL_BASE_NAME" | awk '{print $1}')"
EXPECTED_BASE_REF="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" revisions.baseRef)"
EXPECTED_BASE_OID="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" revisions.baseHeadSha)"
[ "$EXPECTED_BASE_REF" = "origin/$ACTUAL_BASE_NAME" ] &&
  [ "$EXPECTED_BASE_OID" = "$ACTUAL_BASE_OID" ] || {
    echo "❌ MERGE BLOCKED: PR base changed after review." >&2
    exit 1
  }
LOCAL_HEAD="$(git rev-parse HEAD)"
[ "$ACTUAL_HEAD" = "$LOCAL_HEAD" ] || {
  echo "❌ MERGE BLOCKED: PR HEAD does not match reviewed HEAD." >&2
  exit 1
}
STAMP_HEAD="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" merge.stampHead)"
[ -n "$STAMP_HEAD" ] && [ "$LOCAL_HEAD" = "$STAMP_HEAD" ] &&
  [ "$(git rev-parse HEAD~1)" = "$EXPECTED_HEAD" ] &&
  git diff --quiet HEAD~1 HEAD || {
    echo "❌ MERGE BLOCKED: PR HEAD is not the persisted empty stamp of reviewed HEAD." >&2
    exit 1
  }
gh pr checks "$PR" --required >/dev/null || {
  echo "❌ MERGE BLOCKED: required CI is not successful." >&2
  exit 1
}
git merge-base --is-ancestor "$EXPECTED_BASE_OID" "$EXPECTED_HEAD" || {
  echo "❌ MERGE BLOCKED: reviewed branch is not up to date with the PR base." >&2
  exit 1
}
REPOSITORY="$(gh repo view --json nameWithOwner --jq .nameWithOwner)" || exit 1
ATOMIC_BASE_FRESHNESS=false
ENCODED_BASE_NAME="$(jq -rn --arg value "$ACTUAL_BASE_NAME" '$value | @uri')" || exit 1
if [ "$(gh api "repos/$REPOSITORY/branches/$ENCODED_BASE_NAME/protection/required_status_checks" \
  --jq '.strict' 2>/dev/null || true)" = true ]; then
  ATOMIC_BASE_FRESHNESS=true
fi
# GitHub evaluates ruleset include/exclude patterns for this concrete branch.
# Do not duplicate fnmatch semantics locally: exclusions, nested wildcards,
# organization rulesets, and future pattern syntax must remain server-owned.
# If this endpoint is unavailable, rulesets provide no authorization and the
# classic strict-protection check above is the only accepted guarantee.
if EFFECTIVE_RULES="$(gh api \
  "repos/$REPOSITORY/rules/branches/$ENCODED_BASE_NAME" 2>/dev/null)"; then
  if printf '%s' "$EFFECTIVE_RULES" |
    jq -e 'any(.[]?; .type == "merge_queue")' >/dev/null; then
    echo "❌ MERGE BLOCKED: merge-queue branches require a queue-aware monitored merge path." >&2
    exit 1
  fi
  if printf '%s' "$EFFECTIVE_RULES" |
    jq -e '
      any(.[]?;
        .type == "required_status_checks" and
        .parameters.strict_required_status_checks_policy == true
      )
    ' >/dev/null; then
    ATOMIC_BASE_FRESHNESS=true
  fi
fi
[ "$ATOMIC_BASE_FRESHNESS" = true ] || {
  echo "❌ MERGE BLOCKED: the PR base lacks server-enforced strict freshness." >&2
  echo "   Enable strict required-status checks or use a supported merge queue." >&2
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
FINAL_PR_JSON="$(gh pr view "$PR" --json headRefOid,baseRefName)" || exit 1
[ "$(printf '%s' "$FINAL_PR_JSON" | jq -r '.baseRefName')" = "$ACTUAL_BASE_NAME" ] || {
  echo "❌ MERGE BLOCKED: PR target branch changed immediately before merge." >&2
  exit 1
}
FINAL_BASE_OID="$(git ls-remote origin "refs/heads/$ACTUAL_BASE_NAME" | awk '{print $1}')"
[ "$(printf '%s' "$FINAL_PR_JSON" | jq -r '.headRefOid')" = "$ACTUAL_HEAD" ] &&
  [ "$FINAL_BASE_OID" = "$EXPECTED_BASE_OID" ] || {
    echo "❌ MERGE BLOCKED: PR identity changed immediately before merge." >&2
    exit 1
  }
gh pr merge "$PR" --squash --match-head-commit "$ACTUAL_HEAD" || {
  echo "❌ MERGE BLOCKED: GitHub rejected the exact-head merge." >&2
  exit 1
}
MERGED_JSON="$(gh pr view "$PR" --json state,mergedAt,mergeCommit)" || exit 1
if ! { [ "$(printf '%s' "$MERGED_JSON" | jq -r '.state')" = MERGED ] &&
  [ "$(printf '%s' "$MERGED_JSON" | jq -r '.mergedAt // empty')" != "" ] &&
  [ "$(printf '%s' "$MERGED_JSON" | jq -r '.mergeCommit.oid // empty')" != "" ]; }; then
  echo "❌ MERGE BLOCKED: GitHub did not complete the exact-head merge synchronously." >&2
  exit 1
fi
echo "[quality] merged exact reviewed revision $ACTUAL_HEAD"
