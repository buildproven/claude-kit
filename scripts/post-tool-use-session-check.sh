#!/bin/bash
# PostToolUse hook: session health monitoring
# Tracks tool call count — informational only, never blocks

# Never block on failure — this is informational
trap 'exit 0' ERR

# Require jq
if ! command -v jq &>/dev/null; then
  exit 0
fi

TRACKING_FILE="${HOME}/.claude/session-health.json"

# Initialize or recover corrupted tracking file
if [ ! -f "$TRACKING_FILE" ] || ! jq empty "$TRACKING_FILE" 2>/dev/null; then
  echo '{"corrections":0,"lastTool":"","toolCount":0}' > "$TRACKING_FILE"
fi

# Increment tool count (use mktemp to avoid race condition on concurrent writes)
TOOL_COUNT=$(jq '.toolCount + 1' "$TRACKING_FILE" 2>/dev/null || echo "1")
TMPFILE=$(mktemp "${TRACKING_FILE}.XXXXXX")
jq --argjson tc "$TOOL_COUNT" '.toolCount = $tc' "$TRACKING_FILE" > "$TMPFILE" 2>/dev/null && mv "$TMPFILE" "$TRACKING_FILE" || rm -f "$TMPFILE"

# Check if context is getting large (warn at 100+ tool calls)
if [ "$TOOL_COUNT" -gt 100 ]; then
  echo "SESSION HEALTH: $TOOL_COUNT tool calls. Consider /compact or /clear if context feels degraded."
fi

exit 0
