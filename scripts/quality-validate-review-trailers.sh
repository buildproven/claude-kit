#!/usr/bin/env bash
# Validate that HEAD carries internally consistent, revision-bound evidence.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
BASE_REF=origin/main
MANIFEST=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --manifest) MANIFEST="${2:-}"; shift 2 ;;
    --base) BASE_REF="${2:-}"; shift 2 ;;
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
fi

PARSED="$(git log -1 --format=%B | git interpret-trailers --parse 2>/dev/null)"
QUALITY_TRAILER="$(printf '%s\n' "$PARSED" | grep -E '^Reviewed-By: quality( |$)' | head -1)"
[ -n "$QUALITY_TRAILER" ] || { echo "quality trailer missing on HEAD" >&2; exit 1; }

STAMP_HEAD="$(printf '%s' "$QUALITY_TRAILER" | grep -oE 'head=[a-f0-9]+' | cut -d= -f2)"
STAMP_BASE="$(printf '%s' "$QUALITY_TRAILER" | grep -oE 'base=[a-f0-9]+' | cut -d= -f2)"
STAMP_PROVIDER="$(printf '%s' "$QUALITY_TRAILER" | grep -oE 'reviewer=(claude|codex)' | cut -d= -f2)"
STAMP_TIER="$(printf '%s' "$QUALITY_TRAILER" | grep -oE 'tier=[^,)]+' | head -1 | cut -d= -f2)"
STAMP_FINDINGS="$(printf '%s' "$QUALITY_TRAILER" | grep -oE 'findings=[0-9]+' | head -1 | cut -d= -f2)"
STAMP_PRIMARY="$(printf '%s' "$QUALITY_TRAILER" | grep -oE 'primary=(claude|codex)' | cut -d= -f2)"
STAMP_FALLBACK="$(printf '%s' "$QUALITY_TRAILER" | grep -oE 'fallback=(claude|codex|none)' | cut -d= -f2)"
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
  [ "$STAMP_FINDINGS" != "$AUTH_FINDINGS" ]
}; then
  echo "quality trailer does not match manifest authorization" >&2
  exit 1
fi
if [ "$STAMP_HEAD" = "$CURRENT_PARENT" ] && ! git diff --quiet HEAD~1 HEAD; then
  echo "stamp commit changes the reviewed tree" >&2
  exit 1
fi

EXPECTED="Reviewed-By: ${STAMP_PROVIDER} (tier=${STAMP_TIER}, findings=${STAMP_FINDINGS}, head=${STAMP_HEAD}, base=${STAMP_BASE})"
printf '%s\n' "$PARSED" | grep -Fxq "$EXPECTED" || {
  echo "provider trailer does not exactly match quality authorization" >&2
  exit 1
}
echo "quality review evidence verified: reviewer=$STAMP_PROVIDER head=$STAMP_HEAD base=$STAMP_BASE"
