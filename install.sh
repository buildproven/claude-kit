#!/bin/bash
# =============================================================================
# claude-kit installer
# =============================================================================
# Usage:
#   curl -sL https://raw.githubusercontent.com/buildproven/claude-kit/main/install.sh | bash
#
# Or clone and run:
#   git clone https://github.com/buildproven/claude-kit.git ~/Projects/claude-kit
#   ~/Projects/claude-kit/install.sh
# =============================================================================

set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
NC='\033[0m'

log() { echo -e "${BLUE}→${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }

REPO_URL="https://github.com/buildproven/claude-kit.git"
PROJECT_DIR="${CLAUDE_KIT_DIR:-$HOME/Projects/claude-kit}"
CLAUDE_DIR="$HOME/.claude"

echo ""
echo "claude-kit installer"
echo "============================================================"
echo ""

# Clone if not already present
if [[ ! -d "$PROJECT_DIR" ]]; then
    log "Cloning claude-kit..."
    mkdir -p "$(dirname "$PROJECT_DIR")"
    git clone "$REPO_URL" "$PROJECT_DIR"
    success "Cloned to $PROJECT_DIR"
else
    log "Found existing install at $PROJECT_DIR"
fi

# Ensure ~/.claude exists
mkdir -p "$CLAUDE_DIR"

# Symlink commands, skills, agents
for dir in commands skills agents; do
    src="$PROJECT_DIR/$dir"
    dest="$CLAUDE_DIR/$dir"
    if [[ -d "$src" ]]; then
        if [[ -L "$dest" ]]; then
            rm "$dest"
        elif [[ -d "$dest" ]]; then
            warn "$dest exists and is not a symlink — skipping (merge manually)"
            continue
        fi
        ln -s "$src" "$dest"
        success "Linked ~/.claude/$dir → $src"
    fi
done

# Symlink settings.json if not already present
SETTINGS_SRC="$PROJECT_DIR/config/settings.json"
SETTINGS_DEST="$CLAUDE_DIR/settings.json"
if [[ -f "$SETTINGS_SRC" ]]; then
    if [[ ! -f "$SETTINGS_DEST" && ! -L "$SETTINGS_DEST" ]]; then
        ln -s "$SETTINGS_SRC" "$SETTINGS_DEST"
        success "Linked ~/.claude/settings.json"
    else
        warn "~/.claude/settings.json already exists — skipping (merge manually if needed)"
    fi
fi

# Symlink CLAUDE.md if not already present
CLAUDEMD_SRC="$PROJECT_DIR/config/CLAUDE.md"
CLAUDEMD_DEST="$CLAUDE_DIR/CLAUDE.md"
if [[ -f "$CLAUDEMD_SRC" ]]; then
    if [[ ! -f "$CLAUDEMD_DEST" && ! -L "$CLAUDEMD_DEST" ]]; then
        ln -s "$CLAUDEMD_SRC" "$CLAUDEMD_DEST"
        success "Linked ~/.claude/CLAUDE.md"
    else
        warn "~/.claude/CLAUDE.md already exists — skipping (merge manually if needed)"
    fi
fi

echo ""
echo "============================================================"
success "Installation complete!"
echo ""
echo "Restart Claude Code to apply changes."
echo ""
echo "Next steps:"
echo "  • Edit ~/.claude/CLAUDE.md to match your workflow"
echo "  • Run /bs:help inside Claude Code to see all commands"
echo ""
