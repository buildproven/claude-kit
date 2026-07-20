#!/usr/bin/env bash
set -euo pipefail

REVIEW_OUT=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --review-out) REVIEW_OUT="${2:-}"; shift 2 ;;
    *) echo "quality-preserve-primary-evidence: unknown argument '$1'" >&2; exit 1 ;;
  esac
done

[ -n "$REVIEW_OUT" ] && [ -d "$REVIEW_OUT" ] || {
  echo "quality-preserve-primary-evidence: --review-out must name a directory" >&2
  exit 1
}

FAILED_PRIMARY="$REVIEW_OUT/failed-primary"
mkdir -p "$FAILED_PRIMARY"

# A later pass can become inconclusive after an earlier pass emitted valid
# findings. Quarantine the complete primary artifact for diagnosis, but keep
# its conclusive lines authoritative for inventory and fallback judgment.
for evidence in "$REVIEW_OUT"/*.findings.txt; do
  [ -e "$evidence" ] || continue
  grep -q '^INCONCLUSIVE:' "$evidence" || continue
  kept="$(mktemp "$REVIEW_OUT/.conclusive-findings.XXXXXX")"
  grep -v '^INCONCLUSIVE:' "$evidence" > "$kept" || true
  mv "$evidence" "$FAILED_PRIMARY/"
  if [ -s "$kept" ]; then
    mv "$kept" "$evidence"
  else
    rm -f "$kept"
  fi
done

for evidence in \
  "$REVIEW_OUT"/*.stderr \
  "$REVIEW_OUT"/codex-*.json \
  "$REVIEW_OUT"/codex-*.progress \
  "$REVIEW_OUT"/codex-*.prompt; do
  [ -e "$evidence" ] || continue
  mv "$evidence" "$FAILED_PRIMARY/"
done
