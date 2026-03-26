#!/bin/bash
# =============================================================================
# My Claude Setup - One-liner installer
# =============================================================================
# Usage:
#   curl -sL https://raw.githubusercontent.com/USER/claude-setup/main/install.sh | bash
#
# Or clone and run:
#   git clone https://github.com/USER/claude-setup.git ~/Projects/claude-setup
#   ~/Projects/claude-setup/install.sh
# =============================================================================

set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}→${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }

PROJECT_DIR="$HOME/Projects/claude-setup"
REPO_URL="${MY_CLAUDE_SETUP_REPO:-}"

echo ""
echo "🔧 My Claude Setup Installer"
echo "============================================================"
echo ""

# Clone if not exists
if [[ ! -d "$PROJECT_DIR" ]]; then
    if [[ -z "$REPO_URL" ]]; then
        echo "Project not found at $PROJECT_DIR"
        echo ""
        echo "Clone your repo first:"
        echo "  git clone YOUR_REPO_URL ~/Projects/claude-setup"
        echo "  ~/Projects/claude-setup/install.sh"
        exit 1
    fi
    log "Cloning repository..."
    mkdir -p "$HOME/Projects"
    git clone "$REPO_URL" "$PROJECT_DIR"
    success "Repository cloned"
fi

# Run setup
log "Running setup..."
"$PROJECT_DIR/scripts/setup-claude-sync.sh"

echo ""
echo "============================================================"
success "Installation complete!"
echo ""
echo "Restart Claude Code to apply changes."
echo ""
