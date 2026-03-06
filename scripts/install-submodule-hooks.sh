#!/bin/bash
# Install git hooks for submodule update notifications
# Run from a project that has .claude-setup submodule

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "📦 Installing submodule update notification hooks..."

# Check if we're in a git repo
if [ ! -d .git ]; then
  echo -e "${RED}Error: Not in a git repository${NC}"
  exit 1
fi

# Check if .claude-setup submodule exists
if [ ! -d .claude-setup ]; then
  echo -e "${YELLOW}Warning: .claude-setup submodule not found${NC}"
  echo "This script is designed for projects using claude-setup as a submodule."
  read -p "Continue anyway? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 0
  fi
fi

# Create hooks directory if it doesn't exist
mkdir -p .git/hooks

# Get the path to the check script
if [ -f .claude-setup/scripts/check-submodule-updates.sh ]; then
  SCRIPT_PATH="../../.claude-setup/scripts/check-submodule-updates.sh"
elif [ -f "$HOME/Projects/claude-setup/scripts/check-submodule-updates.sh" ]; then
  SCRIPT_PATH="$HOME/Projects/claude-setup/scripts/check-submodule-updates.sh"
else
  echo -e "${RED}Error: Could not find check-submodule-updates.sh${NC}"
  exit 1
fi

# Install hooks (symlink to the script)
HOOKS=("post-merge" "post-checkout" "post-rewrite")

for HOOK in "${HOOKS[@]}"; do
  HOOK_PATH=".git/hooks/$HOOK"

  # Backup existing hook if it exists
  if [ -f "$HOOK_PATH" ] && [ ! -L "$HOOK_PATH" ]; then
    echo -e "${YELLOW}Backing up existing $HOOK to ${HOOK}.backup${NC}"
    mv "$HOOK_PATH" "${HOOK_PATH}.backup"
  fi

  # Create or update symlink
  if [ -L "$HOOK_PATH" ]; then
    echo "✓ $HOOK (already installed)"
  else
    ln -s "$SCRIPT_PATH" "$HOOK_PATH"
    echo -e "${GREEN}✓ $HOOK (installed)${NC}"
  fi
done

echo ""
echo -e "${GREEN}✅ Submodule update hooks installed successfully!${NC}"
echo ""
echo "These hooks will run after:"
echo "  • git merge"
echo "  • git checkout"
echo "  • git rebase"
echo ""
echo "They will notify you if your submodules are outdated."
