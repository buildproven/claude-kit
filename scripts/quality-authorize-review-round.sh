#!/usr/bin/env bash
# Authorize one persisted review round without exposing merge-lease handling to callers.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
MANIFEST="${1:-}"
[ -n "$MANIFEST" ] || { echo "quality-authorize-review-round: manifest path is required" >&2; exit 2; }
source "$SCRIPT_DIR/quality-repo-lease-pin.sh" || exit 1
quality_pin_repository_lease "$MANIFEST" || exit 1
node "$SCRIPT_DIR/quality-run-governor.js" bump-round "$MANIFEST"
