#!/usr/bin/env bash
# Validate that HEAD carries internally consistent, revision-bound evidence.
set -u
BASE_REF="${1:-origin/main}"
PARSED="$(git log -1 --format=%B | git interpret-trailers --parse 2>/dev/null)"
QUALITY_TRAILER="$(printf '%s\n' "$PARSED" | grep -E '^Reviewed-By: quality( |$)' | head -1)"
[ -n "$QUALITY_TRAILER" ] || { echo "quality trailer missing on HEAD" >&2; exit 1; }

STAMP_HEAD="$(printf '%s' "$QUALITY_TRAILER" | grep -oE 'head=[a-f0-9]+' | cut -d= -f2)"
STAMP_BASE="$(printf '%s' "$QUALITY_TRAILER" | grep -oE 'base=[a-f0-9]+' | cut -d= -f2)"
STAMP_PROVIDER="$(printf '%s' "$QUALITY_TRAILER" | grep -oE 'reviewer=(claude|codex)' | cut -d= -f2)"
STAMP_TIER="$(printf '%s' "$QUALITY_TRAILER" | grep -oE 'tier=[^,)]+' | head -1 | cut -d= -f2)"
STAMP_FINDINGS="$(printf '%s' "$QUALITY_TRAILER" | grep -oE 'findings=[0-9]+' | head -1 | cut -d= -f2)"
CURRENT_HEAD="$(git rev-parse HEAD)"
CURRENT_PARENT="$(git rev-parse HEAD~1 2>/dev/null || true)"
CURRENT_BASE="$(git merge-base HEAD "$BASE_REF")"

if { [ "$STAMP_HEAD" != "$CURRENT_HEAD" ] && [ "$STAMP_HEAD" != "$CURRENT_PARENT" ]; } \
   || [ "$STAMP_BASE" != "$CURRENT_BASE" ] || [ -z "$STAMP_PROVIDER" ] \
   || [ -z "$STAMP_TIER" ] || [ -z "$STAMP_FINDINGS" ]; then
  echo "quality trailer is stale or malformed" >&2
  exit 1
fi

EXPECTED="Reviewed-By: ${STAMP_PROVIDER} (tier=${STAMP_TIER}, findings=${STAMP_FINDINGS}, head=${STAMP_HEAD}, base=${STAMP_BASE})"
printf '%s\n' "$PARSED" | grep -Fxq "$EXPECTED" || {
  echo "provider trailer does not exactly match quality authorization" >&2
  exit 1
}
echo "quality review evidence verified: reviewer=$STAMP_PROVIDER head=$STAMP_HEAD base=$STAMP_BASE"
