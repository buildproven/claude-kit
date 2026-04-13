#!/bin/bash
# =============================================================================
# claude-kit submodule installer
# Adds claude-kit as a submodule and wires up .claude/ symlinks
# =============================================================================
# Usage:
#   bash <(curl -sL https://raw.githubusercontent.com/buildproven/claude-kit/main/scripts/install-via-submodule.sh)
#
# Or locally:
#   bash ~/Projects/claude-kit/scripts/install-via-submodule.sh
# =============================================================================

set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${BLUE}→${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; exit 1; }

CLAUDE_KIT_REPO="${CLAUDE_KIT_REPO:-https://github.com/buildproven/claude-kit.git}"
SUBMODULE_PATH=".claude-kit"
CLAUDE_DIR=".claude"

echo ""
echo "claude-kit submodule installer"
echo "============================================================"
echo ""

# Must be run from a git repo root
if ! git rev-parse --git-dir &>/dev/null 2>&1; then
    error "Not inside a git repository. Run this from your project root."
fi

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

# Add submodule if not already present
if [[ ! -d "$SUBMODULE_PATH" ]]; then
    log "Adding claude-kit as submodule at $SUBMODULE_PATH..."
    git submodule add "$CLAUDE_KIT_REPO" "$SUBMODULE_PATH"
    success "Submodule added"
else
    log "$SUBMODULE_PATH already exists — updating..."
    git submodule update --init --recursive "$SUBMODULE_PATH"
    success "Submodule up to date"
fi

# Create .claude dir
mkdir -p "$CLAUDE_DIR"

# Symlink commands, skills, agents, scripts
for dir in commands skills agents scripts; do
    src="$SUBMODULE_PATH/$dir"
    dest="$CLAUDE_DIR/$dir"
    if [[ -d "$src" ]]; then
        if [[ -L "$dest" ]]; then
            rm "$dest"
        elif [[ -d "$dest" ]]; then
            warn "$dest exists and is not a symlink — skipping"
            continue
        fi
        ln -s "../$src" "$dest"
        success "Linked $dest → $src"
    fi
done

# Symlink CLAUDE.md if not present
CLAUDEMD_SRC="$SUBMODULE_PATH/config/CLAUDE.md"
CLAUDEMD_DEST="$CLAUDE_DIR/CLAUDE.md"
if [[ -f "$CLAUDEMD_SRC" ]]; then
    if [[ ! -f "$CLAUDEMD_DEST" && ! -L "$CLAUDEMD_DEST" ]]; then
        ln -s "../$CLAUDEMD_SRC" "$CLAUDEMD_DEST"
        success "Linked $CLAUDEMD_DEST"
    else
        warn "$CLAUDEMD_DEST already exists — skipping"
    fi
fi

echo ""
echo "============================================================"
success "Done! Commit these changes to share with teammates:"
echo ""
echo "  git add .gitmodules $SUBMODULE_PATH $CLAUDE_DIR"
echo "  git commit -m \"Add Claude commands via claude-kit submodule\""
echo "  git push"
echo ""
echo "Teammates run:  git submodule update --init --recursive"
echo ""
