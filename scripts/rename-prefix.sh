#!/bin/bash
# =============================================================================
# Rename the command prefix from "bs:" to your preferred prefix
# =============================================================================
# Usage:
#   ./scripts/rename-prefix.sh my        # Renames bs: -> my:
#   ./scripts/rename-prefix.sh dev       # Renames bs: -> dev:
#   ./scripts/rename-prefix.sh x         # Renames bs: -> x:
# =============================================================================

set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${BLUE}>${NC} $1"; }
success() { echo -e "${GREEN}OK${NC} $1"; }
error() { echo -e "${RED}ERROR${NC} $1"; exit 1; }

NEW_PREFIX="${1:-}"
OLD_PREFIX="bs"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

if [[ -z "$NEW_PREFIX" ]]; then
  echo "Usage: $0 <new-prefix>"
  echo ""
  echo "Examples:"
  echo "  $0 my      # /bs:dev -> /my:dev"
  echo "  $0 dev     # /bs:dev -> /dev:dev"
  echo "  $0 x       # /bs:dev -> /x:dev"
  exit 1
fi

if [[ "$NEW_PREFIX" == "$OLD_PREFIX" ]]; then
  echo "Already using '$OLD_PREFIX' prefix. Nothing to do."
  exit 0
fi

# Validate prefix (alphanumeric, lowercase, 1-10 chars)
if [[ ! "$NEW_PREFIX" =~ ^[a-z0-9]{1,10}$ ]]; then
  error "Prefix must be 1-10 lowercase alphanumeric characters"
fi

echo ""
echo "Renaming command prefix: $OLD_PREFIX -> $NEW_PREFIX"
echo "============================================================"
echo ""

# 1. Rename the directory
if [[ -d "$ROOT_DIR/commands/$OLD_PREFIX" ]]; then
  log "Renaming commands/$OLD_PREFIX/ -> commands/$NEW_PREFIX/"
  mv "$ROOT_DIR/commands/$OLD_PREFIX" "$ROOT_DIR/commands/$NEW_PREFIX"
  success "Directory renamed"
else
  error "commands/$OLD_PREFIX/ not found. Already renamed?"
fi

# 2. Update name: field in frontmatter
log "Updating frontmatter name fields..."
find "$ROOT_DIR/commands/$NEW_PREFIX" -name "*.md" -exec sed -i '' "s|name: ${OLD_PREFIX}:|name: ${NEW_PREFIX}:|g" {} +
success "Frontmatter updated"

# 3. Update /bs: references in command files
log "Updating command references in all files..."
find "$ROOT_DIR/commands" -name "*.md" -exec sed -i '' "s|/${OLD_PREFIX}:|/${NEW_PREFIX}:|g" {} +
find "$ROOT_DIR/skills" -name "*.md" -exec sed -i '' "s|/${OLD_PREFIX}:|/${NEW_PREFIX}:|g" {} + 2>/dev/null
success "Command references updated"

# 4. Update README
if [[ -f "$ROOT_DIR/README.md" ]]; then
  log "Updating README.md..."
  sed -i '' "s|/${OLD_PREFIX}:|/${NEW_PREFIX}:|g" "$ROOT_DIR/README.md"
  sed -i '' "s|commands/${OLD_PREFIX}|commands/${NEW_PREFIX}|g" "$ROOT_DIR/README.md"
  sed -i '' "s|\`${OLD_PREFIX}:\`|\`${NEW_PREFIX}:\`|g" "$ROOT_DIR/README.md"
  success "README updated"
fi

# 5. Update CLAUDE.md
if [[ -f "$ROOT_DIR/config/CLAUDE.md" ]]; then
  log "Updating config/CLAUDE.md..."
  sed -i '' "s|/${OLD_PREFIX}:|/${NEW_PREFIX}:|g" "$ROOT_DIR/config/CLAUDE.md"
  success "CLAUDE.md updated"
fi

echo ""
echo "============================================================"
success "Done! All '$OLD_PREFIX:' references renamed to '$NEW_PREFIX:'"
echo ""
echo "Next steps:"
echo "  1. Run: ./scripts/setup-claude-sync.sh"
echo "  2. Restart Claude Code"
echo ""
