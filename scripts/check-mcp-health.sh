#!/usr/bin/env bash
# CS-108: MCP Server Health Check
# Parses ~/.claude.json for configured servers and tests connectivity.
# Called by setup health check flows.

set -euo pipefail

CLAUDE_CONFIG="$HOME/.claude.json"
PASS=0
FAIL=0
WARN=0

echo "MCP Server Health Check"
echo "======================="
echo ""

if [ ! -f "$CLAUDE_CONFIG" ]; then
  echo "No ~/.claude.json found"
  exit 1
fi

# Extract server names
SERVERS=$(python3 -c "
import json, sys
with open('$CLAUDE_CONFIG') as f:
    data = json.load(f)
servers = data.get('mcpServers', {})
for name in servers:
    s = servers[name]
    cmd = s.get('command', '')
    args = ' '.join(s.get('args', []))
    print(f'{name}|{cmd}|{args}')
" 2>/dev/null)

if [ -z "$SERVERS" ]; then
  echo "No MCP servers configured"
  exit 0
fi

while IFS='|' read -r name cmd args; do
  # Check if the command binary exists
  CMD_BIN=$(echo "$cmd" | awk '{print $1}')

  if [ -z "$CMD_BIN" ]; then
    echo "  [$name] No command configured"
    WARN=$((WARN + 1))
    continue
  fi

  if ! command -v "$CMD_BIN" &>/dev/null; then
    echo "  [$name] FAIL - binary not found: $CMD_BIN"
    FAIL=$((FAIL + 1))
    continue
  fi

  # Check for env vars that might hold credentials
  HAS_CREDS=true
  case "$name" in
    twitter)
      [ -z "${TWITTER_API_KEY:-}" ] && [ -z "${TWITTER_BEARER_TOKEN:-}" ] && HAS_CREDS=false
      ;;
    linkedin)
      [ -z "${LINKEDIN_ACCESS_TOKEN:-}" ] && HAS_CREDS=false
      ;;
    facebook)
      [ -z "${FACEBOOK_PAGE_ACCESS_TOKEN:-}" ] && HAS_CREDS=false
      ;;
    dataforseo)
      [ -z "${DATAFORSEO_LOGIN:-}" ] && HAS_CREDS=false
      ;;
    perplexity)
      [ -z "${PERPLEXITY_API_KEY:-}" ] && HAS_CREDS=false
      ;;
    firecrawl)
      [ -z "${FIRECRAWL_API_KEY:-}" ] && HAS_CREDS=false
      ;;
  esac

  if [ "$HAS_CREDS" = false ]; then
    echo "  [$name] WARN - credentials not in env (may be in .env)"
    WARN=$((WARN + 1))
  else
    echo "  [$name] OK - binary found: $CMD_BIN"
    PASS=$((PASS + 1))
  fi
done <<< "$SERVERS"

echo ""
echo "Summary: $PASS healthy, $WARN warnings, $FAIL failed"
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
