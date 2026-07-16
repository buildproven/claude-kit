#!/usr/bin/env bash
# Active-repo fleet steward: discover, audit, optionally repair via provider.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
KIT_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
CONFIG="${BS_FLEET_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/buildproven/fleet.json}"
MODE="audit"
MAX_REPOS=10
PROVIDER=""
FALLBACK=""

while [ $# -gt 0 ]; do
  case "$1" in
    audit|status) MODE="$1"; shift ;;
    fix) MODE=fix; shift ;;
    --config) CONFIG="${2:-}"; shift 2 ;;
    --max-repos) MAX_REPOS="${2:-}"; shift 2 ;;
    --provider) PROVIDER="${2:-}"; shift 2 ;;
    --fallback) FALLBACK="${2:-}"; shift 2 ;;
    *) echo "usage: orchestrate.sh [status|audit|fix] [--config path] [--max-repos N] [--provider provider] [--fallback provider]" >&2; exit 2 ;;
  esac
done
[[ "$MAX_REPOS" =~ ^[1-9][0-9]*$ ]] || { echo "invalid --max-repos" >&2; exit 2; }
[ -f "$CONFIG" ] || { echo "fleet config missing: $CONFIG" >&2; exit 2; }

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/buildproven/steward"
mkdir -p "$STATE_DIR"
DISCOVERY="$STATE_DIR/active-repos.json"
SUMMARY="$STATE_DIR/latest.json"
python3 "$SCRIPT_DIR/discover-active-repos.py" --config "$CONFIG" --output "$DISCOVERY"

if [ "$MODE" = status ]; then cat "$SUMMARY" 2>/dev/null || cat "$DISCOVERY"; exit 0; fi

repos=()
while IFS= read -r repo; do
  [ -n "$repo" ] && repos+=("$repo")
done < <(
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); [print(r.get("localPath") or "") for r in d["repositories"]]' "$DISCOVERY" |
    sed '/^$/d' |
    head -n "$MAX_REPOS"
)
results=()
fixed=0
for repo in "${repos[@]}"; do
  audit_file="$STATE_DIR/$(basename "$repo")-audit.json"
  bash "$SCRIPT_DIR/audit-repo.sh" "$repo" > "$audit_file"
  results+=("$audit_file")
  converged=$(python3 -c 'import json,sys; print(str(json.load(open(sys.argv[1]))["converged"]).lower())' "$audit_file")
  [ "$MODE" = fix ] && [ "$converged" != true ] || continue

  dirty=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["dirtyFiles"])' "$audit_file")
  ahead=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["ahead"])' "$audit_file")
  [ "$dirty" -eq 0 ] && [ "$ahead" -eq 0 ] || {
    echo "steward: refusing to repair ambiguous local work in $repo" >&2
    continue
  }

  slug="steward-$(date +%Y%m%d-%H%M%S)"
  worktree="$(dirname "$repo")/$(basename "$repo")-$slug"
  branch="codex/$slug"
  default_branch=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["defaultBranch"])' "$audit_file")
  git -C "$repo" worktree add -b "$branch" "$worktree" "origin/$default_branch"
  prompt="$STATE_DIR/$(basename "$repo")-$slug.prompt"
  cat > "$prompt" <<EOF
Repair the exact fleet-steward audit failures recorded in $audit_file for repository $worktree.
Preserve unrelated behavior. Run the repository's required checks, commit on the existing feature branch,
push, open a PR, and complete the repository's provider-neutral quality merge workflow. Never push directly
to the default branch. Return the PR URL and final verification evidence.
EOF
  args=(--prompt-file "$prompt" --target-dir "$worktree" --timeout 3600)
  [ -z "$PROVIDER" ] || args+=(--provider "$PROVIDER")
  [ -z "$FALLBACK" ] || args+=(--fallback "$FALLBACK")
  if "$KIT_ROOT/scripts/provider-run.sh" "${args[@]}" | tee "$STATE_DIR/$(basename "$repo")-$slug.result"; then
    fixed=$((fixed + 1))
  fi
done

RESULT_FILES=$(IFS=:; echo "${results[*]}") DISCOVERY="$DISCOVERY" FIXED="$fixed" SUMMARY="$SUMMARY" python3 - <<'PY'
import json, os, time
files=[p for p in os.environ["RESULT_FILES"].split(":") if p]
payload={
  "generatedAtEpoch": int(time.time()),
  "discovery": os.environ["DISCOVERY"],
  "audits": [json.load(open(p)) for p in files],
  "repairRunsSucceeded": int(os.environ["FIXED"]),
}
with open(os.environ["SUMMARY"], "w") as f:
  json.dump(payload, f, indent=2, sort_keys=True)
  f.write("\n")
print(json.dumps(payload, indent=2, sort_keys=True))
PY
