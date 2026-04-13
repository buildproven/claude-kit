#!/usr/bin/env bash
# PreCompact hook — backs up conversation transcript before compaction
# Keeps last 10 transcripts, rotates older ones
# Exit codes: 0 always (cannot block compaction)

set -euo pipefail

BACKUP_DIR="$HOME/.claude/transcripts"
MAX_BACKUPS=10

mkdir -p "$BACKUP_DIR"

# Read hook JSON from stdin
INPUT=$(cat)

# Extract session_id and trigger type
if command -v jq &>/dev/null; then
  SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"' 2>/dev/null)
  TRIGGER=$(echo "$INPUT" | jq -r '.trigger // "unknown"' 2>/dev/null)
else
  SESSION_ID=$(echo "$INPUT" | grep -o '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"session_id"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
  TRIGGER=$(echo "$INPUT" | grep -o '"trigger"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"trigger"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
  SESSION_ID="${SESSION_ID:-unknown}"
  TRIGGER="${TRIGGER:-unknown}"
fi

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
SHORT_SESSION="${SESSION_ID:0:12}"
BACKUP_FILE="${BACKUP_DIR}/${SHORT_SESSION}-${TIMESTAMP}.json"

# Save the full hook input as backup (contains transcript context)
echo "$INPUT" > "$BACKUP_FILE"

# Also save a metadata sidecar for quick listing
cat > "${BACKUP_FILE%.json}.meta" <<EOF
session: ${SESSION_ID}
trigger: ${TRIGGER}
timestamp: $(date -Iseconds)
cwd: $(echo "$INPUT" | jq -r '.cwd // "unknown"' 2>/dev/null || echo "unknown")
EOF

# Rotate: keep only the last MAX_BACKUPS transcripts
BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/*.json 2>/dev/null | wc -l | tr -d ' ')
if [ "$BACKUP_COUNT" -gt "$MAX_BACKUPS" ]; then
  REMOVE_COUNT=$((BACKUP_COUNT - MAX_BACKUPS))
  ls -1t "$BACKUP_DIR"/*.json 2>/dev/null | tail -n "$REMOVE_COUNT" | while read -r OLD_FILE; do
    rm -f "$OLD_FILE"
    rm -f "${OLD_FILE%.json}.meta"
  done
fi

exit 0
