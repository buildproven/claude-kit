#!/usr/bin/env bash
# codex-check.sh — Verify Codex CLI is using ChatGPT subscription, not API billing
#
# Usage: ./codex-check.sh
# Checks:
#   1. Auth mode (chatgpt vs apikey)
#   2. OPENAI_API_KEY env status
#   3. Codex CLI version
#   4. Native skills, temporary command adapters, AGENTS, and capability inventory
#   5. Session count from local history (past 30 days)

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✅${NC}  $*"; }
warn() { echo -e "${YELLOW}⚠️ ${NC}  $*"; }
fail() { echo -e "${RED}❌${NC}  $*"; }

echo "── Codex CLI Health Check ───────────────────────────────────────"
echo

HEALTH_OK=true

# 1. Auth mode
AUTH_FILE="${HOME}/.codex/auth.json"
if [[ -f "${AUTH_FILE}" ]]; then
    AUTH_MODE=$(python3 -c "import json; d=json.load(open('${AUTH_FILE}')); print(d.get('auth_mode','unknown'))" 2>/dev/null || echo "unreadable")
    if [[ "${AUTH_MODE}" == "chatgpt" ]]; then
        ok "Auth mode: chatgpt (ChatGPT subscription — no API billing)"
    elif [[ "${AUTH_MODE}" == "apikey" ]]; then
        fail "Auth mode: apikey — YOU ARE BEING BILLED. Run: codex login"
        HEALTH_OK=false
    else
        warn "Auth mode: ${AUTH_MODE} (unexpected)"
        HEALTH_OK=false
    fi
else
    warn "Auth mode: ~/.codex/auth.json not found — not authenticated"
    HEALTH_OK=false
fi

# 2. codex login status
if command -v codex >/dev/null 2>&1; then
    LOGIN_STATUS=$(codex login status 2>&1 || echo "error")
    if echo "${LOGIN_STATUS}" | grep -qi "chatgpt"; then
        ok "Login status: ${LOGIN_STATUS}"
    elif echo "${LOGIN_STATUS}" | grep -qi "api key"; then
        fail "Login status: ${LOGIN_STATUS} — run: codex login"
        HEALTH_OK=false
    else
        warn "Login status: ${LOGIN_STATUS}"
        HEALTH_OK=false
    fi
    CODEX_VERSION=$(codex --version 2>/dev/null || echo "unknown")
    ok "Codex version: ${CODEX_VERSION}"
else
    warn "Codex CLI not found in PATH"
    HEALTH_OK=false
fi

# 3. OPENAI_API_KEY env check
if [[ -n "${OPENAI_API_KEY:-}" ]]; then
    warn "OPENAI_API_KEY is set in current environment"
    echo "      (This is fine as long as auth_mode=chatgpt — Codex prefers session tokens)"
    echo "      Key source hint: check .env in your overlay/project root"
else
    ok "OPENAI_API_KEY: not set in current environment"
fi

# 4. Prompt + AGENTS freshness
#
# PROJECT_DIR must resolve to the OVERLAY root (wherever install.sh's project
# lives), not to wherever this specific copy of the script happens to be
# checked out (core/scripts/ in the kit vs scripts/ in a private overlay).
# install.sh symlinks each script file individually into ~/.claude/scripts/,
# so resolving THIS running script's own symlink target — not a directory
# symlink — gets back to the real overlay root regardless of which layer
# shipped it. Fall back to $BASH_SOURCE for a non-installed/dev checkout.
CODEX_CHECK_REAL_PATH="$(readlink -f "${HOME}/.claude/scripts/codex-check.sh" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "$CODEX_CHECK_REAL_PATH")/.." && pwd)}"
SYNC_SCRIPT="$PROJECT_DIR/scripts/sync-codex-prompts.sh"
CODEX_AGENTS="${HOME}/.codex/AGENTS.md"
CODEX_MANIFEST="${HOME}/.codex/.sync-codex-prompts-managed"
CODEX_SKILL_MANIFEST="${HOME}/.agents/skills/.buildproven-managed"

echo
echo "── Codex Surface ───────────────────────────────────────────────"

if [[ -x "$SYNC_SCRIPT" || -f "$SYNC_SCRIPT" ]]; then
    if bash "$SYNC_SCRIPT" --check >/tmp/codex-sync-check.$$ 2>&1; then
        ok "Temporary command adapters: up to date"
    else
        warn "Temporary command adapters: drift detected"
        sed 's/^/      /' /tmp/codex-sync-check.$$ | tail -n 12
        HEALTH_OK=false
    fi
    rm -f /tmp/codex-sync-check.$$
else
    warn "Prompt sync script missing: $SYNC_SCRIPT"
    HEALTH_OK=false
fi

if [[ -L "$CODEX_AGENTS" ]]; then
    if [[ "$(readlink "$CODEX_AGENTS")" == "$PROJECT_DIR/config/CLAUDE.md" ]]; then
        ok "AGENTS.md is the canonical CLAUDE.md"
    else
        warn "AGENTS.md points to a non-canonical instruction source"
        HEALTH_OK=false
    fi
else
    warn "~/.codex/AGENTS.md is not a canonical symlink"
    HEALTH_OK=false
fi

if [[ -f "$CODEX_SKILL_MANIFEST" ]]; then
    NATIVE_SKILLS=$(wc -l < "$CODEX_SKILL_MANIFEST" | tr -d ' ')
    ok "Native Codex skills: ${NATIVE_SKILLS} managed"
else
    warn "Native Codex skill manifest missing"
    HEALTH_OK=false
fi

if bash "$PROJECT_DIR/scripts/setup-codex-plugin-profile.sh" --profile default --check >/tmp/codex-plugin-check.$$ 2>&1; then
    ok "Codex plugins: lean default active"
else
    warn "Codex plugins: drift detected"
    sed 's/^/      /' /tmp/codex-plugin-check.$$ | tail -n 16
    HEALTH_OK=false
fi
rm -f /tmp/codex-plugin-check.$$

if [[ -f "$CODEX_MANIFEST" ]]; then
    TOTAL_PROMPTS=$(wc -l < "$CODEX_MANIFEST" | tr -d ' ')
    COMMAND_PROMPTS=$(grep -Ec '^(bs|gh|cc)-|^(debug|refactor|update-claudemd)\.md$' "$CODEX_MANIFEST" || true)
    SKILL_PROMPTS=$(grep -Ec '^skill-.*\.md$' "$CODEX_MANIFEST" || true)
    if [[ "$SKILL_PROMPTS" -gt 0 ]]; then
        fail "Deprecated skill prompt copies remain: ${SKILL_PROMPTS}"
        HEALTH_OK=false
    else
        ok "Legacy adapter inventory: ${TOTAL_PROMPTS} commands, 0 duplicated skills"
    fi
else
    warn "Prompt inventory manifest missing: $CODEX_MANIFEST"
    HEALTH_OK=false
fi

if bash "$PROJECT_DIR/scripts/setup-mcp-parity.sh" --profile default --check >/tmp/codex-mcp-check.$$ 2>&1; then
    ok "MCP profile: lean default active"
else
    warn "MCP profile: drift detected"
    sed 's/^/      /' /tmp/codex-mcp-check.$$ | tail -n 16
    HEALTH_OK=false
fi
rm -f /tmp/codex-mcp-check.$$

# 5. Session activity — past 30 days
SESSIONS_BASE="${HOME}/.codex/sessions"
if [[ -d "${SESSIONS_BASE}" ]]; then
    COUNT=$(find "${SESSIONS_BASE}" -name "rollout-*.jsonl" -newer "${SESSIONS_BASE}" -mtime -30 2>/dev/null | wc -l | tr -d ' ')
    echo
    echo "── Recent Activity (last 30 days) ──────────────────────────────"
    echo "   Sessions: ${COUNT}"

    # Cost estimate for the past 30 days
    python3 << 'PYEOF'
import json, os, glob, datetime

base = os.path.expanduser("~/.codex/sessions")
cutoff = datetime.datetime.now() - datetime.timedelta(days=30)
total_cost = 0
session_count = 0

for f in glob.glob(f"{base}/*/*/*/rollout-*.jsonl"):
    mtime = datetime.datetime.fromtimestamp(os.path.getmtime(f))
    if mtime < cutoff:
        continue
    session_count += 1
    last = None
    with open(f) as fh:
        for line in fh:
            try:
                d = json.loads(line)
                if d.get('type') == 'event_msg' and d.get('payload',{}).get('type') == 'token_count':
                    last = d['payload']['info']['total_token_usage']
            except: pass
    if last:
        inp = last.get('input_tokens', 0)
        cached = last.get('cached_input_tokens', 0)
        out = last.get('output_tokens', 0)
        total_cost += ((inp - cached) * 2.50 / 1e6) + (out * 10.0 / 1e6)

print(f"   Sessions w/ token data: {session_count}")
print(f"   Est. API cost if billed: ${total_cost:.2f}")
print(f"   Est. subscription cost:  $0.00 (ChatGPT Plus flat rate)")
PYEOF
fi

echo
echo "── Summary ─────────────────────────────────────────────────────"
if [[ "$HEALTH_OK" == true ]]; then
    ok "Codex auth, instructions, native skills, command adapters, and lean capability profile are healthy"
else
    fail "Codex setup needs attention — see warnings above"
fi
