#!/usr/bin/env bash
# quality-load-root.sh — restore the git root resolved by Step -1 of the
# quality skill.
#
# WHY THIS EXISTS: each Bash tool call inside the quality skill starts a
# FRESH shell — cwd and shell vars set in one fenced bash block do NOT
# survive into the next block. Step -1 resolves the audit target (PR,
# branch, worktree, or cwd) and writes it to a sentinel file so every later
# step can recover it. Every downstream step must `source` this script (or
# inline-recompute the identical hash) before doing anything else, or it
# silently operates on the fork's raw harness cwd instead of the resolved
# target (regression 2026-05-13).
#
# The sentinel filename is namespaced by session + a hash of the resolved
# target root, so a session that runs /bs:quality against MORE THAN ONE
# repo/worktree in sequence can't have a later run read an earlier run's
# stale root (and silently gate/merge the WRONG repo).
#
# Usage: source this file. On success it leaves $GIT_ROOT set and the cwd
# changed to it. On failure it prints an error and returns/exits 1 — the
# caller does not need its own empty-string guard.
#
# Also defines bs_quality_root_file() (used by Step -1 to WRITE the sentinel,
# and by callers of quality-find-script.sh) and bs_quality_find_script()
# (resolves a kit script across every install layout).

bs_quality_root_file() {
  # $1 = resolved git root (absolute). Echoes the per-target sentinel path.
  local root="$1" sess="${CLAUDE_CODE_SESSION_ID:-default}" key
  if command -v sha256sum >/dev/null 2>&1; then
    key=$(printf '%s' "$root" | sha256sum | cut -c1-12)
  elif command -v shasum >/dev/null 2>&1; then
    key=$(printf '%s' "$root" | shasum -a 256 | cut -c1-12)
  else
    key=$(printf '%s' "$root" | cksum | tr -d ' ' | cut -c1-12)
  fi
  printf '%s/bs-quality-gitroot-%s-%s.txt' "${TMPDIR:-/tmp}" "$sess" "$key"
}

# bs_quality_find_script — resolve a kit script across EVERY install layout.
#
# Why this exists (2026-07-10): the review runner was resolved by checking
# exactly two hardcoded paths. On the primary install both missed —
# ~/.claude/scripts may be symlinked somewhere that does not carry
# claude-review-companion.sh — so `bash <missing>` returned 127 and the skill
# printed "MERGE BLOCKED (rc=127)" after doing all the work. That was the
# "runs everything, then never merges" stall. Never resolve a kit script by
# guessing two paths again: call this, and fail loudly if it returns nothing.
#
# The resolver itself now lives in kit-find-script.sh so that callers OUTSIDE
# the quality skill (/bs:review, /bs:strategy, /bs:sentry, /bs:dev) can use the
# same logic without inheriting this file's cd-to-git-root side effect. This
# function is kept as a thin alias so existing quality-skill callers are
# unchanged. One resolution contract, not two.
#
# Echoes the resolved absolute path and returns 0, or returns 1 (silent) so
# the caller owns the error message.
# Sibling candidate: kit-find-script.sh ships next to this file. ${BASH_SOURCE[0]}
# is a bashism (empty under zsh), so fall back to $0 and then to the repo root —
# this file is sourced by bash in every real path, but never trust one expansion.
_self="${BASH_SOURCE[0]:-$0}"
_sib=""
[ -n "$_self" ] && [ -f "$_self" ] && _sib="$(cd "$(dirname "$_self")" && pwd)/kit-find-script.sh"
_repo="$(git rev-parse --show-toplevel 2>/dev/null || true)"

for _c in \
  "${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/kit-find-script.sh}" \
  "${CLAUDE_KIT_ROOT:+$CLAUDE_KIT_ROOT/scripts/kit-find-script.sh}" \
  "$HOME/.claude/scripts/kit-find-script.sh" \
  "$HOME/.claude/plugins/bs/scripts/kit-find-script.sh" \
  "$_sib" \
  "${_repo:+$_repo/scripts/kit-find-script.sh}"
do
  # shellcheck source=/dev/null  # path is resolved at runtime by design
  [ -n "$_c" ] && [ -f "$_c" ] && { . "$_c"; break; }
done
unset _c _self _sib _repo

if ! command -v bs_kit_find_script >/dev/null 2>&1; then
  echo "❌ cannot locate kit-find-script.sh (claude-kit install is incomplete)" >&2
  return 1 2>/dev/null || exit 1
fi

bs_quality_find_script() { bs_kit_find_script "$@"; }

CWD_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
GIT_ROOT=""
if [ -n "$CWD_ROOT" ]; then
  GIT_ROOT="$(cat "$(bs_quality_root_file "$CWD_ROOT")" 2>/dev/null)"
  # The sentinel stores the canonical target root; if present it wins, but it
  # should equal CWD_ROOT. If absent, the cwd root IS the target (the fork is
  # already sitting in it) — use it directly rather than guessing.
  [ -n "$GIT_ROOT" ] || GIT_ROOT="$CWD_ROOT"
fi
# Empty-string guard: bash 3.2 (macOS default /bin/bash) treats `cd ""` as a
# silent no-op, defeating a `cd ... || exit` check. Verify GIT_ROOT is
# non-empty before attempting cd.
if [ -z "$GIT_ROOT" ]; then
  echo "❌ git root unresolved (no sentinel, not in a git repo)" >&2
  return 1 2>/dev/null || exit 1
fi
if ! cd "$GIT_ROOT"; then
  echo "❌ cannot enter git root: $GIT_ROOT" >&2
  return 1 2>/dev/null || exit 1
fi
