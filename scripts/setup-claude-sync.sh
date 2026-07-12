#!/bin/bash
# =============================================================================
# setup-claude-sync.sh — symlink this repo into ~/.claude, and verify/repair it
# =============================================================================
# The kit is consumed via symlinks: ~/.claude/<dir> -> <repo>/<dir>. Hooks in
# config/settings.json resolve through $HOME/.claude/scripts/..., so `scripts`
# is load-bearing — if it is not linked, all 14 hooks silently no-op.
#
# Modes:
#   --check    verify every expected link; exit 1 if any are missing/broken
#   --repair   create or replace broken links, then re-verify
#   (no args)  same as --repair
#
# Never clobbers a real directory or a user's own file: if ~/.claude/<x> exists
# and is NOT a symlink, we warn and skip rather than delete their work.
# =============================================================================

set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; NC='\033[0m'
success() { echo -e "${GREEN}✓${NC} $1"; }
warn()    { echo -e "${YELLOW}⚠${NC} $1"; }
err()     { echo -e "${RED}✗${NC} $1"; }

# Display-only label for the config dir. Built, not written as a literal `~/...`,
# so it is unambiguously a message string and never mistaken for a path to expand.
D="$(printf '~')/.claude"

# Repo root = parent of this script's directory. Resolved from $0 so the script
# works whether invoked directly, via symlink, or from another cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

# Directories symlinked wholesale into ~/.claude/
LINK_DIRS=(commands skills agents scripts)

MODE="repair"
case "${1:-}" in
  --check)  MODE="check" ;;
  --repair) MODE="repair" ;;
  --all)    MODE="repair" ;;
  "")       MODE="repair" ;;
  *) echo "usage: $(basename "$0") [--check|--repair]" >&2; exit 2 ;;
esac

FAILURES=0

# want_link <src> <dest>
# In check mode: report only. In repair mode: create/replace the symlink.
want_link() {
  local src="$1" dest="$2" label="$3"

  if [[ ! -e "$src" ]]; then
    warn "$label: source missing in repo ($src) — skipping"
    return 0
  fi

  # Already correct?
  if [[ -L "$dest" ]] && [[ "$(readlink "$dest")" == "$src" ]]; then
    success "$label → $src"
    return 0
  fi

  # Occupied by something that is not our symlink.
  if [[ -e "$dest" && ! -L "$dest" ]]; then
    warn "$label: $dest exists and is not a symlink — leaving it alone (merge manually)"
    FAILURES=$((FAILURES + 1))
    return 0
  fi

  if [[ "$MODE" == "check" ]]; then
    err "$label: not linked (expected $dest → $src)"
    FAILURES=$((FAILURES + 1))
    return 0
  fi

  # Repair: replace a stale/broken symlink, or create a new one.
  [[ -L "$dest" ]] && rm "$dest"
  mkdir -p "$(dirname "$dest")"
  ln -s "$src" "$dest"
  success "linked $label → $src"
}

echo ""
echo "claude-kit sync (${MODE})"
echo "  repo:   $REPO_ROOT"
echo "  target: $CLAUDE_DIR"
echo "------------------------------------------------------------"

[[ "$MODE" == "repair" ]] && mkdir -p "$CLAUDE_DIR"

for dir in "${LINK_DIRS[@]}"; do
  want_link "$REPO_ROOT/$dir" "$CLAUDE_DIR/$dir" "$D/$dir"
done

# settings.json and CLAUDE.md are single files, and users are far more likely to
# have their own. Only link them if the slot is genuinely free.
for f in "settings.json:config/settings.json" "CLAUDE.md:config/CLAUDE.md"; do
  dest_name="${f%%:*}"; src_rel="${f##*:}"
  src="$REPO_ROOT/$src_rel"; dest="$CLAUDE_DIR/$dest_name"

  [[ -f "$src" ]] || continue

  if [[ -L "$dest" ]] && [[ "$(readlink "$dest")" == "$src" ]]; then
    success "$D/$dest_name → $src"
  elif [[ -e "$dest" ]]; then
    warn "$D/$dest_name exists (not ours) — skipping (merge manually if needed)"
  elif [[ "$MODE" == "check" ]]; then
    err "$D/$dest_name: not linked"
    FAILURES=$((FAILURES + 1))
  else
    ln -s "$src" "$dest"
    success "linked $D/$dest_name → $src"
  fi
done

# Hooks are the reason `scripts` must be linked. Verify they can actually resolve.
if [[ -d "$CLAUDE_DIR/scripts" ]]; then
  missing_hooks=0
  # SC2016: the single quotes are deliberate — we grep for the *literal* text
  # "$HOME/.claude/scripts/..." as it appears in settings.json, not its expansion.
  # shellcheck disable=SC2016
  hook_names="$(grep -o '\$HOME/\.claude/scripts/[a-zA-Z0-9._-]*\.sh' "$REPO_ROOT/config/settings.json" 2>/dev/null | sed 's|.*/||' | sort -u)"
  while IFS= read -r hook; do
    [[ -n "$hook" ]] || continue
    [[ -f "$CLAUDE_DIR/scripts/$hook" ]] || { err "hook script unresolvable: $D/scripts/$hook"; missing_hooks=$((missing_hooks + 1)); }
  done <<< "$hook_names"

  if [[ $missing_hooks -eq 0 ]]; then
    success "all hook scripts resolve under $D/scripts/"
  else
    FAILURES=$((FAILURES + missing_hooks))
  fi
else
  err "$D/scripts is not linked — every hook in settings.json will silently no-op"
  FAILURES=$((FAILURES + 1))
fi

echo "------------------------------------------------------------"
if [[ $FAILURES -eq 0 ]]; then
  success "claude-kit sync OK"
  exit 0
fi

if [[ "$MODE" == "check" ]]; then
  err "$FAILURES issue(s) found — run: $0 --repair"
else
  err "$FAILURES issue(s) need manual attention (see warnings above)"
fi
exit 1
