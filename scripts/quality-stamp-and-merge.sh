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
EXPECTED_HEAD_REPOSITORY="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" repo.headRepository)"
LOCAL_HEAD="$(git rev-parse HEAD)"

# Keep the private signer outside every repository.  An explicit environment
# setting wins; the conventional local path makes autonomous quality runs work
# without requiring each shell to source a secret-bearing dotfile.
if [ -z "${QUALITY_REVIEW_EVIDENCE_PRIVATE_KEY:-}" ] && \
  [ -z "${QUALITY_REVIEW_EVIDENCE_PRIVATE_KEY_FILE:-}" ]; then
  DEFAULT_REVIEW_EVIDENCE_KEY="${XDG_CONFIG_HOME:-$HOME/.config}/claude-kit/quality-review-evidence.key"
  if [ -r "$DEFAULT_REVIEW_EVIDENCE_KEY" ]; then
    export QUALITY_REVIEW_EVIDENCE_PRIVATE_KEY_FILE="$DEFAULT_REVIEW_EVIDENCE_KEY"
  fi
fi

HEAD_REMOTE=""
while IFS= read -r REMOTE; do
  [ -n "$REMOTE" ] || continue
  REMOTE_URL="$(git remote get-url --push "$REMOTE")" || exit 1
  REMOTE_REPOSITORY="$(gh repo view "$REMOTE_URL" --json nameWithOwner \
    --jq .nameWithOwner 2>/dev/null || true)"
  [ "$REMOTE_REPOSITORY" = "$EXPECTED_HEAD_REPOSITORY" ] || continue
  [ -z "$HEAD_REMOTE" ] || {
    echo "❌ MERGE BLOCKED: multiple remotes map to PR head repository $EXPECTED_HEAD_REPOSITORY." >&2
    exit 1
  }
  HEAD_REMOTE="$REMOTE"
done < <(git remote)
[ -n "$HEAD_REMOTE" ] || {
  echo "❌ MERGE BLOCKED: no local remote maps to PR head repository $EXPECTED_HEAD_REPOSITORY." >&2
  exit 1
}

# Prove remote identity and server-side merge freshness before creating a stamp
# or pushing anything. A failed authorization prerequisite must be non-mutating.
PREFLIGHT_OUTPUT="$(bash "$SCRIPT_DIR/quality-authorize-merge.sh" \
  --manifest "$MANIFEST" --preflight)"
printf '%s\n' "$PREFLIGHT_OUTPUT"
if printf '%s\n' "$PREFLIGHT_OUTPUT" |
  grep -Fxq 'BS_QUALITY_ALREADY_MERGED=true'; then
  bash "$SCRIPT_DIR/quality-merge-cleanup.sh" --manifest "$MANIFEST"
  exit 0
fi
PREFLIGHT_PR_HEAD="$(printf '%s\n' "$PREFLIGHT_OUTPUT" |
  sed -n 's/^BS_QUALITY_PR_HEAD=//p')"
[ -n "$PREFLIGHT_PR_HEAD" ] || {
  echo "❌ MERGE BLOCKED: authorization preflight omitted PR HEAD identity." >&2
  exit 1
}
PERSISTED_REMOTE="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" merge.stampPublication.remote)"
[ -z "$PERSISTED_REMOTE" ] || [ "$PERSISTED_REMOTE" = "$HEAD_REMOTE" ] || {
  echo "❌ MERGE BLOCKED: persisted stamp remote no longer matches PR head repository." >&2
  exit 1
}

if [ -n "$STAMP_HEAD" ]; then
  [ "$LOCAL_HEAD" = "$STAMP_HEAD" ] || {
    echo "❌ MERGE BLOCKED: persisted quality stamp $STAMP_HEAD is not checked out." >&2
    exit 1
  }
else
  if [ "$LOCAL_HEAD" = "$REVIEWED_HEAD" ]; then
    TRAILERS="$(node "$SCRIPT_DIR/quality-invocation.js" trailers "$MANIFEST")"
    REVIEW_AUTHORIZATION="$(node "$SCRIPT_DIR/quality-invocation.js" review-authorization "$MANIFEST")"
    REVIEW_BASE="$(printf '%s' "$REVIEW_AUTHORIZATION" | jq -er '.base')"
    REVIEW_TIER="$(printf '%s' "$REVIEW_AUTHORIZATION" | jq -er '.tier')"
    REVIEW_PROVIDER="$(printf '%s' "$REVIEW_AUTHORIZATION" | jq -er '.provider')"
    REVIEW_PRIMARY="$(printf '%s' "$REVIEW_AUTHORIZATION" | jq -er '.primary')"
    REVIEW_FALLBACK="$(printf '%s' "$REVIEW_AUTHORIZATION" | jq -er '.fallback')"
    REVIEW_FINDINGS="$(printf '%s' "$REVIEW_AUTHORIZATION" | jq -er '.blockingCount')"
    if { [ "$REVIEW_TIER" = high ] || [ "$REVIEW_TIER" = critical ]; } && \
      [ -z "${QUALITY_REVIEW_EVIDENCE_PRIVATE_KEY:-}" ] && \
      [ -z "${QUALITY_REVIEW_EVIDENCE_PRIVATE_KEY_FILE:-}" ]; then
      echo "❌ MERGE BLOCKED: high/critical review evidence requires a signing key before creating a stamp." >&2
      exit 1
    fi
    if [ -n "${QUALITY_REVIEW_EVIDENCE_PRIVATE_KEY:-}" ] || \
       [ -n "${QUALITY_REVIEW_EVIDENCE_PRIVATE_KEY_FILE:-}" ]; then
      REVIEW_SIGNATURE="$(node "$SCRIPT_DIR/quality-review-evidence.js" sign \
        --head "$REVIEWED_HEAD" --base "$REVIEW_BASE" --tier "$REVIEW_TIER" \
        --findings "$REVIEW_FINDINGS" --reviewer "$REVIEW_PROVIDER" \
        --primary "$REVIEW_PRIMARY" --fallback "$REVIEW_FALLBACK")"
      TRAILERS="$TRAILERS
Quality-Evidence-Signature: $REVIEW_SIGNATURE"
    fi
    # HUSKY=0: this is quality's own empty stamp commit in the target repo. Its
    # husky pre-commit hooks would re-run lint/tests the pipeline just ran —
    # unbounded work outside the campaign governor, on a commit that changes no
    # files. Skip the target repo's hooks here (not --no-verify, per policy;
    # HUSKY=0 disables husky specifically without a blanket hook bypass).
    HUSKY=0 git commit --allow-empty -m "chore: quality review stamp

$TRAILERS"
    LOCAL_HEAD="$(git rev-parse HEAD)"
  fi
  node "$SCRIPT_DIR/quality-invocation.js" record-stamp "$MANIFEST" \
    --head "$LOCAL_HEAD" --remote "$HEAD_REMOTE" \
    --expected-old-head "$PREFLIGHT_PR_HEAD" >/dev/null
  STAMP_HEAD="$LOCAL_HEAD"
fi

[ "$(git rev-parse "${STAMP_HEAD}~1")" = "$REVIEWED_HEAD" ] &&
  git diff --quiet "${STAMP_HEAD}~1" "$STAMP_HEAD" || {
    echo "❌ MERGE BLOCKED: persisted review stamp is not an empty child of reviewed HEAD." >&2
    exit 1
  }

# A stamp persisted by an interrupted/older runner may predate publication
# metadata. Reattach that exact local stamp to the already-verified remote and
# PR head without creating a second commit.
if [ -z "$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" merge.stampPublication.remote)" ]; then
  node "$SCRIPT_DIR/quality-invocation.js" record-stamp "$MANIFEST" \
    --head "$STAMP_HEAD" --remote "$HEAD_REMOTE" \
    --expected-old-head "$PREFLIGHT_PR_HEAD" >/dev/null
fi

[ -n "$PR" ] || { echo "❌ MERGE BLOCKED: manifest has no PR identity." >&2; exit 1; }
[ -n "$EXPECTED_REPOSITORY" ] && [ -n "$EXPECTED_HEAD_REF" ] || {
  echo "❌ MERGE BLOCKED: manifest lacks persisted GitHub repository/head identity." >&2
  exit 1
}
if [ "$PREFLIGHT_PR_HEAD" != "$STAMP_HEAD" ]; then
  git push \
    --force-with-lease="refs/heads/$EXPECTED_HEAD_REF:$PREFLIGHT_PR_HEAD" \
    "$HEAD_REMOTE" "$STAMP_HEAD:refs/heads/$EXPECTED_HEAD_REF"
fi
node "$SCRIPT_DIR/quality-invocation.js" record-stamp-published "$MANIFEST" \
  --head "$STAMP_HEAD" --remote "$HEAD_REMOTE" \
  --previous-head "$PREFLIGHT_PR_HEAD" >/dev/null

# GitHub's PR API can briefly lag a just-completed push (read-after-write
# consistency delay), which produced a false MERGE BLOCKED on this exact
# check twice in one session (BUI-462) even though the push had already
# landed and a manual retry seconds later showed matching SHAs both times.
# Retry a few times with a short backoff before treating a mismatch as real;
# a genuine divergence (someone else pushed to the branch) still fails after
# the retry window exhausts.
PR_HEAD_RETRIES="${QUALITY_STAMP_PR_HEAD_RETRIES:-3}"
PR_HEAD_RETRY_DELAY="${QUALITY_STAMP_PR_HEAD_RETRY_DELAY:-3}"
PR_HEAD=""
PR_HEAD_ERR_FILE="$(mktemp)"
attempt=1
while [ "$attempt" -le "$PR_HEAD_RETRIES" ]; do
  # `gh pr view` failing outright (network blip, auth hiccup, rate limit) is
  # a different flavor of the same transient-flakiness problem this retry
  # loop exists for — under `set -e` an unguarded failure here would abort
  # the whole script on attempt 1 and silently defeat the retry entirely.
  # Tolerate a failed call the same way as a mismatched SHA: log it and retry.
  # Capture stdout and stderr SEPARATELY in ONE call (5 review agents, two
  # rounds): a merged `2>&1` capture corrupts PR_HEAD with benign stderr
  # noise (e.g. a gh update nag) even on success — the exact false-mismatch
  # bug this fix exists to eliminate. A prior version re-ran the command a
  # second time on failure just to get a clean error message, which doubled
  # API calls on exactly the rate-limit path this fix is meant to tolerate;
  # route stderr to a scratch file instead so one call covers both.
  if ! PR_HEAD="$(gh pr view "$PR" --repo "$EXPECTED_REPOSITORY" \
    --json headRefOid --jq .headRefOid 2>"$PR_HEAD_ERR_FILE")"; then
    echo "[quality] gh pr view failed on attempt $attempt/$PR_HEAD_RETRIES: $(cat "$PR_HEAD_ERR_FILE")" >&2
    PR_HEAD=""
  fi
  [ "$PR_HEAD" = "$STAMP_HEAD" ] && break
  if [ "$attempt" -lt "$PR_HEAD_RETRIES" ]; then
    echo "[quality] PR HEAD mismatch on attempt $attempt/$PR_HEAD_RETRIES (got $PR_HEAD, want $STAMP_HEAD) — retrying in ${PR_HEAD_RETRY_DELAY}s, likely GitHub API lag" >&2
    sleep "$PR_HEAD_RETRY_DELAY"
  fi
  attempt=$((attempt + 1))
done
rm -f "$PR_HEAD_ERR_FILE"
[ "$PR_HEAD" = "$STAMP_HEAD" ] || {
  echo "❌ MERGE BLOCKED: pushed PR HEAD does not match persisted stamp $STAMP_HEAD after $PR_HEAD_RETRIES attempts." >&2
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
RC=0
bash "$SCRIPT_DIR/quality-run-bounded.sh" --timeout "$CI_TIMEOUT" -- \
  bash "$SCRIPT_DIR/quality-wait-required-checks.sh" --pr "$PR" || RC=$?
CI_BILLING_WAIVED=false
if [ "$RC" -ne 0 ]; then
  CI_WAIVER_ARTIFACT="$(dirname "$MANIFEST")/ci-billing-waiver.json"
  if node "$SCRIPT_DIR/quality-ci-billing-waiver.js" \
    --repo "$EXPECTED_REPOSITORY" --pr "$PR" --head "$STAMP_HEAD" \
    --artifact "$CI_WAIVER_ARTIFACT"; then
    CI_BILLING_WAIVED=true
    echo "⚠️  [quality] GitHub Actions billing prevented runner allocation; exact-HEAD local gates and review remain authoritative (waiver: $CI_WAIVER_ARTIFACT)." >&2
  else
    if [ "$RC" -eq 124 ]; then
      DETAIL="timed out waiting for CI on stamp $STAMP_HEAD"
    else
      DETAIL="required CI failed on stamp $STAMP_HEAD"
    fi
    echo "❌ MERGE BLOCKED: $DETAIL." >&2
    node "$SCRIPT_DIR/quality-terminal-status.js" \
      --manifest "$MANIFEST" --category github-ci --detail "$DETAIL" || true
    exit 1
  fi
fi
[ "$(gh pr view "$PR" --repo "$EXPECTED_REPOSITORY" \
  --json headRefOid --jq .headRefOid)" = "$STAMP_HEAD" ] || {
  echo "❌ MERGE BLOCKED: PR HEAD changed while waiting for stamp CI." >&2
  exit 1
}
if [ "$CI_BILLING_WAIVED" = true ]; then
  BS_QUALITY_CI_BILLING_WAIVER_ARTIFACT="$CI_WAIVER_ARTIFACT" \
    bash "$SCRIPT_DIR/quality-authorize-merge.sh" --manifest "$MANIFEST"
else
  bash "$SCRIPT_DIR/quality-authorize-merge.sh" --manifest "$MANIFEST"
fi
bash "$SCRIPT_DIR/quality-merge-cleanup.sh" --manifest "$MANIFEST"
