#!/bin/bash
# Backup Social Media Auto-Posting Setup
# Creates a transferable backup for other computers

set -euo pipefail

BACKUP_DIR="$HOME/Projects/claude-kit/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="social-setup-backup-$TIMESTAMP.tar.gz"

echo "🔒 Creating Social Media Setup Backup"
echo "====================================="
echo ""

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Create temporary backup directory
TEMP_BACKUP="/tmp/social-backup-$$"
mkdir -p "$TEMP_BACKUP"

echo "📦 Collecting files..."

# Copy essential files
if [[ -f "$HOME/.claude/social-credentials.env" ]]; then
    cp "$HOME/.claude/social-credentials.env" "$TEMP_BACKUP/"
    echo "✅ Social credentials"
else
    echo "❌ No social credentials found"
    exit 1
fi

if [[ -f "$HOME/.claude/settings.json" ]]; then
    cp "$HOME/.claude/settings.json" "$TEMP_BACKUP/"
    echo "✅ Claude Code settings (with social permissions)"
else
    echo "⚠️ No Claude Code settings found"
fi

# Copy script files
cp -r "$HOME/Projects/claude-kit/scripts" "$TEMP_BACKUP/" 2>/dev/null || true
cp -r "$HOME/Projects/claude-kit/commands" "$TEMP_BACKUP/" 2>/dev/null || true
cp -r "$HOME/Projects/claude-kit/docs" "$TEMP_BACKUP/" 2>/dev/null || true

echo "✅ Scripts and documentation"

# Create info file
cat > "$TEMP_BACKUP/RESTORE_INSTRUCTIONS.md" << 'EOF'
# Social Media Auto-Posting Restore Instructions

## Quick Restore (2 minutes)
```bash
# 1. Extract this backup
tar -xzf social-setup-backup-*.tar.gz

# 2. Copy credentials
cp social-credentials.env ~/.claude/

# 3. Copy settings (adds social permissions)
cp settings.json ~/.claude/

# 4. Set proper permissions
chmod 600 ~/.claude/social-credentials.env

# 5. Test
/socials "Testing from new computer" --dry-run
```

## What's Included
- ✅ All social media API tokens and keys
- ✅ Claude Code global permissions for social posting
- ✅ All auto-posting scripts
- ✅ Setup documentation and guides
- ✅ /socials command definitions

## Security Notes
- File contains API tokens in plain text
- Store securely (password manager, encrypted drive)
- Tokens are personal account access only
- Can be regenerated anytime from social platforms

## Token Expiration
- Twitter: No expiration
- Facebook: ~60 days
- LinkedIn: ~365 days

Regenerate expired tokens using docs/SOCIAL_MEDIA_SETUP_GUIDE.md
EOF

# Create backup archive
cd "$TEMP_BACKUP"
tar -czf "$BACKUP_DIR/$BACKUP_FILE" .
cd - > /dev/null

# Cleanup
rm -rf "$TEMP_BACKUP"

echo ""
echo "🎉 Backup Complete!"
echo "📁 Location: $BACKUP_DIR/$BACKUP_FILE"
echo "📊 Size: $(ls -lh "$BACKUP_DIR/$BACKUP_FILE" | awk '{print $5}')"
echo ""
echo "🚚 Transfer to new computer:"
echo "   1. Copy this file to new computer"
echo "   2. Extract: tar -xzf $BACKUP_FILE"
echo "   3. Follow RESTORE_INSTRUCTIONS.md"
echo ""
echo "🔒 Security reminder: This contains API tokens - store securely!"