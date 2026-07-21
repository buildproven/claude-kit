#!/usr/bin/env bash
# Normalize Codex structured output across CLI response envelopes.
set -euo pipefail

INPUT="${1:-}"
OUTPUT="${2:-}"
[ -n "$INPUT" ] && [ -f "$INPUT" ] && [ -n "$OUTPUT" ] || {
  echo "usage: quality-normalize-codex-review.sh input.json output.json" >&2
  exit 2
}

if node "$(dirname "$0")/quality-normalize-structured-review-cli.js" \
  "$INPUT" "$OUTPUT" 2>/dev/null; then
  exit 0
fi

node "$(dirname "$0")/quality-normalize-codex-native-review.js" \
  "$INPUT" "$OUTPUT" "${GIT_ROOT:-$(pwd)}"
