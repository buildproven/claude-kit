#!/usr/bin/env bash
set -euo pipefail

REVIEW_OUT=""
MODE=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --review-out) REVIEW_OUT="${2:-}"; shift 2 ;;
    --mode) MODE="${2:-}"; shift 2 ;;
    *) echo "quality-preserve-primary-evidence: unknown argument '$1'" >&2; exit 1 ;;
  esac
done

[ -n "$REVIEW_OUT" ] && [ -d "$REVIEW_OUT" ] || {
  echo "quality-preserve-primary-evidence: --review-out must name a directory" >&2
  exit 1
}
case "$MODE" in
  parser-inconclusive|evidence-absent) ;;
  *) echo "quality-preserve-primary-evidence: invalid --mode" >&2; exit 1 ;;
esac

FAILED_PRIMARY="$REVIEW_OUT/failed-primary"
mkdir -p "$FAILED_PRIMARY"

quarantine() {
  local evidence="$1" destination counter
  destination="$FAILED_PRIMARY/$(basename "$evidence")"
  counter=2
  while [ -e "$destination" ]; do
    destination="$FAILED_PRIMARY/$(basename "$evidence").$counter"
    counter=$((counter + 1))
  done
  mv "$evidence" "$destination"
}

if [ "$MODE" = parser-inconclusive ]; then
  # Codex rc=4 means an earlier pass completed but a later pass could not be
  # parsed. Preserve only non-marker, non-whitespace findings from that
  # completed pass; quarantine the complete original for diagnosis.
  evidence="$REVIEW_OUT/codex.findings.txt"
  if [ -e "$evidence" ]; then
    kept="$(mktemp "$FAILED_PRIMARY/.conclusive-findings.XXXXXX")"
    grep -v '^INCONCLUSIVE:' "$evidence" > "$kept" || true
    quarantine "$evidence"
    if grep -q '[^[:space:]]' "$kept"; then
      mv "$kept" "$evidence"
    else
      rm -f "$kept"
    fi
  fi
else
  # Quota, billing, unavailability, and timeout mean the primary did not
  # complete. Partial findings are diagnostics, never authoritative evidence.
  for evidence in "$REVIEW_OUT"/*.findings.txt; do
    [ -e "$evidence" ] || continue
    quarantine "$evidence"
  done
fi

for evidence in \
  "$REVIEW_OUT"/*.stderr \
  "$REVIEW_OUT"/codex-*.json \
  "$REVIEW_OUT"/codex-*.progress \
  "$REVIEW_OUT"/codex-*.prompt; do
  [ -e "$evidence" ] || continue
  quarantine "$evidence"
done
