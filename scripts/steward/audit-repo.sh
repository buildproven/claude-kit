#!/usr/bin/env bash
# Read-only convergence audit for one local repository.
set -uo pipefail

REPO="${1:-}"
[ -d "$REPO" ] || { echo "audit-repo: repository path required" >&2; exit 2; }
REPO=$(cd "$REPO" && pwd -P)

branch=$(git -C "$REPO" branch --show-current 2>/dev/null || true)
default=main
git -C "$REPO" rev-parse --verify main >/dev/null 2>&1 || default=master
dirty_count=$(git -C "$REPO" status --porcelain=v1 2>/dev/null | wc -l | tr -d ' ')
git -C "$REPO" fetch --prune --quiet 2>/dev/null || true
counts=$(git -C "$REPO" rev-list --left-right --count "$default...origin/$default" 2>/dev/null || echo "0 0")
ahead=$(printf '%s\n' "$counts" | awk '{print $1}')
behind=$(printf '%s\n' "$counts" | awk '{print $2}')
open_prs=0
if command -v gh >/dev/null 2>&1; then
  remote=$(git -C "$REPO" remote get-url origin 2>/dev/null || true)
  slug=$(printf '%s\n' "$remote" | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')
  if [ -n "$slug" ]; then
    open_prs=$(gh pr list --repo "$slug" --state open --json number --jq length 2>/dev/null || echo 0)
  fi
fi
instruction_ok=false
if [ -f "$REPO/AGENTS.md" ] && [ -L "$REPO/CLAUDE.md" ] && [ "$(readlink "$REPO/CLAUDE.md")" = "AGENTS.md" ]; then
  instruction_ok=true
fi

checks_json="[]"
failed=0
run_npm_script() {
  local script="$1"
  local nvm_dir="${NVM_DIR:-$HOME/.nvm}"
  if [ -f "$REPO/.nvmrc" ] && [ -s "$nvm_dir/nvm.sh" ]; then
    local node_version
    node_version=$(tr -d '[:space:]' < "$REPO/.nvmrc")
    (
      cd "$REPO" || exit 1
      # shellcheck source=/dev/null
      . "$nvm_dir/nvm.sh"
      nvm exec --silent "$node_version" npm run "$script"
    )
  else
    (cd "$REPO" && npm run "$script")
  fi
}

if [ -f "$REPO/package.json" ]; then
  checks=()
  for script in lint typecheck type-check test build security:audit security:scan; do
    if node -e 'const p=require(process.argv[1]);process.exit(p.scripts&&p.scripts[process.argv[2]]?0:1)' "$REPO/package.json" "$script" 2>/dev/null; then
      log=$(mktemp "${TMPDIR:-/tmp}/steward-check.XXXXXX")
      if run_npm_script "$script" >"$log" 2>&1; then rc=0; else rc=$?; failed=$((failed + 1)); fi
      checks+=("{\"name\":\"$script\",\"exitCode\":$rc,\"log\":\"$log\"}")
    fi
  done
  if [ "${#checks[@]}" -gt 0 ]; then checks_json="[$(IFS=,; echo "${checks[*]}")]"; fi
fi

REPO="$REPO" BRANCH="$branch" DEFAULT_BRANCH="$default" DIRTY="$dirty_count" AHEAD="$ahead" BEHIND="$behind" \
OPEN_PRS="$open_prs" INSTRUCTION_OK="$instruction_ok" FAILED="$failed" CHECKS="$checks_json" python3 - <<'PY'
import json, os
print(json.dumps({
    "repo": os.environ["REPO"],
    "branch": os.environ["BRANCH"],
    "defaultBranch": os.environ["DEFAULT_BRANCH"],
    "dirtyFiles": int(os.environ["DIRTY"]),
    "ahead": int(os.environ["AHEAD"]),
    "behind": int(os.environ["BEHIND"]),
    "openPullRequests": int(os.environ["OPEN_PRS"]),
    "instructionSync": os.environ["INSTRUCTION_OK"] == "true",
    "failedChecks": int(os.environ["FAILED"]),
    "checks": json.loads(os.environ["CHECKS"]),
    "converged": (
        os.environ["BRANCH"] == os.environ["DEFAULT_BRANCH"]
        and int(os.environ["DIRTY"]) == 0
        and int(os.environ["AHEAD"]) == 0
        and int(os.environ["BEHIND"]) == 0
        and os.environ["INSTRUCTION_OK"] == "true"
        and int(os.environ["FAILED"]) == 0
    ),
}, sort_keys=True))
PY
