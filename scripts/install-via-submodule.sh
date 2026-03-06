#!/bin/bash
# =============================================================================
# Install Claude Commands via Git Submodule + Symlinks
# =============================================================================
# This creates a single source of truth that works everywhere:
# - Web UI ✓
# - CLI ✓
# - All computers ✓
# - All teammates ✓
#
# Usage:
#   cd your-project
#   bash <(curl -sL https://raw.githubusercontent.com/vibebuildlab/claude-setup/main/scripts/install-via-submodule.sh)
#
# Or if you have the script locally:
#   /path/to/claude-setup/scripts/install-via-submodule.sh
# =============================================================================

set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${BLUE}→${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}❌${NC} $1"; }

# Configuration
SUBMODULE_URL="${CLAUDE_SETUP_REPO:-https://github.com/YOUR_USER/claude-power-kit.git}"
SUBMODULE_PATH=".claude-setup"

echo ""
echo "🔧 Installing Claude Commands via Submodule"
echo "============================================================"
echo ""

# Check if we're in a git repo
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    error "Not in a git repository. Please run this from within a repo."
    exit 1
fi

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

log "Repository: $(basename "$REPO_ROOT")"
log "Submodule URL: $SUBMODULE_URL"
echo ""

# Step 1: Add submodule if it doesn't exist
if [[ -d "$SUBMODULE_PATH" ]]; then
    warn "Submodule already exists at $SUBMODULE_PATH"
    log "Updating submodule..."
    git submodule update --init --recursive "$SUBMODULE_PATH"
else
    log "Adding claude-setup as submodule..."
    git submodule add "$SUBMODULE_URL" "$SUBMODULE_PATH" || {
        error "Failed to add submodule. Make sure the URL is correct."
        exit 1
    }
    git submodule update --init --recursive "$SUBMODULE_PATH"
    success "Submodule added"
fi

# Step 2: Create .claude directory
mkdir -p .claude

# Step 3: Create symlinks
log "Creating symlinks..."

# Commands symlink
if [[ -L ".claude/commands" ]]; then
    warn "Symlink .claude/commands already exists"
elif [[ -d ".claude/commands" ]]; then
    error "Directory .claude/commands exists (not a symlink). Remove it first or backup."
    exit 1
else
    ln -s "../$SUBMODULE_PATH/commands" .claude/commands
    success "Linked: .claude/commands → $SUBMODULE_PATH/commands"
fi

# Optional: Link CLAUDE.md (project-level instructions)
if [[ -f "$SUBMODULE_PATH/config/CLAUDE.md" ]]; then
    if [[ ! -e ".claude/CLAUDE.md" ]]; then
        ln -s "../$SUBMODULE_PATH/config/CLAUDE.md" .claude/CLAUDE.md
        success "Linked: .claude/CLAUDE.md → $SUBMODULE_PATH/config/CLAUDE.md"
    fi
fi

# Optional: Link other useful directories
for dir in scripts agents skills; do
    if [[ -d "$SUBMODULE_PATH/$dir" ]] && [[ ! -e ".claude/$dir" ]]; then
        ln -s "../$SUBMODULE_PATH/$dir" ".claude/$dir"
        success "Linked: .claude/$dir → $SUBMODULE_PATH/$dir"
    fi
done

echo ""
log "Verifying setup..."

# Verify symlinks work
if [[ -f ".claude/commands/bs/dev.md" ]]; then
    success "Commands are accessible ✓"
    CMD_COUNT=$(find .claude/commands -name "*.md" -type f 2>/dev/null | wc -l | tr -d ' ')
    echo "   • Found $CMD_COUNT command files"
else
    error "Commands not accessible. Symlink may be broken."
    exit 1
fi

# Step 4: Create .gitignore entry (optional)
if ! grep -q "^.claude-setup$" .gitignore 2>/dev/null; then
    warn "Note: .claude-setup will be tracked as a submodule (this is correct)"
fi

# Step 5: Stage changes
log "Staging changes for commit..."
git add .gitmodules "$SUBMODULE_PATH" .claude

echo ""
echo "============================================================"
success "Installation complete!"
echo "============================================================"
echo ""
echo "📋 What was installed:"
echo "   • Submodule: $SUBMODULE_PATH (claude-setup)"
echo "   • Symlink: .claude/commands → $SUBMODULE_PATH/commands"
if [[ -L ".claude/CLAUDE.md" ]]; then
    echo "   • Symlink: .claude/CLAUDE.md → $SUBMODULE_PATH/config/CLAUDE.md"
fi
echo ""
echo "🔄 Next steps:"
echo ""
echo "   1. Test commands: /bs:help"
echo ""
echo "   2. Commit the changes:"
echo "      git commit -m 'Add Claude commands via submodule'"
echo ""
echo "   3. Push to remote:"
echo "      git push"
echo ""
echo "   4. For teammates (first time setup):"
echo "      git clone your-repo"
echo "      git submodule update --init --recursive"
echo ""
echo "✨ Benefits:"
echo "   ✅ Single source of truth (updates propagate)"
echo "   ✅ Works in Web UI (submodule is cloned)"
echo "   ✅ Works in CLI (symlinks resolve locally)"
echo "   ✅ Works for all teammates (same setup)"
echo "   ✅ Easy updates: 'cd $SUBMODULE_PATH && git pull'"
echo ""
echo "🔧 Updating commands later:"
echo "   cd $SUBMODULE_PATH"
echo "   git pull origin main"
echo "   cd .."
echo "   git add $SUBMODULE_PATH"
echo "   git commit -m 'Update Claude commands'"
echo ""
