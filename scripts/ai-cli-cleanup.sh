#!/bin/bash
# AI CLI Cleanup Script - Focused Edition
# Focuses on: zombie processes, swap recovery, large leftover files (>250MB)
# Does NOT touch: Codex auth, conversation history, or low-value caches

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

DRY_RUN=false
KILL_ZOMBIES=false
FIND_LARGE=false
CLEAR_SWAP=false
FORCE=false
ALL=false

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --dry-run       Show what would be done without doing it"
    echo "  --zombies       Kill orphaned node processes (vitest, webpack, etc.)"
    echo "  --large         Find and optionally delete files >250MB in temp/cache dirs"
    echo "  --swap          Clear swap (requires sudo)"
    echo "  --force         Skip confirmation prompts"
    echo "  --all           Run all cleanup operations"
    echo "  -h, --help      Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 --dry-run          # Preview what would be cleaned"
    echo "  $0 --zombies          # Kill orphaned node processes"
    echo "  $0 --zombies --force  # Kill without confirmation"
    echo "  $0 --large            # Find large leftover files"
    echo "  $0 --swap             # Clear swap memory"
    echo "  $0 --all              # Full cleanup (zombies + large + swap)"
}

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[DONE]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_delete() { echo -e "${RED}[DELETE]${NC} $1"; }

get_size() {
    local path="$1"
    if [[ -e "$path" ]]; then
        du -sh "$path" 2>/dev/null | cut -f1
    else
        echo "0"
    fi
}

delete_path() {
    local path="$1"
    local desc="$2"

    if [[ -e "$path" ]]; then
        local size=$(get_size "$path")
        if $DRY_RUN; then
            log_delete "[DRY-RUN] Would delete $desc ($size): $path"
        else
            rm -rf "$path"
            log_success "Deleted $desc ($size): $path"
        fi
    fi
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run) DRY_RUN=true; shift ;;
        --zombies|--kill-zombies) KILL_ZOMBIES=true; shift ;;
        --large) FIND_LARGE=true; shift ;;
        --swap) CLEAR_SWAP=true; shift ;;
        --force) FORCE=true; shift ;;
        --all) ALL=true; KILL_ZOMBIES=true; FIND_LARGE=true; CLEAR_SWAP=true; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown option: $1"; usage; exit 1 ;;
    esac
done

# If no specific flags, show usage
if ! $KILL_ZOMBIES && ! $FIND_LARGE && ! $CLEAR_SWAP && ! $DRY_RUN; then
    echo ""
    echo "=========================================="
    echo "   AI CLI Cleanup Script - Focused Edition"
    echo "=========================================="
    echo ""
    log_info "No operation specified. Showing current system status..."
    echo ""

    # Show memory/swap status
    echo "--- Memory & Swap Status ---"
    vm_stat | head -10
    echo ""
    sysctl vm.swapusage 2>/dev/null || true
    echo ""

    # Quick zombie check - use same aggressive patterns as kill
    NPM_EXEC_COUNT=$(ps aux | grep 'npm exec' | grep -v grep | wc -l | tr -d ' ')
    NPX_COUNT=$(ps aux | grep -E '_npx|\.npm/_npx' | grep -v grep | wc -l | tr -d ' ')
    DEV_TOOLS_COUNT=$(ps aux | grep -E 'vitest|tsx.*cli|node_modules/.bin' | grep -v grep | wc -l | tr -d ' ')
    BUILD_TOOLS_COUNT=$(ps aux | grep -E "node.*(/var/folders/|/tmp/|vitest.*fork|webpack.*temp|esbuild|rollup)" | grep -v grep | wc -l | tr -d ' ')
    ZOMBIE_COUNT=$((NPM_EXEC_COUNT + NPX_COUNT + DEV_TOOLS_COUNT + BUILD_TOOLS_COUNT))

    if [[ "$ZOMBIE_COUNT" -gt 10 ]]; then
        log_warn "Found ~$ZOMBIE_COUNT potential zombie processes:"
        echo "  - npm exec: $NPM_EXEC_COUNT"
        echo "  - npx cache: $NPX_COUNT"
        echo "  - dev tools: $DEV_TOOLS_COUNT"
        echo "  - build tools: $BUILD_TOOLS_COUNT"
        echo ""
        log_info "Run with --zombies --force for aggressive cleanup"
    elif [[ "$ZOMBIE_COUNT" -gt 0 ]]; then
        log_warn "Found $ZOMBIE_COUNT potential zombie node processes"
    else
        log_success "No zombie processes detected"
    fi
    echo ""

    usage
    exit 0
fi

echo ""
echo "=========================================="
echo "   AI CLI Cleanup Script - Focused Edition"
echo "=========================================="
echo ""
$DRY_RUN && log_warn "DRY RUN MODE - No changes will be made"
$KILL_ZOMBIES && log_info "Will check for zombie processes"
$FIND_LARGE && log_info "Will search for large files (>250MB)"
$CLEAR_SWAP && log_info "Will clear swap memory"
echo ""

# ==========================================
# KILL ZOMBIE PROCESSES
# ==========================================
if $KILL_ZOMBIES; then
    echo ""
    echo "--- Killing Zombie Node Processes ---"

    # Get current Claude session PID to protect it
    CURRENT_CLAUDE_PID=$(ps aux | grep -E "^$USER.*claude\s*$" | grep -v grep | head -1 | awk '{print $2}')
    [[ -n "$CURRENT_CLAUDE_PID" ]] && log_info "Protecting current Claude session: PID $CURRENT_CLAUDE_PID"

    # Find orphaned node processes - AGGRESSIVE patterns
    ZOMBIE_PIDS=()
    ZOMBIE_INFO=()
    TOTAL_MEM=0

    # Pattern 1: npm exec processes (MCP servers spawn these)
    while IFS= read -r line; do
        if [[ -n "$line" ]]; then
            pid=$(echo "$line" | awk '{print $2}')
            [[ "$pid" == "$CURRENT_CLAUDE_PID" ]] && continue
            mem_kb=$(echo "$line" | awk '{print $6}')
            cmd=$(echo "$line" | awk '{for(i=11;i<=NF;i++) printf $i" "; print ""}' | head -c 80)
            mem_mb=$((mem_kb / 1024))
            TOTAL_MEM=$((TOTAL_MEM + mem_mb))
            ZOMBIE_PIDS+=("$pid")
            ZOMBIE_INFO+=("PID $pid: ${mem_mb}MB - $cmd...")
        fi
    done < <(ps aux | grep 'npm exec' | grep -v grep)

    # Pattern 2: npx cache processes
    while IFS= read -r line; do
        if [[ -n "$line" ]]; then
            pid=$(echo "$line" | awk '{print $2}')
            [[ "$pid" == "$CURRENT_CLAUDE_PID" ]] && continue
            [[ " ${ZOMBIE_PIDS[*]} " =~ " $pid " ]] && continue
            mem_kb=$(echo "$line" | awk '{print $6}')
            cmd=$(echo "$line" | awk '{for(i=11;i<=NF;i++) printf $i" "; print ""}' | head -c 80)
            mem_mb=$((mem_kb / 1024))
            TOTAL_MEM=$((TOTAL_MEM + mem_mb))
            ZOMBIE_PIDS+=("$pid")
            ZOMBIE_INFO+=("PID $pid: ${mem_mb}MB - $cmd...")
        fi
    done < <(ps aux | grep -E '_npx|\.npm/_npx' | grep -v grep)

    # Pattern 3: Dev tools (vitest, tsx, node_modules/.bin)
    while IFS= read -r line; do
        if [[ -n "$line" ]]; then
            pid=$(echo "$line" | awk '{print $2}')
            [[ "$pid" == "$CURRENT_CLAUDE_PID" ]] && continue
            [[ " ${ZOMBIE_PIDS[*]} " =~ " $pid " ]] && continue
            mem_kb=$(echo "$line" | awk '{print $6}')
            cmd=$(echo "$line" | awk '{for(i=11;i<=NF;i++) printf $i" "; print ""}' | head -c 80)
            mem_mb=$((mem_kb / 1024))
            TOTAL_MEM=$((TOTAL_MEM + mem_mb))
            ZOMBIE_PIDS+=("$pid")
            ZOMBIE_INFO+=("PID $pid: ${mem_mb}MB - $cmd...")
        fi
    done < <(ps aux | grep -E 'vitest|tsx.*cli|node_modules/.bin' | grep -v grep)

    # Pattern 4: Original temp/build tool patterns
    while IFS= read -r line; do
        if [[ -n "$line" ]]; then
            pid=$(echo "$line" | awk '{print $2}')
            [[ "$pid" == "$CURRENT_CLAUDE_PID" ]] && continue
            [[ " ${ZOMBIE_PIDS[*]} " =~ " $pid " ]] && continue
            mem_kb=$(echo "$line" | awk '{print $6}')
            cmd=$(echo "$line" | awk '{for(i=11;i<=NF;i++) printf $i" "; print ""}' | head -c 80)
            mem_mb=$((mem_kb / 1024))
            TOTAL_MEM=$((TOTAL_MEM + mem_mb))
            ZOMBIE_PIDS+=("$pid")
            ZOMBIE_INFO+=("PID $pid: ${mem_mb}MB - $cmd...")
        fi
    done < <(ps aux | grep -E "node.*(/var/folders/|/tmp/|vitest.*fork|webpack.*temp|esbuild|rollup)" | grep -v grep)

    if [[ ${#ZOMBIE_PIDS[@]} -eq 0 ]]; then
        log_success "No zombie node processes found"
    else
        echo ""
        log_warn "Found ${#ZOMBIE_PIDS[@]} zombie processes using ~${TOTAL_MEM}MB:"
        echo ""
        for info in "${ZOMBIE_INFO[@]}"; do
            echo "  $info"
        done
        echo ""

        PROCEED=false
        if $FORCE; then
            PROCEED=true
        elif $DRY_RUN; then
            log_delete "[DRY-RUN] Would kill ${#ZOMBIE_PIDS[@]} processes"
        else
            read -p "Kill these processes? [y/N] " -n 1 -r
            echo
            [[ $REPLY =~ ^[Yy]$ ]] && PROCEED=true
        fi

        if $PROCEED && ! $DRY_RUN; then
            for pid in "${ZOMBIE_PIDS[@]}"; do
                kill -9 "$pid" 2>/dev/null && log_success "Killed PID $pid" || log_warn "Failed to kill PID $pid"
            done
            echo ""
            log_success "Freed ~${TOTAL_MEM}MB of memory"
        fi
    fi

    # Clean npx cache directory
    echo ""
    log_info "Cleaning npx cache directory..."
    NPX_CACHE="$HOME/.npm/_npx"
    if [[ -d "$NPX_CACHE" ]]; then
        NPX_SIZE=$(du -sh "$NPX_CACHE" 2>/dev/null | cut -f1)
        if $DRY_RUN; then
            log_delete "[DRY-RUN] Would clear npx cache ($NPX_SIZE)"
        else
            rm -rf "$NPX_CACHE"/* 2>/dev/null
            log_success "Cleared npx cache ($NPX_SIZE)"
        fi
    fi
fi

# ==========================================
# FIND LARGE FILES (>250MB)
# ==========================================
if $FIND_LARGE; then
    echo ""
    echo "--- Finding Large Files (>250MB) in Temp/Cache Dirs ---"

    LARGE_FILES=()
    TOTAL_SIZE=0

    # Search common temp/cache locations for large files
    SEARCH_PATHS=(
        "/var/folders/*/*/T"
        "$HOME/.cache"
        "$HOME/Library/Caches"
        "$HOME/.npm/_cacache"
        "$HOME/.yarn/cache"
        "$HOME/.pnpm-store"
        "/tmp"
    )

    for search_path in "${SEARCH_PATHS[@]}"; do
        if [[ -d "$search_path" ]]; then
            while IFS= read -r file; do
                if [[ -n "$file" && -f "$file" ]]; then
                    size_bytes=$(stat -f%z "$file" 2>/dev/null || echo "0")
                    size_mb=$((size_bytes / 1024 / 1024))
                    TOTAL_SIZE=$((TOTAL_SIZE + size_mb))
                    LARGE_FILES+=("${size_mb}MB: $file")
                fi
            done < <(find "$search_path" -type f -size +250M 2>/dev/null)
        fi
    done

    if [[ ${#LARGE_FILES[@]} -eq 0 ]]; then
        log_success "No large files (>250MB) found in temp/cache directories"
    else
        echo ""
        log_warn "Found ${#LARGE_FILES[@]} large files totaling ~${TOTAL_SIZE}MB:"
        echo ""

        # Sort by size (largest first)
        printf '%s\n' "${LARGE_FILES[@]}" | sort -t: -k1 -rn | head -20 | while read -r line; do
            echo "  $line"
        done

        if [[ ${#LARGE_FILES[@]} -gt 20 ]]; then
            echo "  ... and $((${#LARGE_FILES[@]} - 20)) more files"
        fi
        echo ""

        if ! $DRY_RUN && ! $FORCE; then
            log_info "Review files above and delete manually if safe"
            log_info "Use: rm -f \"<filepath>\" to remove specific files"
        fi
    fi
fi

# ==========================================
# CLEAR SWAP
# ==========================================
if $CLEAR_SWAP; then
    echo ""
    echo "--- Clearing Swap Memory ---"

    # Show current swap usage
    SWAP_INFO=$(sysctl vm.swapusage 2>/dev/null)
    echo "$SWAP_INFO"
    echo ""

    if $DRY_RUN; then
        log_delete "[DRY-RUN] Would clear swap (requires sudo)"
    else
        PROCEED=false
        if $FORCE; then
            PROCEED=true
        else
            log_warn "Clearing swap requires sudo and may briefly slow system"
            read -p "Proceed? [y/N] " -n 1 -r
            echo
            [[ $REPLY =~ ^[Yy]$ ]] && PROCEED=true
        fi

        if $PROCEED; then
            log_info "Clearing swap (this may take a moment)..."
            # Disable and re-enable swap to clear it
            sudo launchctl unload /System/Library/LaunchDaemons/com.apple.dynamic_pager.plist 2>/dev/null || true
            sleep 2
            sudo launchctl load /System/Library/LaunchDaemons/com.apple.dynamic_pager.plist 2>/dev/null || true

            # Alternative: purge memory (doesn't require disabling swap)
            sudo purge 2>/dev/null || true

            log_success "Swap cleared"
            echo ""
            sysctl vm.swapusage 2>/dev/null || true
        fi
    fi
fi

echo ""
echo "=========================================="
log_success "Cleanup complete!"
$DRY_RUN && echo -e "${YELLOW}Run without --dry-run to execute changes${NC}"
echo "=========================================="
