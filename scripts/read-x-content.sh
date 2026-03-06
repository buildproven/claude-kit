#!/bin/bash
# read-x-content.sh — Read X Notes, threads, or any X URL via agent-browser
# Works for content that Twitter API v2 can't access (Notes, threads, etc.)
#
# Usage:
#   read-x-content.sh <url>                   # Read X Note or thread
#   read-x-content.sh --setup-from-profile    # One-time: copy auth from your Chrome profile
#                                              # (requires Chrome to be fully quit first)
#
# Auth state saved at: ~/.agent-browser/sessions/x-auth/

set -euo pipefail

AUTH_SESSION="x-auth"
CHROME_PROFILE="$HOME/Library/Application Support/Google/Chrome/Default"

if [[ "${1:-}" == "--setup-from-profile" ]]; then
  echo "=== X Auth Setup (from Chrome profile) ==="
  echo "This copies your existing X login from Chrome's profile."
  echo "Chrome must be fully quit (Cmd+Q) before running this."
  echo ""
  if lsof -c "Google Chrome" &>/dev/null; then
    echo "ERROR: Chrome is still running. Quit Chrome completely (Cmd+Q) and retry."
    exit 1
  fi
  # Launch with existing Chrome profile — Playwright reads cookies/localStorage
  AGENT_BROWSER_DEFAULT_TIMEOUT=30000 \
    agent-browser --session-name "$AUTH_SESSION" \
    --profile "$CHROME_PROFILE" \
    open https://x.com/home
  TITLE=$(agent-browser --session-name "$AUTH_SESSION" get title 2>/dev/null || echo "")
  agent-browser --session-name "$AUTH_SESSION" close 2>/dev/null || true
  if echo "$TITLE" | grep -qi "home"; then
    echo "✓ Logged in as $(echo "$TITLE" | sed 's/ \/ X//')"
    echo "✓ Auth session saved as '${AUTH_SESSION}'"
  else
    echo "✗ Not logged in (got: $TITLE). Make sure you're logged into X in Chrome."
    exit 1
  fi
  exit 0
fi

URL="${1:-}"
if [[ -z "$URL" ]] || [[ "$URL" == --* ]]; then
  echo "Usage: read-x-content.sh <x.com-url>"
  echo "       read-x-content.sh --setup-from-profile   (one-time, Chrome must be quit)"
  exit 1
fi

# Load saved auth state and open URL
agent-browser --session-name "$AUTH_SESSION" state load ~/.agent-browser/sessions/x-auth.json
agent-browser --session-name "$AUTH_SESSION" open "$URL"
agent-browser --session-name "$AUTH_SESSION" wait --load networkidle 2>/dev/null || \
  agent-browser --session-name "$AUTH_SESSION" wait 4000

# Get full text content
agent-browser --session-name "$AUTH_SESSION" get text body

agent-browser --session-name "$AUTH_SESSION" close 2>/dev/null || true
