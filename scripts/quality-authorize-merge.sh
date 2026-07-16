#!/usr/bin/env bash
# Executable final merge authorization gate. This script authorizes; it does
# not push or merge.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
MANIFEST=""
PREFLIGHT=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --manifest) MANIFEST="${2:-}"; shift 2 ;;
    --preflight) PREFLIGHT=true; shift ;;
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
EXPECTED_REPOSITORY="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" repo.githubRepository)"
EXPECTED_HEAD_REF="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" repo.headRefName)"
STAMP_HEAD="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" merge.stampHead)"
STAMP_PUBLICATION="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" merge.stampPublication.status)"
ROOT="$(node "$SCRIPT_DIR/quality-invocation.js" locate "$MANIFEST")" || exit 1
cd "$ROOT" || exit 1
bash "$SCRIPT_DIR/quality-assert-clean.sh" \
  --manifest "$MANIFEST" --phase "merge authorization" || exit 1
[ -n "$PR" ] || { echo "❌ MERGE BLOCKED: manifest has no PR identity." >&2; exit 1; }
[ -n "$EXPECTED_REPOSITORY" ] && [ -n "$EXPECTED_HEAD_REF" ] || {
  echo "❌ MERGE BLOCKED: manifest lacks persisted GitHub repository/head identity." >&2
  exit 1
}
ACTUAL_REPOSITORY="$(gh repo view --json nameWithOwner --jq .nameWithOwner)" || exit 1
[ "$ACTUAL_REPOSITORY" = "$EXPECTED_REPOSITORY" ] || {
  echo "❌ MERGE BLOCKED: GitHub repository identity changed." >&2
  exit 1
}
PR_JSON="$(gh pr view "$PR" --repo "$EXPECTED_REPOSITORY" \
  --json state,mergedAt,mergeCommit,headRefName,headRefOid,baseRefName)" || exit 1
ACTUAL_STATE="$(printf '%s' "$PR_JSON" | jq -r '.state')"
ACTUAL_HEAD="$(printf '%s' "$PR_JSON" | jq -r '.headRefOid')"
ACTUAL_HEAD_REF="$(printf '%s' "$PR_JSON" | jq -r '.headRefName')"
ACTUAL_BASE_NAME="$(printf '%s' "$PR_JSON" | jq -r '.baseRefName')"
[ "$ACTUAL_HEAD_REF" = "$EXPECTED_HEAD_REF" ] || {
  echo "❌ MERGE BLOCKED: PR head branch identity changed." >&2
  exit 1
}
if [ "$ACTUAL_STATE" = MERGED ]; then
  [ -n "$STAMP_HEAD" ] && [ "$ACTUAL_HEAD" = "$STAMP_HEAD" ] &&
    [ "$(printf '%s' "$PR_JSON" | jq -r '.mergedAt // empty')" != "" ] &&
    [ "$(printf '%s' "$PR_JSON" | jq -r '.mergeCommit.oid // empty')" != "" ] || {
      echo "❌ MERGE BLOCKED: merged PR does not match the persisted expected head." >&2
      exit 1
  }
  echo "[quality] PR already merged at exact persisted stamp $STAMP_HEAD"
  [ "$PREFLIGHT" = false ] || echo "BS_QUALITY_ALREADY_MERGED=true"
  exit 0
fi
[ "$ACTUAL_STATE" = OPEN ] || {
  echo "❌ MERGE BLOCKED: PR is not open or safely merged (state=$ACTUAL_STATE)." >&2
  exit 1
}
ACTUAL_BASE_OID="$(git ls-remote origin "refs/heads/$ACTUAL_BASE_NAME" | awk '{print $1}')"
EXPECTED_BASE_REF="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" revisions.baseRef)"
EXPECTED_BASE_OID="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" revisions.baseHeadSha)"
[ "$EXPECTED_BASE_REF" = "origin/$ACTUAL_BASE_NAME" ] &&
  [ "$EXPECTED_BASE_OID" = "$ACTUAL_BASE_OID" ] || {
    echo "❌ MERGE BLOCKED: PR base changed after review." >&2
    exit 1
  }
LOCAL_HEAD="$(git rev-parse HEAD)"
if [ "$PREFLIGHT" = true ]; then
  if [ -n "$STAMP_HEAD" ]; then
    [ "$LOCAL_HEAD" = "$STAMP_HEAD" ] || {
      echo "❌ MERGE BLOCKED: persisted local stamp is not checked out." >&2
      exit 1
    }
    if [ "$STAMP_PUBLICATION" = published ]; then
      [ "$ACTUAL_HEAD" = "$STAMP_HEAD" ] || {
        echo "❌ MERGE BLOCKED: published stamp no longer matches PR HEAD." >&2
        exit 1
      }
    else
      { [ "$ACTUAL_HEAD" = "$EXPECTED_HEAD" ] || [ "$ACTUAL_HEAD" = "$STAMP_HEAD" ]; } || {
        echo "❌ MERGE BLOCKED: local stamp is orphaned from the expected PR revision." >&2
        exit 1
      }
    fi
  else
    [ "$LOCAL_HEAD" = "$EXPECTED_HEAD" ] && [ "$ACTUAL_HEAD" = "$EXPECTED_HEAD" ] || {
      echo "❌ MERGE BLOCKED: preflight HEAD does not match the reviewed PR head." >&2
      exit 1
    }
  fi
  echo "BS_QUALITY_PR_HEAD=$ACTUAL_HEAD"
else
  [ "$ACTUAL_HEAD" = "$LOCAL_HEAD" ] || {
    echo "❌ MERGE BLOCKED: PR HEAD does not match reviewed HEAD." >&2
    exit 1
  }
  [ -n "$STAMP_HEAD" ] && [ "$LOCAL_HEAD" = "$STAMP_HEAD" ] &&
    [ "$(git rev-parse HEAD~1)" = "$EXPECTED_HEAD" ] &&
    git diff --quiet HEAD~1 HEAD || {
      echo "❌ MERGE BLOCKED: PR HEAD is not the persisted empty stamp of reviewed HEAD." >&2
      exit 1
    }
  gh pr checks "$PR" --repo "$EXPECTED_REPOSITORY" --required >/dev/null || {
    echo "❌ MERGE BLOCKED: required CI is not successful." >&2
    exit 1
  }
fi
git merge-base --is-ancestor "$EXPECTED_BASE_OID" "$EXPECTED_HEAD" || {
  echo "❌ MERGE BLOCKED: reviewed branch is not up to date with the PR base." >&2
  exit 1
}
REPOSITORY="$EXPECTED_REPOSITORY"
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
if [ "$ATOMIC_BASE_FRESHNESS" = true ]; then
  echo "[quality] merge freshness: server-enforced strict checks"
else
  # Solo-owned repositories commonly have required CI without strict branch
  # protection. Keep the same exact-head, exact-base, successful-CI checks and
  # repeat both identities immediately before `gh pr merge`. GitHub's
  # --match-head-commit closes the head race; a base race is detected by the
  # final ls-remote comparison below. This is guarded direct mode, not an
  # excuse to skip freshness validation.
  echo "⚠️  [quality] merge freshness: guarded direct mode (strict branch protection is not enabled)." >&2
fi
[ "$PREFLIGHT" = false ] || {
  echo "[quality] non-mutating merge authorization preflight passed"
  exit 0
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
FINAL_PR_JSON="$(gh pr view "$PR" --repo "$EXPECTED_REPOSITORY" \
  --json headRefName,headRefOid,baseRefName)" || exit 1
[ "$(printf '%s' "$FINAL_PR_JSON" | jq -r '.headRefName')" = "$EXPECTED_HEAD_REF" ] || {
  echo "❌ MERGE BLOCKED: PR head branch changed immediately before merge." >&2
  exit 1
}
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
MERGE_RC=0
gh pr merge "$PR" --repo "$EXPECTED_REPOSITORY" --squash \
  --match-head-commit "$ACTUAL_HEAD" || MERGE_RC=$?
MERGED_JSON="$(gh pr view "$PR" --repo "$EXPECTED_REPOSITORY" \
  --json state,mergedAt,mergeCommit,headRefName,headRefOid)" || exit 1
if { [ "$(printf '%s' "$MERGED_JSON" | jq -r '.state')" = MERGED ] &&
  [ "$(printf '%s' "$MERGED_JSON" | jq -r '.mergedAt // empty')" != "" ] &&
  [ "$(printf '%s' "$MERGED_JSON" | jq -r '.mergeCommit.oid // empty')" != "" ] &&
  [ "$(printf '%s' "$MERGED_JSON" | jq -r '.headRefName')" = "$EXPECTED_HEAD_REF" ] &&
  [ "$(printf '%s' "$MERGED_JSON" | jq -r '.headRefOid')" = "$ACTUAL_HEAD" ]; }; then
  echo "[quality] merged exact reviewed revision $ACTUAL_HEAD"
  exit 0
fi
if [ "$MERGE_RC" -ne 0 ]; then
  echo "❌ MERGE BLOCKED: GitHub rejected the exact-head merge and the PR is not merged at that head." >&2
else
  echo "❌ MERGE BLOCKED: GitHub did not complete the exact-head merge synchronously." >&2
fi
exit 1
