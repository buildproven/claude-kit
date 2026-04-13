#!/bin/bash
# sync-codex-prompts.sh - Sync Claude commands to Codex CLI
#
# Codex CLI supports two ways to use custom prompts:
# 1. AGENTS.md - Global instructions loaded for every session
# 2. ~/.codex/prompts/*.md - Slash commands invoked via /prompts:<name>
#
# Claude Code uses subdirectories (bs/, gh/, cc/) but Codex only scans
# top-level files. This script flattens commands with prefix naming.
#
# Usage:
#   ./sync-codex-prompts.sh           # Full sync
#   ./sync-codex-prompts.sh --check   # Check only, don't modify
#   ./sync-codex-prompts.sh --diff    # Show what would change
#   ./sync-codex-prompts.sh --clean   # Remove synced files

set -e

# Paths
CLAUDE_CONFIG_DIR="${PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
CLAUDE_COMMANDS="$CLAUDE_CONFIG_DIR/commands"
CLAUDE_GLOBAL="$CLAUDE_CONFIG_DIR/config/CLAUDE.md"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
CODEX_PROMPTS="$CODEX_HOME/prompts"
CODEX_AGENTS="$CODEX_HOME/AGENTS.md"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
MODE="sync"
while [[ $# -gt 0 ]]; do
    case $1 in
        --check) MODE="check"; shift ;;
        --diff)  MODE="diff"; shift ;;
        --clean) MODE="clean"; shift ;;
        -h|--help)
            echo "Usage: $0 [--check|--diff|--clean]"
            echo "  --check  Check if sync is needed without modifying"
            echo "  --diff   Show what would change"
            echo "  --clean  Remove all synced prompt files"
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

echo -e "${BLUE}Codex Prompts Sync${NC}"
echo ""

# Ensure directories exist
mkdir -p "$CODEX_PROMPTS"

# Clean mode - remove synced files
if [[ "$MODE" == "clean" ]]; then
    echo -e "${YELLOW}Cleaning synced prompts...${NC}"

    # Remove flattened command files (bs-*.md, gh-*.md, cc-*.md)
    for prefix in bs gh cc; do
        for f in "$CODEX_PROMPTS"/${prefix}-*.md; do
            if [[ -f "$f" ]]; then
                echo "  Removing: $(basename "$f")"
                rm "$f"
            fi
        done
    done

    # Remove AGENTS.md if it has our header
    if [[ -f "$CODEX_AGENTS" ]] && grep -q "Auto-generated from Claude Code" "$CODEX_AGENTS"; then
        echo "  Removing: AGENTS.md"
        rm "$CODEX_AGENTS"
    fi

    echo -e "${GREEN}✓ Cleaned${NC}"
    exit 0
fi

# Check if prompts dir is a symlink (old setup)
if [[ -L "$CODEX_PROMPTS" ]]; then
    echo -e "${YELLOW}Warning: ~/.codex/prompts is a symlink${NC}"
    echo "Codex doesn't support subdirectories. Removing symlink and creating real directory."
    rm "$CODEX_PROMPTS"
    mkdir -p "$CODEX_PROMPTS"
fi

# Track what we'll sync
declare -a SYNC_FILES=()
declare -a SYNC_NAMES=()

# Find all commands to sync — subdirectories AND root-level files
for cmd_dir in "$CLAUDE_COMMANDS"/*/; do
    if [[ -d "$cmd_dir" ]]; then
        prefix=$(basename "$cmd_dir")
        for cmd_file in "$cmd_dir"*.md; do
            if [[ -f "$cmd_file" ]]; then
                cmd_name=$(basename "$cmd_file" .md)
                # Flatten: bs/execute.md -> bs-execute.md
                # This makes /prompts:bs-execute available
                flat_name="${prefix}-${cmd_name}.md"
                SYNC_FILES+=("$cmd_file")
                SYNC_NAMES+=("$flat_name")
            fi
        done
    fi
done

# Include root-level command files (e.g. debug.md, refactor.md)
for cmd_file in "$CLAUDE_COMMANDS"/*.md; do
    if [[ -f "$cmd_file" ]]; then
        cmd_name=$(basename "$cmd_file" .md)
        # Skip README.md
        [[ "$cmd_name" == "README" ]] && continue
        SYNC_FILES+=("$cmd_file")
        SYNC_NAMES+=("${cmd_name}.md")
    fi
done

# Check mode
if [[ "$MODE" == "check" ]]; then
    needs_sync=0

    for i in "${!SYNC_FILES[@]}"; do
        src="${SYNC_FILES[$i]}"
        dst="$CODEX_PROMPTS/${SYNC_NAMES[$i]}"

        if [[ ! -f "$dst" ]]; then
            echo -e "${YELLOW}Missing: ${SYNC_NAMES[$i]}${NC}"
            needs_sync=1
        elif ! diff -q "$src" "$dst" >/dev/null 2>&1; then
            echo -e "${YELLOW}Changed: ${SYNC_NAMES[$i]}${NC}"
            needs_sync=1
        fi
    done

    if [[ $needs_sync -eq 0 ]]; then
        echo -e "${GREEN}✓ All ${#SYNC_FILES[@]} prompts are in sync${NC}"
        exit 0
    else
        echo ""
        echo -e "${YELLOW}⚠ Sync needed. Run without --check to sync.${NC}"
        exit 1
    fi
fi

# Diff mode
if [[ "$MODE" == "diff" ]]; then
    for i in "${!SYNC_FILES[@]}"; do
        src="${SYNC_FILES[$i]}"
        dst="$CODEX_PROMPTS/${SYNC_NAMES[$i]}"

        if [[ ! -f "$dst" ]]; then
            echo -e "${GREEN}+ Would create: ${SYNC_NAMES[$i]}${NC}"
        elif ! diff -q "$src" "$dst" >/dev/null 2>&1; then
            echo -e "${YELLOW}~ Would update: ${SYNC_NAMES[$i]}${NC}"
            diff -u "$dst" "$src" 2>/dev/null | head -20 || true
            echo ""
        fi
    done
    exit 0
fi

# Sync mode - copy files with flattened names
synced=0
for i in "${!SYNC_FILES[@]}"; do
    src="${SYNC_FILES[$i]}"
    dst="$CODEX_PROMPTS/${SYNC_NAMES[$i]}"

    # Copy file
    cp "$src" "$dst"
    ((synced++))
done

# Also create AGENTS.md with global preferences
if [[ -f "$CLAUDE_GLOBAL" ]]; then
    cat > "$CODEX_AGENTS" << 'HEADER'
# AGENTS.md - Codex CLI Custom Instructions
# Auto-generated from Claude Code commands
# Source: ~/Projects/claude-kit
#
# DO NOT EDIT THIS FILE DIRECTLY
# Run: sync-codex-prompts.sh to regenerate

HEADER
    cat "$CLAUDE_GLOBAL" >> "$CODEX_AGENTS"

    cat >> "$CODEX_AGENTS" << 'FOOTER'

---

# Slash Commands

Custom slash commands are available via `/prompts:<name>`. Examples:
- `/prompts:bs-dev` - Smart feature development
- `/prompts:bs-quality` - Autonomous quality loop
- `/prompts:bs-test` - Run tests
- `/prompts:gh-fix-issue` - Fix GitHub issues
- `/prompts:debug` - Systematic debugging protocol

Run `sync-codex-prompts.sh` to update from Claude Code commands.
FOOTER
fi

echo -e "${GREEN}✓ Synced $synced prompts to $CODEX_PROMPTS${NC}"
echo ""

# Show summary by prefix
echo "Commands synced (use /prompts:<name>):"
for prefix in bs gh cc; do
    count=$(ls "$CODEX_PROMPTS"/${prefix}-*.md 2>/dev/null | wc -l | tr -d ' ')
    if [[ $count -gt 0 ]]; then
        echo -e "  ${BLUE}${prefix}-*${NC} ($count commands)"
        # Show first few
        ls "$CODEX_PROMPTS"/${prefix}-*.md 2>/dev/null | head -3 | while read f; do
            name=$(basename "$f" .md)
            echo "    /prompts:$name"
        done
        if [[ $count -gt 3 ]]; then
            echo "    ... and $((count-3)) more"
        fi
    fi
done

echo ""
echo -e "${GREEN}Codex CLI can now use these via /prompts:<name>${NC}"
echo -e "Example: ${BLUE}/prompts:bs-execute${NC}"
