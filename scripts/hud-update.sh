#!/usr/bin/env bash
# hud-update.sh - Update HUD state file with atomic writes
# Usage: ./scripts/hud-update.sh --command "/bs:quality" --step "Step 2/4: code-reviewer" --cost 1.23
#
# Updates specific fields in .claude/hud-state.json for live dashboard display.
# Uses atomic writes (write to temp, then mv) to prevent corruption.

set -euo pipefail

# Find git root
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [[ -z "$GIT_ROOT" ]]; then
  echo "Error: Not in a git repository" >&2
  exit 1
fi

HUD_FILE="$GIT_ROOT/.claude/hud-state.json"
TEMP_FILE="$GIT_ROOT/.claude/hud-state.json.tmp"

# Ensure .claude directory exists
mkdir -p "$GIT_ROOT/.claude"

# Initialize HUD file if it doesn't exist
if [[ ! -f "$HUD_FILE" ]]; then
  cat > "$HUD_FILE" << 'EOF'
{
  "command": null,
  "step": null,
  "qualityScore": null,
  "costThisSession": 0,
  "testStatus": null,
  "agentStatus": "idle",
  "currentFile": null,
  "currentItem": null,
  "progress": null,
  "startedAt": null,
  "lastUpdated": null
}
EOF
fi

# Parse arguments
COMMAND=""
STEP=""
QUALITY_SCORE=""
COST=""
TESTS=""
AGENT_STATUS=""
CURRENT_FILE=""
CURRENT_ITEM=""
PROGRESS=""
RESET=false
START=false
END=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --command)
      COMMAND="$2"
      shift 2
      ;;
    --step)
      STEP="$2"
      shift 2
      ;;
    --quality|--score)
      QUALITY_SCORE="$2"
      shift 2
      ;;
    --cost)
      COST="$2"
      shift 2
      ;;
    --tests)
      TESTS="$2"
      shift 2
      ;;
    --status)
      AGENT_STATUS="$2"
      shift 2
      ;;
    --file)
      CURRENT_FILE="$2"
      shift 2
      ;;
    --item)
      CURRENT_ITEM="$2"
      shift 2
      ;;
    --progress)
      PROGRESS="$2"
      shift 2
      ;;
    --reset)
      RESET=true
      shift
      ;;
    --start)
      START=true
      shift
      ;;
    --end)
      END=true
      shift
      ;;
    -h|--help)
      cat << 'HELP'
hud-update.sh - Update HUD state for live dashboard display

Usage:
  ./scripts/hud-update.sh [options]

Options:
  --command <name>    Set current command (e.g., "/bs:quality")
  --step <text>       Set current step (e.g., "Step 2/4: code-reviewer")
  --quality <score>   Set quality score (e.g., 95)
  --cost <amount>     Set session cost (e.g., 1.23)
  --tests <status>    Set test status (e.g., "12/12")
  --status <state>    Set agent status: running, idle, blocked, completed
  --file <path>       Set current file being processed
  --item <id>         Set current backlog item (e.g., "CS-061")
  --progress <text>   Set progress indicator (e.g., "3/10 items")
  --start             Set startedAt to now, status to running
  --end               Set status to completed, clear step
  --reset             Reset all fields to defaults
  -h, --help          Show this help

Examples:
  # Start a quality run
  ./scripts/hud-update.sh --start --command "/bs:quality"

  # Update progress during execution
  ./scripts/hud-update.sh --step "Step 2/4: code-reviewer" --quality 95 --tests "12/12"

  # Update cost
  ./scripts/hud-update.sh --cost 1.23

  # End the session
  ./scripts/hud-update.sh --end

  # Reset HUD to idle state
  ./scripts/hud-update.sh --reset

Output:
  The HUD state is written to .claude/hud-state.json for reading by claude-hud.
  Example display: /bs:quality [Step 2/4: code-reviewer] | 95% | $1.23 | 12/12 tests
HELP
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Use --help for usage information" >&2
      exit 1
      ;;
  esac
done

# Build jq update expression
JQ_EXPR='. | .lastUpdated = now | todate as $now | .lastUpdated = $now'

if [[ "$RESET" == "true" ]]; then
  # Reset all fields
  JQ_EXPR='{
    "command": null,
    "step": null,
    "qualityScore": null,
    "costThisSession": 0,
    "testStatus": null,
    "agentStatus": "idle",
    "currentFile": null,
    "currentItem": null,
    "progress": null,
    "startedAt": null,
    "lastUpdated": (now | todate)
  }'
else
  # Handle --start flag
  if [[ "$START" == "true" ]]; then
    JQ_EXPR="$JQ_EXPR | .startedAt = (now | todate) | .agentStatus = \"running\""
  fi

  # Handle --end flag
  if [[ "$END" == "true" ]]; then
    JQ_EXPR="$JQ_EXPR | .agentStatus = \"completed\" | .step = null"
  fi

  # Update individual fields if provided
  if [[ -n "$COMMAND" ]]; then
    JQ_EXPR="$JQ_EXPR | .command = \"$COMMAND\""
  fi

  if [[ -n "$STEP" ]]; then
    JQ_EXPR="$JQ_EXPR | .step = \"$STEP\""
  fi

  if [[ -n "$QUALITY_SCORE" ]]; then
    JQ_EXPR="$JQ_EXPR | .qualityScore = $QUALITY_SCORE"
  fi

  if [[ -n "$COST" ]]; then
    JQ_EXPR="$JQ_EXPR | .costThisSession = $COST"
  fi

  if [[ -n "$TESTS" ]]; then
    JQ_EXPR="$JQ_EXPR | .testStatus = \"$TESTS\""
  fi

  if [[ -n "$AGENT_STATUS" ]]; then
    JQ_EXPR="$JQ_EXPR | .agentStatus = \"$AGENT_STATUS\""
  fi

  if [[ -n "$CURRENT_FILE" ]]; then
    JQ_EXPR="$JQ_EXPR | .currentFile = \"$CURRENT_FILE\""
  fi

  if [[ -n "$CURRENT_ITEM" ]]; then
    JQ_EXPR="$JQ_EXPR | .currentItem = \"$CURRENT_ITEM\""
  fi

  if [[ -n "$PROGRESS" ]]; then
    JQ_EXPR="$JQ_EXPR | .progress = \"$PROGRESS\""
  fi
fi

# Atomic write: write to temp file, then move
jq "$JQ_EXPR" "$HUD_FILE" > "$TEMP_FILE" && mv "$TEMP_FILE" "$HUD_FILE"

# Output current state for verification (optional, can be piped to /dev/null)
if [[ -t 1 ]]; then
  echo "HUD state updated:"
  jq -c '.' "$HUD_FILE"
fi
