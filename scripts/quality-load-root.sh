#!/usr/bin/env bash
# Load and validate one explicit quality invocation manifest.
#
# This script is an executable Bash entrypoint. Call it with Bash even when the
# parent shell is zsh:
#   bash quality-load-root.sh --manifest "$BS_QUALITY_MANIFEST"
#
# It never discovers state through session IDs, globbing, mtimes, or "latest"
# files. The passed manifest is the sole authority.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
MANIFEST=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --manifest) MANIFEST="${2:-}"; shift 2 ;;
    --manifest=*) MANIFEST="${1#*=}"; shift ;;
    *) echo "quality-load-root: unknown argument '$1'" >&2; exit 1 ;;
  esac
done

[ -n "$MANIFEST" ] || {
  echo "quality-load-root: --manifest is required" >&2
  exit 1
}

ROOT="$(node "$SCRIPT_DIR/quality-invocation.js" locate "$MANIFEST")" || exit 1
cd "$ROOT" || exit 1
node "$SCRIPT_DIR/quality-invocation.js" validate "$MANIFEST" >/dev/null || exit 1
printf '{"manifest":"%s","status":"validated"}\n' "$MANIFEST"
