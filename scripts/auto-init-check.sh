#!/bin/bash
# UserPromptSubmit hook: warn once per directory if init files are missing

# Only act in git repos
if ! git -C "$PWD" rev-parse --git-dir &>/dev/null 2>&1; then
  exit 0
fi

# Only warn once per project (marker lives in .git/, never committed)
git_root=$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null)
marker="$git_root/.git/claude-init-checked"
[ -f "$marker" ] && exit 0
touch "$marker"

missing=()
[ ! -f "$PWD/CLAUDE.md" ] && missing+=("CLAUDE.md")
[ ! -f "$PWD/AGENTS.md" ] && missing+=("AGENTS.md")

# Check for pending steward findings
steward_msg=""
STATE_FILE="${SETUP_REPO:-$HOME/Projects/claude-kit}/data/steward-state.json"
if [ -f "$STATE_FILE" ]; then
  steward_msg=$(python3 -c "
import json
with open('$STATE_FILE') as f:
    s = json.load(f)
findings = s.get('findings', [])
critical = [f for f in findings if f.get('severity') in ('critical', 'error')]
if critical:
    msgs = [f['message'] for f in critical[:3]]
    print('Steward: ' + '; '.join(msgs))
" 2>/dev/null || true)
fi

[ ${#missing[@]} -eq 0 ] && [ -z "$steward_msg" ] && exit 0

reasons=()
if [ ${#missing[@]} -gt 0 ]; then
  missing_str=$(IFS=", "; echo "${missing[*]}")
  reasons+=("Missing init files in $(basename "$PWD"): ${missing_str}. Run /init to generate them.")
fi
if [ -n "$steward_msg" ]; then
  reasons+=("$steward_msg")
fi

reason_str=$(IFS=" | "; echo "${reasons[*]}")
cat <<JSON
{
  "decision": "continue",
  "reason": "⚠️  ${reason_str}"
}
JSON
