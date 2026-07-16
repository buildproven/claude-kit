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
  def valid_finding:
    type == "object"
    and ((keys_unsorted - [
      "severity", "title", "body", "file", "line_start", "recommendation"
    ]) | length) == 0
    and (.severity == "critical" or .severity == "high"
      or .severity == "medium" or .severity == "low")
    and (.title | type) == "string"
    and (.body | type) == "string"
    and (.file | type) == "string"
    and (.line_start | type) == "number"
    and (.line_start | floor) == .line_start
    and (.line_start >= 1)
    and (.recommendation | type) == "string";

  (if (.result? | type) == "object" then .result else . end)
  | select(
      type == "object"
      and ((keys_unsorted - ["verdict", "summary", "findings"]) | length) == 0
      and (.verdict == "approve" or .verdict == "needs-attention")
      and (.summary | type) == "string"
      and (.summary | length) >= 1
      and (.findings | type) == "array"
      and all(.findings[]; valid_finding)
    )
' "$INPUT" > "$OUTPUT"
