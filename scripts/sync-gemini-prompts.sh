#!/bin/bash
# sync-gemini-prompts.sh - Sync Claude commands to Gemini CLI
#
# Gemini CLI uses TOML files for custom commands:
# - ~/.gemini/commands/*.toml for global commands
# - Supports subdirectories: git/commit.toml -> /git:commit
#
# This script converts Claude's Markdown+YAML commands to Gemini's TOML format.
#
# Usage:
#   ./sync-gemini-prompts.sh           # Full sync
#   ./sync-gemini-prompts.sh --check   # Check only
#   ./sync-gemini-prompts.sh --diff    # Show what would change
#   ./sync-gemini-prompts.sh --clean   # Remove synced files

set -e

# Paths
CLAUDE_CONFIG_DIR="${PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
CLAUDE_COMMANDS="$CLAUDE_CONFIG_DIR/commands"
CLAUDE_GLOBAL="$CLAUDE_CONFIG_DIR/config/CLAUDE.md"
GEMINI_HOME="$HOME/.gemini"
GEMINI_COMMANDS="$GEMINI_HOME/commands"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Parse arguments
MODE="sync"
while [[ $# -gt 0 ]]; do
    case $1 in
        --check) MODE="check"; shift ;;
        --diff)  MODE="diff"; shift ;;
        --clean) MODE="clean"; shift ;;
        -h|--help)
            echo "Usage: $0 [--check|--diff|--clean]"
            echo "  --check  Check if sync is needed"
            echo "  --diff   Show what would change"
            echo "  --clean  Remove all synced command files"
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

echo -e "${BLUE}Gemini CLI Prompts Sync${NC}"
echo ""

# Ensure directories exist
mkdir -p "$GEMINI_COMMANDS"

# Clean mode
if [[ "$MODE" == "clean" ]]; then
    echo -e "${YELLOW}Cleaning synced commands...${NC}"

    for prefix in bs gh cc; do
        if [[ -d "$GEMINI_COMMANDS/$prefix" ]]; then
            echo "  Removing: $prefix/"
            rm -rf "$GEMINI_COMMANDS/$prefix"
        fi
    done

    echo -e "${GREEN}✓ Cleaned${NC}"
    exit 0
fi

# Convert a single Claude command to Gemini TOML format
convert_to_toml() {
    local src_file="$1"
    local content

    # Extract description from YAML frontmatter
    local description
    description=$(sed -n '/^---$/,/^---$/p' "$src_file" | grep '^description:' | sed 's/description: *"\{0,1\}\([^"]*\)"\{0,1\}/\1/' | head -1)

    # Extract prompt content (everything after YAML frontmatter)
    local prompt
    prompt=$(awk '
        BEGIN { in_frontmatter=0; found_first=0; found_end=0 }
        /^---$/ {
            if (!found_first) { found_first=1; in_frontmatter=1; next }
            else if (in_frontmatter) { in_frontmatter=0; found_end=1; next }
        }
        found_end && !in_frontmatter { print }
    ' "$src_file")

    # Build TOML output
    echo "# Auto-generated from Claude Code command"
    echo "# Source: $src_file"
    echo ""

    if [[ -n "$description" ]]; then
        echo "description = \"$description\""
        echo ""
    fi

    # Escape content for TOML multi-line strings:
    # 1. Backslashes need to be escaped as \\
    # 2. Triple quotes """ need to be escaped as \"\"\"
    local escaped_prompt
    escaped_prompt=$(echo "$prompt" | sed 's/\\/\\\\/g' | sed 's/"""/\\"""/g')

    # Use multi-line string for prompt
    echo 'prompt = """'
    echo "$escaped_prompt"
    echo '"""'
}

# Track what we'll sync
declare -a SRC_FILES=()
declare -a DST_FILES=()

# Find all commands to sync — subdirectories AND root-level files
for cmd_dir in "$CLAUDE_COMMANDS"/*/; do
    if [[ -d "$cmd_dir" ]]; then
        prefix=$(basename "$cmd_dir")
        for cmd_file in "$cmd_dir"*.md; do
            if [[ -f "$cmd_file" ]]; then
                cmd_name=$(basename "$cmd_file" .md)
                # Gemini supports subdirs: bs/execute.toml -> /bs:execute
                dst_file="$GEMINI_COMMANDS/$prefix/$cmd_name.toml"
                SRC_FILES+=("$cmd_file")
                DST_FILES+=("$dst_file")
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
        dst_file="$GEMINI_COMMANDS/$cmd_name.toml"
        SRC_FILES+=("$cmd_file")
        DST_FILES+=("$dst_file")
    fi
done

# Check mode
if [[ "$MODE" == "check" ]]; then
    needs_sync=0

    for i in "${!SRC_FILES[@]}"; do
        src="${SRC_FILES[$i]}"
        dst="${DST_FILES[$i]}"

        if [[ ! -f "$dst" ]]; then
            echo -e "${YELLOW}Missing: ${dst#$GEMINI_COMMANDS/}${NC}"
            needs_sync=1
        else
            # Compare by generating new content
            new_content=$(convert_to_toml "$src")
            if [[ "$new_content" != "$(cat "$dst")" ]]; then
                echo -e "${YELLOW}Changed: ${dst#$GEMINI_COMMANDS/}${NC}"
                needs_sync=1
            fi
        fi
    done

    if [[ $needs_sync -eq 0 ]]; then
        echo -e "${GREEN}✓ All ${#SRC_FILES[@]} commands are in sync${NC}"
        exit 0
    else
        echo ""
        echo -e "${YELLOW}⚠ Sync needed. Run without --check to sync.${NC}"
        exit 1
    fi
fi

# Diff mode
if [[ "$MODE" == "diff" ]]; then
    for i in "${!SRC_FILES[@]}"; do
        src="${SRC_FILES[$i]}"
        dst="${DST_FILES[$i]}"
        rel_path="${dst#$GEMINI_COMMANDS/}"

        if [[ ! -f "$dst" ]]; then
            echo -e "${GREEN}+ Would create: $rel_path${NC}"
        else
            new_content=$(convert_to_toml "$src")
            if [[ "$new_content" != "$(cat "$dst")" ]]; then
                echo -e "${YELLOW}~ Would update: $rel_path${NC}"
                diff -u "$dst" <(echo "$new_content") 2>/dev/null | head -20 || true
                echo ""
            fi
        fi
    done
    exit 0
fi

# Sync mode - convert and copy files
synced=0
for i in "${!SRC_FILES[@]}"; do
    src="${SRC_FILES[$i]}"
    dst="${DST_FILES[$i]}"

    # Create subdirectory if needed
    mkdir -p "$(dirname "$dst")"

    # Convert and write
    convert_to_toml "$src" > "$dst"
    ((synced++))
done

echo -e "${GREEN}✓ Synced $synced commands to $GEMINI_COMMANDS${NC}"
echo ""

# Show summary by prefix
echo "Commands synced (use /<prefix>:<name>):"
for prefix in bs gh cc; do
    if [[ -d "$GEMINI_COMMANDS/$prefix" ]]; then
        count=$(find "$GEMINI_COMMANDS/$prefix" -name "*.toml" -type f | wc -l | tr -d ' ')
        if [[ $count -gt 0 ]]; then
            echo -e "  ${BLUE}/$prefix:*${NC} ($count commands)"
            find "$GEMINI_COMMANDS/$prefix" -name "*.toml" -type f | head -3 | while read f; do
                name=$(basename "$f" .toml)
                echo "    /$prefix:$name"
            done
            if [[ $count -gt 3 ]]; then
                echo "    ... and $((count-3)) more"
            fi
        fi
    fi
done

echo ""
echo -e "${GREEN}Gemini CLI can now use these via /<prefix>:<name>${NC}"
echo -e "Example: ${BLUE}/bs:execute${NC}"
