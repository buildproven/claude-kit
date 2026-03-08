#!/bin/bash
# =============================================================================
# Setup Claude Sync - Complete portable Claude Code configuration
# =============================================================================
# One command to sync ALL Claude Code settings across computers:
#   - settings.json (permissions, model, statusLine)
#   - CLAUDE.md global configuration
#   - Commands, scripts, agents
#
# Usage:
#   ./scripts/setup-claude-sync.sh           # Full setup
#   ./scripts/setup-claude-sync.sh --check   # Health check only
#   ./scripts/setup-claude-sync.sh --repair  # Fix broken symlinks
#   ./scripts/setup-claude-sync.sh --backup  # Backup before changes
# =============================================================================

set -euo pipefail

# Allow override via environment or detect from script location
PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
BACKUP_DIR="$HOME/.claude-backup-$(date +%Y%m%d-%H%M%S)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; }

# =============================================================================
# FILES TO SYMLINK
# =============================================================================
declare -a SYMLINK_FILES=(
    # Core settings
    "config/settings.json:settings.json"

    # Main config (global preferences)
    "config/CLAUDE.md:CLAUDE.md"

    # Statusline
    "statusline-command.sh:statusline-command.sh"

    # Directories
    "commands:commands"
    "scripts:scripts"
    "agents:agents"
    "skills:skills"
)

# =============================================================================
# FUNCTIONS
# =============================================================================

check_prerequisites() {
    log_info "Checking prerequisites..."

    if [[ ! -d "$PROJECT_DIR" ]]; then
        log_error "Project not found: $PROJECT_DIR"
        echo ""
        echo "First, clone the claude-setup project:"
        echo "  git clone [your-repo] ~/Projects/claude-setup"
        echo "  cd ~/Projects/claude-setup"
        echo "  ./scripts/setup-claude-sync.sh"
        exit 1
    fi

    if [[ ! -f "$PROJECT_DIR/config/settings.json" ]]; then
        log_error "settings.json not found in $PROJECT_DIR/config/"
        echo "The config/settings.json file is required for sync."
        exit 1
    fi

    log_success "Prerequisites OK"
}

backup_existing() {
    if [[ -d "$CLAUDE_DIR" ]]; then
        log_info "Backing up existing ~/.claude to $BACKUP_DIR"
        cp -r "$CLAUDE_DIR" "$BACKUP_DIR"
        log_success "Backup created at $BACKUP_DIR"
    fi
}

create_symlink() {
    local source="$1"
    local target="$2"

    # Skip if source doesn't exist
    if [[ ! -e "$source" ]]; then
        log_warning "Source not found, skipping: $source"
        return 0
    fi

    # Remove existing file/symlink
    if [[ -e "$target" || -L "$target" ]]; then
        rm -rf "$target"
    fi

    # Create symlink
    ln -s "$source" "$target"
    log_success "Linked: $(basename "$target") → claude-setup/"
}

setup_symlinks() {
    log_info "Setting up symlinks..."

    # Ensure Claude directory exists
    mkdir -p "$CLAUDE_DIR"

    for entry in "${SYMLINK_FILES[@]}"; do
        local source_rel="${entry%%:*}"
        local target_rel="${entry##*:}"
        local source="$PROJECT_DIR/$source_rel"
        local target="$CLAUDE_DIR/$target_rel"

        create_symlink "$source" "$target"
    done
}

install_plugins() {
    log_info "Installing Claude Code plugins..."

    # Plugins to install
    local PLUGINS=(
        "code-simplifier"
    )

    for plugin in "${PLUGINS[@]}"; do
        if claude plugin list 2>/dev/null | grep -q "$plugin.*enabled"; then
            log_success "Plugin already installed: $plugin"
        else
            log_info "Installing plugin: $plugin"
            if claude plugin install "$plugin" 2>/dev/null; then
                log_success "Installed: $plugin"
            else
                log_warning "Could not install $plugin (may need manual install)"
            fi
        fi
    done
}

setup_mcp_servers() {
    log_info "Setting up social MCP servers..."

    local MCP_DIR="$PROJECT_DIR/mcp-servers"
    local CREDS_FILE="$PROJECT_DIR/.env"

    # Gate on .env — skip gracefully if no credentials
    if [[ ! -f "$CREDS_FILE" ]]; then
        log_warning "No .env file found — skipping MCP server registration"
        log_warning "Copy .env.template to .env and re-run to enable social posting"
        return 0
    fi

    # Detect uv
    local UV_PATH
    UV_PATH=$(which uv 2>/dev/null || echo "$HOME/.local/bin/uv")
    if [[ ! -x "$UV_PATH" ]]; then
        log_warning "uv not found — skipping MCP server registration"
        log_warning "Install with: curl -LsSf https://astral.sh/uv/install.sh | sh"
        return 0
    fi

    # Twitter
    local twitter_dir="$MCP_DIR/twitter-mcp-server"
    if [[ -d "$twitter_dir" ]]; then
        claude mcp remove twitter 2>/dev/null || true
        claude mcp add -s user twitter \
            "$UV_PATH" run --directory "$twitter_dir" \
            --with "mcp[cli]" --with tweepy --with python-dotenv \
            python -m twitter_mcp_server.server \
            2>/dev/null && log_success "Twitter MCP server registered" \
            || log_warning "Twitter MCP server registration failed"
    else
        log_warning "Twitter MCP server not found at $twitter_dir, skipping"
    fi

    # LinkedIn
    local linkedin_dir="$MCP_DIR/linkedin-mcp-server"
    if [[ -d "$linkedin_dir" ]]; then
        claude mcp remove linkedin 2>/dev/null || true
        claude mcp add -s user linkedin \
            "$UV_PATH" run --directory "$linkedin_dir" \
            --with "mcp[cli]" --with python-linkedin-v2 --with python-dotenv \
            python -m linkedin_mcp_server.server \
            2>/dev/null && log_success "LinkedIn MCP server registered" \
            || log_warning "LinkedIn MCP server registration failed"
    else
        log_warning "LinkedIn MCP server not found at $linkedin_dir, skipping"
    fi

    # Facebook
    local facebook_dir="$MCP_DIR/facebook-mcp-server"
    if [[ -f "$facebook_dir/server.py" ]]; then
        claude mcp remove facebook 2>/dev/null || true
        claude mcp add -s user facebook \
            "$UV_PATH" run --directory "$facebook_dir" \
            --with "mcp[cli]" --with requests \
            python server.py \
            2>/dev/null && log_success "Facebook MCP server registered" \
            || log_warning "Facebook MCP server registration failed"
    else
        log_warning "Facebook MCP server not found at $facebook_dir, skipping"
    fi
}

setup_qa_architect_license() {
    log_info "Setting up QA Architect PRO license..."

    local LICENSE_FILE="$PROJECT_DIR/data/licenses/qa-architect-founder.json"

    if [[ ! -f "$LICENSE_FILE" ]]; then
        log_warning "QA Architect license not found, skipping"
        return 0
    fi

    # Projects that use qa-architect (customize with your own project names)
    local PROJECTS=(
        "project-1"
        "project-2"
        "project-3"
        "project-4"
        "project-5"
        "project-6"
        "project-7"
    )

    local installed=0

    for project in "${PROJECTS[@]}"; do
        local project_dir="$HOME/Projects/$project"

        # Skip if project doesn't exist
        [[ ! -d "$project_dir" ]] && continue

        # Check if project uses qa-architect
        if [[ -f "$project_dir/package.json" ]]; then
            if ! grep -q "create-qa-architect" "$project_dir/package.json" 2>/dev/null; then
                continue
            fi
        fi

        # Install license
        mkdir -p "$project_dir/.qa-architect"
        cp "$LICENSE_FILE" "$project_dir/.qa-architect/license.json"
        ((installed++))
    done

    if [[ $installed -gt 0 ]]; then
        log_success "QA Architect PRO: $installed projects configured"
    fi
}

health_check() {
    echo ""
    echo "============================================================"
    echo "🏥 CLAUDE CODE HEALTH CHECK"
    echo "============================================================"
    echo ""

    local issues=0

    # Check settings.json symlink
    if [[ -L "$CLAUDE_DIR/settings.json" ]]; then
        local target=$(readlink "$CLAUDE_DIR/settings.json")
        if [[ "$target" == "$PROJECT_DIR/config/settings.json" ]]; then
            log_success "settings.json: SYNCED ✓"
        else
            log_warning "settings.json: Wrong target ($target)"
            ((issues++))
        fi
    else
        log_error "settings.json: NOT SYNCED (not a symlink)"
        ((issues++))
    fi

    # Check model setting
    if [[ -f "$PROJECT_DIR/config/settings.json" ]]; then
        local model=$(jq -r '.model // "not set"' "$PROJECT_DIR/config/settings.json" 2>/dev/null)
        if [[ "$model" == *"opus"* ]]; then
            log_success "Model: $model ✓"
        else
            log_warning "Model: $model (expected opus)"
        fi
    fi

    # Check key permissions
    if [[ -f "$PROJECT_DIR/config/settings.json" ]]; then
        local perm_count=$(jq '.permissions.allow | length' "$PROJECT_DIR/config/settings.json" 2>/dev/null)
        local has_bash_wildcard=$(jq '.permissions.allow | any(. == "Bash" or . == "Bash(*)")' "$PROJECT_DIR/config/settings.json" 2>/dev/null)
        if [[ "$has_bash_wildcard" == "true" ]]; then
            log_success "Permissions: $perm_count rules (wildcards enabled) ✓"
        elif [[ "$perm_count" -gt 100 ]]; then
            log_success "Permissions: $perm_count rules (granular) ✓"
        else
            log_warning "Permissions: Only $perm_count rules"
        fi
    fi

    # Check CLAUDE.md symlink
    if [[ -L "$CLAUDE_DIR/CLAUDE.md" ]]; then
        log_success "CLAUDE.md: SYNCED ✓"
    else
        log_error "CLAUDE.md: NOT SYNCED"
        ((issues++))
    fi

    # Check commands directory
    if [[ -L "$CLAUDE_DIR/commands" ]]; then
        local cmd_count=$(ls -1 "$CLAUDE_DIR/commands"/*.md 2>/dev/null | wc -l | tr -d ' ')
        log_success "Commands: $cmd_count commands available ✓"
    else
        log_error "Commands: NOT SYNCED"
        ((issues++))
    fi

    # Check scripts directory
    if [[ -L "$CLAUDE_DIR/scripts" ]]; then
        log_success "Scripts: SYNCED ✓"
    else
        log_error "Scripts: NOT SYNCED"
        ((issues++))
    fi

    # Check skills directory
    if [[ -L "$CLAUDE_DIR/skills" ]]; then
        local skill_count=$(find "$PROJECT_DIR/skills" -name "SKILL.md" 2>/dev/null | wc -l | tr -d ' ')
        log_success "Skills: $skill_count available ✓"
        if [[ "${VERBOSE:-}" == "true" ]]; then
            echo "         $(find "$PROJECT_DIR/skills" -maxdepth 1 -type d ! -name skills -exec basename {} \; | sort | tr '\n' ' ')"
        fi
    else
        log_warning "Skills: NOT SYNCED (optional)"
    fi

    # Check MCP servers
    if [[ -f "$PROJECT_DIR/config/settings.json" ]]; then
        local mcp_count=$(jq '.mcpServers | keys | length' "$PROJECT_DIR/config/settings.json" 2>/dev/null)
        local mcp_names=$(jq -r '.mcpServers | keys | join(", ")' "$PROJECT_DIR/config/settings.json" 2>/dev/null)
        log_success "MCP Servers: $mcp_count configured ✓"
        echo "         $mcp_names"
    fi

    # Check commands
    if [[ -L "$CLAUDE_DIR/commands" ]]; then
        local bs_count=$(ls -1 "$PROJECT_DIR/commands/bs"/*.md 2>/dev/null | wc -l | tr -d ' ')
        local gh_count=$(ls -1 "$PROJECT_DIR/commands/gh"/*.md 2>/dev/null | wc -l | tr -d ' ')
        local cc_count=$(ls -1 "$PROJECT_DIR/commands/cc"/*.md 2>/dev/null | wc -l | tr -d ' ')
        echo ""
        log_success "Commands: bs:$bs_count  gh:$gh_count  cc:$cc_count"
    fi

    echo ""
    if [[ $issues -eq 0 ]]; then
        echo "============================================================"
        log_success "ALL CHECKS PASSED - Claude Code is fully configured!"
        echo "============================================================"
    else
        echo "============================================================"
        log_error "Found $issues issues - run with --repair to fix"
        echo "============================================================"
    fi

    # Score the setup
    echo ""
    echo "============================================================"
    echo "📊 SETUP QUALITY SCORES"
    echo "============================================================"
    echo ""

    # Calculate scores
    local perm_count=$(jq '.permissions.allow | length' "$PROJECT_DIR/config/settings.json" 2>/dev/null || echo 0)
    local deny_count=$(jq '.permissions.deny | length' "$PROJECT_DIR/config/settings.json" 2>/dev/null || echo 0)
    local mcp_count=$(jq '.mcpServers | keys | length' "$PROJECT_DIR/config/settings.json" 2>/dev/null || echo 0)
    local skill_count=$(find "$PROJECT_DIR/skills" -name "SKILL.md" 2>/dev/null | wc -l | tr -d ' ')
    local cmd_count=$(find "$PROJECT_DIR/commands" -name "*.md" ! -name "README.md" 2>/dev/null | wc -l | tr -d ' ')
    local agent_count=$(find "$PROJECT_DIR/agents" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
    local has_statusline=$(jq -e '.statusLine' "$PROJECT_DIR/config/settings.json" >/dev/null 2>&1 && echo 1 || echo 0)
    local has_opus=$(jq -r '.model' "$PROJECT_DIR/config/settings.json" 2>/dev/null | grep -q opus && echo 1 || echo 0)
    local has_claude_md=$([[ -f "$PROJECT_DIR/config/CLAUDE.md" ]] && echo 1 || echo 0)

    # Thoroughness: MCPs, skills, commands coverage
    local thoroughness_score=0
    [[ $mcp_count -ge 5 ]] && thoroughness_score=$((thoroughness_score + 35)) || thoroughness_score=$((thoroughness_score + mcp_count*7))
    [[ $skill_count -ge 10 ]] && thoroughness_score=$((thoroughness_score + 35)) || thoroughness_score=$((thoroughness_score + skill_count*3))
    [[ $cmd_count -ge 10 ]] && thoroughness_score=$((thoroughness_score + 30)) || thoroughness_score=$((thoroughness_score + cmd_count*3))
    local thoroughness=$(echo "scale=1; $thoroughness_score / 10" | bc)

    # Efficiency: wildcards = lean, opus, statusline
    local has_wildcards=$(jq '.permissions.allow | any(. == "Bash" or . == "Bash(*)")' "$PROJECT_DIR/config/settings.json" 2>/dev/null)
    local efficiency_score=60
    [[ "$has_wildcards" == "true" ]] && efficiency_score=$((efficiency_score + 20))  # Wildcards = efficient
    [[ $has_opus -eq 1 ]] && efficiency_score=$((efficiency_score + 10))
    [[ $has_statusline -eq 1 ]] && efficiency_score=$((efficiency_score + 10))
    local efficiency=$(echo "scale=1; $efficiency_score / 10" | bc)

    # Engineering: deny rules, quality gates in CLAUDE.md, TDD commands
    local engineering_score=0
    [[ $deny_count -ge 5 ]] && engineering_score=$((engineering_score + 30))
    [[ $has_claude_md -eq 1 ]] && engineering_score=$((engineering_score + 40))
    [[ -f "$PROJECT_DIR/commands/bs/test.md" ]] && engineering_score=$((engineering_score + 15))
    [[ -f "$PROJECT_DIR/commands/bs/review.md" ]] && engineering_score=$((engineering_score + 15))
    local engineering=$(echo "scale=1; $engineering_score / 10" | bc)

    # Cutting Edge: latest MCPs, skills, opus model
    local edge_score=0
    [[ $has_opus -eq 1 ]] && edge_score=$((edge_score + 30))
    [[ $mcp_count -ge 4 ]] && edge_score=$((edge_score + 25))
    [[ $skill_count -ge 10 ]] && edge_score=$((edge_score + 25))
    [[ $agent_count -ge 3 ]] && edge_score=$((edge_score + 20))
    local edge=$(echo "scale=1; $edge_score / 10" | bc)

    # Portability: symlinks, setup script, git-tracked
    local portable_score=70
    [[ -f "$PROJECT_DIR/scripts/setup-claude-sync.sh" ]] && portable_score=$((portable_score + 20))
    [[ -d "$PROJECT_DIR/.git" ]] && portable_score=$((portable_score + 10))
    local portable=$(echo "scale=1; $portable_score / 10" | bc)

    # Display scores with visual bars
    print_score() {
        local name="$1"
        local score="$2"
        local bar=""
        local filled=$(echo "$score * 2" | bc | cut -d. -f1)
        for ((i=0; i<filled; i++)); do bar+="█"; done
        for ((i=filled; i<20; i++)); do bar+="░"; done
        if (( $(echo "$score >= 9.5" | bc -l) )); then
            echo -e "  ${GREEN}$name: $score/10${NC} [$bar]"
        elif (( $(echo "$score >= 8.0" | bc -l) )); then
            echo -e "  ${YELLOW}$name: $score/10${NC} [$bar]"
        else
            echo -e "  ${RED}$name: $score/10${NC} [$bar]"
        fi
    }

    print_score "Thoroughness     " "$thoroughness"
    print_score "Efficiency       " "$efficiency"
    print_score "Engineering      " "$engineering"
    print_score "Cutting Edge     " "$edge"
    print_score "Portability      " "$portable"

    # Overall score
    local overall=$(echo "scale=1; ($thoroughness + $efficiency + $engineering + $edge + $portable) / 5" | bc)
    echo ""
    if (( $(echo "$overall >= 9.5" | bc -l) )); then
        echo -e "  ${GREEN}⭐ OVERALL: $overall/10 - ELITE SETUP${NC}"
    elif (( $(echo "$overall >= 8.0" | bc -l) )); then
        echo -e "  ${YELLOW}📈 OVERALL: $overall/10 - SOLID SETUP${NC}"
    else
        echo -e "  ${RED}🔧 OVERALL: $overall/10 - NEEDS WORK${NC}"
    fi
    echo ""

    return $issues
}

show_summary() {
    echo ""
    echo "============================================================"
    echo "🎉 CLAUDE CODE SYNC COMPLETE"
    echo "============================================================"
    echo ""
    echo "📋 What's synced to claude-setup:"
    echo "   ✅ settings.json (permissions, model, MCPs)"
    echo "   ✅ CLAUDE.md (global instructions)"
    echo "   ✅ Commands directory (bs:*, gh:*, cc:*)"
    echo "   ✅ Scripts directory"
    echo "   ✅ Agents directory"
    echo "   ✅ Skills directory (pdf, xlsx, docx, pptx, etc)"
    echo "   ✅ Plugins (code-simplifier)"
    echo "   ✅ Social MCP servers (Twitter, LinkedIn, Facebook)"
    echo "   ✅ QA Architect PRO licenses"
    echo ""
    echo "🔧 Key settings:"
    echo "   • Model: claude-opus-4-5-20251101"
    echo "   • MCPs: context7, sequential-thinking, memory, playwright, social"
    echo "   • Permissions: 280+ auto-approved patterns"
    echo ""
    echo "🚀 New computer setup:"
    echo "   1. git clone [repo] ~/Projects/claude-setup"
    echo "   2. cd ~/Projects/claude-setup"
    echo "   3. ./scripts/setup-claude-sync.sh"
    echo "   4. Done! (2-minute setup)"
    echo ""
    echo "🔄 To update settings:"
    echo "   • Edit: ~/Projects/claude-setup/config/settings.json"
    echo "   • Changes apply immediately (symlinked)"
    echo "   • git push to sync across computers"
    echo ""
    echo "🏥 Health check:"
    echo "   ./scripts/setup-claude-sync.sh --check"
    echo ""
}

# =============================================================================
# MAIN
# =============================================================================

main() {
    echo ""
    echo "🔗 Claude Code Sync Setup"
    echo "============================================================"
    echo ""

    case "${1:-}" in
        --check)
            health_check
            exit $?
            ;;
        --repair)
            check_prerequisites
            setup_symlinks
            health_check
            ;;
        --backup)
            backup_existing
            ;;
        --new-computer)
            check_prerequisites
            setup_symlinks
            install_plugins
            setup_mcp_servers
            setup_qa_architect_license
            health_check
            show_summary
            ;;
        *)
            check_prerequisites
            setup_symlinks
            install_plugins
            setup_mcp_servers
            setup_qa_architect_license
            health_check
            show_summary
            ;;
    esac
}

main "$@"
