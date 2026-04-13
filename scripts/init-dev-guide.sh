#!/usr/bin/env bash
# Initialize docs/dev_guide/CONVENTIONS.md in a project from the template
# Usage: scripts/init-dev-guide.sh <project-path>

set -euo pipefail

TARGET="${1:-$PWD}"
TEMPLATE="$(dirname "$0")/../agents/dev-guide-template.md"
OUTPUT="$TARGET/docs/dev_guide/CONVENTIONS.md"
PROJECT_NAME="$(basename "$TARGET")"

if [ -f "$OUTPUT" ]; then
  echo "Already exists: $OUTPUT"
  exit 0
fi

mkdir -p "$(dirname "$OUTPUT")"
sed "s/\[PROJECT_NAME\]/$PROJECT_NAME/g" "$TEMPLATE" > "$OUTPUT"
echo "Created: $OUTPUT"
echo "Edit it to add project-specific conventions, then commit."
