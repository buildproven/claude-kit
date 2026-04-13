#!/bin/bash
# sync-ai-prompts.sh - Sync Claude commands to other AI CLIs
#
# Usage:
#   ./sync-ai-prompts.sh              # Sync to all (Codex + Gemini)
#   ./sync-ai-prompts.sh --codex      # Sync to Codex only
#   ./sync-ai-prompts.sh --gemini     # Sync to Gemini only
#   ./sync-ai-prompts.sh --check      # Check sync status for all
#   ./sync-ai-prompts.sh --clean      # Remove synced files from all

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
BLUE='\033[0;34m'
NC='\033[0m'

# Parse arguments
TARGET="all"
PASS_ARGS=()

while [[ $# -gt 0 ]]; do
    case $1 in
        --codex)  TARGET="codex"; shift ;;
        --gemini) TARGET="gemini"; shift ;;
        --all)    TARGET="all"; shift ;;
        -h|--help)
            echo "Usage: $0 [--codex|--gemini|--all] [--check|--diff|--clean]"
            echo ""
            echo "Targets:"
            echo "  --codex   Sync to Codex CLI only"
            echo "  --gemini  Sync to Gemini CLI only"
            echo "  --all     Sync to all CLIs (default)"
            echo ""
            echo "Options (passed to sync scripts):"
            echo "  --check   Check if sync is needed"
            echo "  --diff    Show what would change"
            echo "  --clean   Remove synced files"
            exit 0
            ;;
        *)
            # Pass through other args to underlying scripts
            PASS_ARGS+=("$1")
            shift
            ;;
    esac
done

echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo -e "${BLUE}  AI CLI Prompt Sync${NC}"
echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo ""

# Run appropriate sync scripts
if [[ "$TARGET" == "codex" || "$TARGET" == "all" ]]; then
    echo -e "${BLUE}▸ Codex CLI${NC}"
    "$SCRIPT_DIR/sync-codex-prompts.sh" "${PASS_ARGS[@]}"
    echo ""
fi

if [[ "$TARGET" == "gemini" || "$TARGET" == "all" ]]; then
    echo -e "${BLUE}▸ Gemini CLI${NC}"
    "$SCRIPT_DIR/sync-gemini-prompts.sh" "${PASS_ARGS[@]}"
    echo ""
fi

echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo -e "${BLUE}  Done!${NC}"
echo -e "${BLUE}═══════════════════════════════════════${NC}"
