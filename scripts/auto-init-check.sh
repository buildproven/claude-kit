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

[ ${#missing[@]} -eq 0 ] && exit 0

missing_str=$(IFS=", "; echo "${missing[*]}")
cat <<JSON
{
  "decision": "continue",
  "reason": "⚠️  Missing init files in $(basename $PWD): ${missing_str}. Run /init to generate them."
}
JSON
