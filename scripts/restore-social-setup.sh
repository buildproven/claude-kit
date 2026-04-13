#!/bin/bash
# =============================================================================
# Restore Social Media Setup - Import credentials from another computer
# =============================================================================
# Part of claude-kit - portable Claude Code configuration
#
# Usage:
#   ./scripts/restore-social-setup.sh                     # Interactive mode
#   ./scripts/restore-social-setup.sh backup.tar.gz       # From backup archive
#   ./scripts/restore-social-setup.sh --from-env file.env # From env file only
#   ./scripts/restore-social-setup.sh --scp user@host     # Pull via SCP
# =============================================================================

set -euo pipefail

PROJECT_DIR="$HOME/Projects/claude-kit"
CREDENTIALS_FILE="$PROJECT_DIR/config/social-credentials.env"
CLAUDE_DIR="$HOME/.claude"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; }

# =============================================================================
# FUNCTIONS
# =============================================================================

check_existing() {
    if [[ -f "$CREDENTIALS_FILE" ]]; then
        log_warning "Existing credentials found at: $CREDENTIALS_FILE"
        echo ""
        echo "Options:"
        echo "  1) Overwrite with new credentials"
        echo "  2) Backup existing and restore new"
        echo "  3) Cancel"
        echo ""
        read -p "Choose [1-3]: " choice
        case $choice in
            1)
                log_info "Will overwrite existing credentials"
                ;;
            2)
                backup_existing
                ;;
            *)
                log_info "Cancelled"
                exit 0
                ;;
        esac
    fi
}

backup_existing() {
    local backup_name="social-credentials.env.backup.$(date +%Y%m%d_%H%M%S)"
    cp "$CREDENTIALS_FILE" "$PROJECT_DIR/config/$backup_name"
    log_success "Backed up existing credentials to: config/$backup_name"
}

restore_from_archive() {
    local archive="$1"

    if [[ ! -f "$archive" ]]; then
        log_error "Archive not found: $archive"
        exit 1
    fi

    log_info "Extracting from archive: $archive"

    local temp_dir="/tmp/social-restore-$$"
    mkdir -p "$temp_dir"

    tar -xzf "$archive" -C "$temp_dir"

    if [[ -f "$temp_dir/social-credentials.env" ]]; then
        cp "$temp_dir/social-credentials.env" "$CREDENTIALS_FILE"
        chmod 600 "$CREDENTIALS_FILE"
        log_success "Credentials restored from archive"
    else
        log_error "No social-credentials.env found in archive"
        rm -rf "$temp_dir"
        exit 1
    fi

    rm -rf "$temp_dir"
}

restore_from_env() {
    local env_file="$1"

    if [[ ! -f "$env_file" ]]; then
        log_error "File not found: $env_file"
        exit 1
    fi

    log_info "Copying credentials from: $env_file"
    cp "$env_file" "$CREDENTIALS_FILE"
    chmod 600 "$CREDENTIALS_FILE"
    log_success "Credentials copied"
}

restore_from_scp() {
    local remote="$1"

    log_info "Pulling credentials from: $remote"

    # Try common locations
    local remote_paths=(
        "Projects/claude-kit/config/social-credentials.env"
        ".claude/social-credentials.env"
    )

    for path in "${remote_paths[@]}"; do
        log_info "Trying: $remote:~/$path"
        if scp "$remote:~/$path" "$CREDENTIALS_FILE" 2>/dev/null; then
            chmod 600 "$CREDENTIALS_FILE"
            log_success "Credentials pulled from $remote:~/$path"
            return 0
        fi
    done

    log_error "Could not find credentials on remote host"
    echo ""
    echo "Try specifying the exact path:"
    echo "  scp $remote:/path/to/social-credentials.env $CREDENTIALS_FILE"
    exit 1
}

setup_symlink() {
    log_info "Setting up symlink..."

    mkdir -p "$CLAUDE_DIR"

    if [[ -e "$CLAUDE_DIR/social-credentials.env" || -L "$CLAUDE_DIR/social-credentials.env" ]]; then
        rm -f "$CLAUDE_DIR/social-credentials.env"
    fi

    ln -s "$CREDENTIALS_FILE" "$CLAUDE_DIR/social-credentials.env"
    log_success "Symlink created: ~/.claude/social-credentials.env → claude-kit"
}

verify_credentials() {
    log_info "Verifying credentials..."
    echo ""

    local platforms=0

    if grep -q "TWITTER_API_KEY" "$CREDENTIALS_FILE" 2>/dev/null; then
        log_success "Twitter credentials found"
        ((platforms++))
    fi

    if grep -q "FACEBOOK_ACCESS_TOKEN" "$CREDENTIALS_FILE" 2>/dev/null; then
        log_success "Facebook credentials found"
        ((platforms++))
    fi

    if grep -q "LINKEDIN_ACCESS_TOKEN" "$CREDENTIALS_FILE" 2>/dev/null; then
        log_success "LinkedIn credentials found"
        ((platforms++))
    fi

    echo ""
    log_success "Found credentials for $platforms platform(s)"
}

interactive_restore() {
    echo ""
    echo "============================================================"
    echo "🔄 RESTORE SOCIAL MEDIA CREDENTIALS"
    echo "============================================================"
    echo ""
    echo "How would you like to import credentials?"
    echo ""
    echo "  1) From backup archive (social-setup-backup-*.tar.gz)"
    echo "  2) From .env file"
    echo "  3) Pull from another computer via SCP"
    echo "  4) Paste credentials manually"
    echo "  5) Cancel"
    echo ""
    read -p "Choose [1-5]: " choice

    case $choice in
        1)
            echo ""
            echo "Available backups:"
            ls -1 "$PROJECT_DIR/backups/"*.tar.gz 2>/dev/null || echo "  (none found in $PROJECT_DIR/backups/)"
            echo ""
            read -p "Enter path to backup archive: " archive_path
            restore_from_archive "$archive_path"
            ;;
        2)
            read -p "Enter path to .env file: " env_path
            restore_from_env "$env_path"
            ;;
        3)
            read -p "Enter remote host (user@hostname): " remote_host
            restore_from_scp "$remote_host"
            ;;
        4)
            manual_paste
            ;;
        *)
            log_info "Cancelled"
            exit 0
            ;;
    esac
}

manual_paste() {
    echo ""
    echo "Paste your credentials below (press Ctrl+D when done):"
    echo "---"
    cat > "$CREDENTIALS_FILE"
    chmod 600 "$CREDENTIALS_FILE"
    log_success "Credentials saved"
}

show_summary() {
    echo ""
    echo "============================================================"
    echo "🎉 SOCIAL CREDENTIALS RESTORED"
    echo "============================================================"
    echo ""
    echo "📁 Credentials location:"
    echo "   $CREDENTIALS_FILE"
    echo ""
    echo "🔗 Symlinked to:"
    echo "   ~/.claude/social-credentials.env"
    echo ""
    echo "🧪 Test your setup:"
    echo "   /socials \"Testing from new computer\" --dry-run"
    echo ""
    echo "📋 If tokens expired, regenerate specific platforms:"
    echo "   - Twitter: No expiration"
    echo "   - Facebook: ~60 days (regenerate at developers.facebook.com)"
    echo "   - LinkedIn: ~365 days (regenerate at linkedin.com/developers)"
    echo ""
}

# =============================================================================
# MAIN
# =============================================================================

main() {
    echo ""
    echo "🔄 Social Media Credentials Restore"
    echo "============================================================"
    echo ""

    case "${1:-}" in
        --from-env)
            if [[ -z "${2:-}" ]]; then
                log_error "Please specify env file path"
                exit 1
            fi
            check_existing
            restore_from_env "$2"
            setup_symlink
            verify_credentials
            show_summary
            ;;
        --scp)
            if [[ -z "${2:-}" ]]; then
                log_error "Please specify remote host (user@hostname)"
                exit 1
            fi
            check_existing
            restore_from_scp "$2"
            setup_symlink
            verify_credentials
            show_summary
            ;;
        *.tar.gz)
            check_existing
            restore_from_archive "$1"
            setup_symlink
            verify_credentials
            show_summary
            ;;
        "")
            check_existing
            interactive_restore
            setup_symlink
            verify_credentials
            show_summary
            ;;
        *)
            echo "Usage:"
            echo "  ./restore-social-setup.sh                     # Interactive mode"
            echo "  ./restore-social-setup.sh backup.tar.gz       # From backup archive"
            echo "  ./restore-social-setup.sh --from-env file.env # From env file"
            echo "  ./restore-social-setup.sh --scp user@host     # Pull via SCP"
            exit 1
            ;;
    esac
}

main "$@"
