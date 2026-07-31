#!/usr/bin/env bash
# Validate that HEAD carries internally consistent, revision-bound evidence.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
BASE_REF=origin/main
MANIFEST=""
REQUIRED_TIER=""
REQUIRE_SIGNATURE=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --manifest) MANIFEST="${2:-}"; shift 2 ;;
    --base) BASE_REF="${2:-}"; shift 2 ;;
    --required-tier) REQUIRED_TIER="${2:-}"; shift 2 ;;
    --require-signature) REQUIRE_SIGNATURE=true; shift ;;
    *) BASE_REF="$1"; shift ;;
  esac
done
AUTHORIZATION=""
if [ -n "$MANIFEST" ]; then
  AUTHORIZATION="$(node "$SCRIPT_DIR/quality-invocation.js" review-authorization "$MANIFEST")" || exit 1
  AUTH_HEAD="$(printf '%s' "$AUTHORIZATION" | jq -r '.head')"
  AUTH_BASE="$(printf '%s' "$AUTHORIZATION" | jq -r '.base')"
  AUTH_PROVIDER="$(printf '%s' "$AUTHORIZATION" | jq -r '.provider')"
  AUTH_PRIMARY="$(printf '%s' "$AUTHORIZATION" | jq -r '.primary')"
  AUTH_FALLBACK="$(printf '%s' "$AUTHORIZATION" | jq -r '.fallback')"
  AUTH_FINDINGS="$(printf '%s' "$AUTHORIZATION" | jq -r '.blockingCount')"
  AUTH_TIER="$(printf '%s' "$AUTHORIZATION" | jq -r '.tier')"
fi

PARSED="$(git log -1 --format=%B | git interpret-trailers --parse 2>/dev/null)"
QUALITY_TRAILER="$(printf '%s\n' "$PARSED" | grep -E '^Reviewed-By: quality( |$)' | head -1)"
[ -n "$QUALITY_TRAILER" ] || { echo "quality trailer missing on HEAD" >&2; exit 1; }
for key in Quality-Tier Quality-Reviewer Quality-Primary Quality-Fallback Quality-Findings Quality-Head Quality-Base; do
  [ "$(printf '%s\n' "$PARSED" | grep -c "^${key}: ")" -eq 1 ] || {
    echo "quality trailer ${key} is missing or duplicated" >&2
    exit 1
  }
done

STAMP_HEAD="$(printf '%s\n' "$PARSED" | sed -n 's/^Quality-Head: //p' | head -1)"
STAMP_BASE="$(printf '%s\n' "$PARSED" | sed -n 's/^Quality-Base: //p' | head -1)"
STAMP_PROVIDER="$(printf '%s\n' "$PARSED" | sed -n 's/^Quality-Reviewer: //p' | head -1)"
STAMP_TIER="$(printf '%s\n' "$PARSED" | sed -n 's/^Quality-Tier: //p' | head -1)"
STAMP_FINDINGS="$(printf '%s\n' "$PARSED" | sed -n 's/^Quality-Findings: //p' | head -1)"
STAMP_PRIMARY="$(printf '%s\n' "$PARSED" | sed -n 's/^Quality-Primary: //p' | head -1)"
STAMP_FALLBACK="$(printf '%s\n' "$PARSED" | sed -n 's/^Quality-Fallback: //p' | head -1)"
STAMP_SIGNATURE="$(printf '%s\n' "$PARSED" | sed -n 's/^Quality-Evidence-Signature: //p' | head -1)"
CURRENT_HEAD="$(git rev-parse HEAD)"
CURRENT_PARENT="$(git rev-parse HEAD~1 2>/dev/null || true)"
CURRENT_BASE="$(git merge-base HEAD "$BASE_REF")"

if { [ "$STAMP_HEAD" != "$CURRENT_HEAD" ] && [ "$STAMP_HEAD" != "$CURRENT_PARENT" ]; } \
   || [ "$STAMP_BASE" != "$CURRENT_BASE" ] || [ -z "$STAMP_PROVIDER" ] \
   || [ -z "$STAMP_TIER" ] || [ -z "$STAMP_FINDINGS" ]; then
  echo "quality trailer is stale or malformed" >&2
  exit 1
fi
if [ -n "$AUTHORIZATION" ] && {
  [ "$STAMP_HEAD" != "$AUTH_HEAD" ] || [ "$STAMP_BASE" != "$AUTH_BASE" ] ||
  [ "$STAMP_PROVIDER" != "$AUTH_PROVIDER" ] ||
  [ "$STAMP_PRIMARY" != "$AUTH_PRIMARY" ] ||
  [ "$STAMP_FALLBACK" != "$AUTH_FALLBACK" ] ||
  [ "$STAMP_FINDINGS" != "$AUTH_FINDINGS" ] ||
  [ "$STAMP_TIER" != "$AUTH_TIER" ]
}; then
  echo "quality trailer does not match manifest authorization" >&2
  exit 1
fi
if [ "$STAMP_HEAD" = "$CURRENT_PARENT" ] && ! git diff --quiet HEAD~1 HEAD; then
  echo "stamp commit changes the reviewed tree" >&2
  exit 1
fi

EXPECTED="Reviewed-By: ${STAMP_PROVIDER}"
printf '%s\n' "$PARSED" | grep -Fxq "$EXPECTED" || {
  echo "provider trailer does not exactly match quality authorization" >&2
  exit 1
}

if [ "$REQUIRE_SIGNATURE" = true ]; then
  [ -n "$STAMP_SIGNATURE" ] || {
    echo "quality evidence signature is missing" >&2
    exit 1
  }
  [ -n "${QUALITY_REVIEW_EVIDENCE_PUBLIC_KEY:-}" ] || {
    echo "quality evidence public key is missing" >&2
    exit 1
  }
  node "$SCRIPT_DIR/quality-review-evidence.js" verify \
    --head "$STAMP_HEAD" --base "$STAMP_BASE" --tier "$STAMP_TIER" \
    --findings "$STAMP_FINDINGS" --reviewer "$STAMP_PROVIDER" \
    --primary "$STAMP_PRIMARY" --fallback "$STAMP_FALLBACK" \
    --signature "$STAMP_SIGNATURE" || exit 1
fi

if [ "$STAMP_PROVIDER" = "operator-quality-override" ]; then
  printf '%s\n' "$PARSED" | grep -Fxq \
    'Quality-Override: operator-quality-override' || {
    echo "operator override evidence is missing its override trailer" >&2
    exit 1
  }
elif printf '%s\n' "$PARSED" | grep -q '^Quality-Override: '; then
  echo "non-override evidence must not carry Quality-Override" >&2
  exit 1
fi

tier_rank() {
  case "$1" in
    low) echo 0 ;;
    medium) echo 1 ;;
    high) echo 2 ;;
    critical) echo 3 ;;
    *) return 1 ;;
  esac
}
STAMP_RANK="$(tier_rank "$STAMP_TIER")" || {
  echo "quality evidence tier is invalid" >&2
  exit 1
}
if [ -n "$REQUIRED_TIER" ]; then
  REQUIRED_RANK="$(tier_rank "$REQUIRED_TIER")" || {
    echo "required quality tier is invalid" >&2
    exit 1
  }
  [ "$STAMP_RANK" -ge "$REQUIRED_RANK" ] || {
    echo "quality evidence tier is below the required tier" >&2
    exit 1
  }
fi
if [ -n "$REQUIRED_TIER" ] && [ "$REQUIRED_RANK" -ge 2 ]; then
  [ "$REQUIRE_SIGNATURE" = true ] || {
    echo "high/critical evidence requires --require-signature" >&2
    exit 1
  }
  if [ "$STAMP_PROVIDER" != "operator-quality-override" ]; then
    [ -n "$STAMP_PRIMARY" ] || {
      echo "high/critical evidence requires a configured primary reviewer" >&2
      exit 1
    }
    [ "$STAMP_PROVIDER" = "$STAMP_PRIMARY" ] || {
      echo "high/critical evidence requires the configured primary reviewer" >&2
      exit 1
    }
  fi
fi
echo "quality review evidence verified: reviewer=$STAMP_PROVIDER head=$STAMP_HEAD base=$STAMP_BASE"
