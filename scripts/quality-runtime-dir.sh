#!/usr/bin/env bash
# Print the canonical directory containing the installed quality runtime.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
[ -f "$SCRIPT_DIR/quality-invocation.js" ] || {
  echo "quality-runtime-dir: quality-invocation.js is missing beside this helper" >&2
  exit 1
}
printf '%s\n' "$SCRIPT_DIR"
