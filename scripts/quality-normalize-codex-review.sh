#!/usr/bin/env bash
# Normalize Codex structured output across CLI response envelopes.
set -euo pipefail

INPUT="${1:-}"
OUTPUT="${2:-}"
[ -n "$INPUT" ] && [ -f "$INPUT" ] && [ -n "$OUTPUT" ] || {
  echo "usage: quality-normalize-codex-review.sh input.json output.json" >&2
  exit 2
}

jq -e '
  (if (.result? | type) == "object" then .result else . end)
  | select(
      (.verdict | type) == "string"
      and (.summary | type) == "string"
      and (.findings | type) == "array"
    )
' "$INPUT" > "$OUTPUT"
