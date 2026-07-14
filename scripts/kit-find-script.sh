#!/usr/bin/env bash
# kit-find-script.sh — resolve a kit script across EVERY install layout.
#
# WHY THIS EXISTS (2026-07-10, hardened 2026-07-14): kit scripts were being
# resolved by hand-rolled candidate chains that guessed two or three paths. On
# the primary install they missed — `~/.claude/scripts` may be symlinked
# somewhere that does not carry the script — so `bash <missing>` returned 127
# after doing all the work. PR #83 then reintroduced the same class of bug in
# five more places. Never resolve a kit script by guessing paths again: source
# this file and call bs_kit_find_script, and fail loudly if it returns nothing.
#
# This file is DEPENDENCY-FREE and has NO side effects: sourcing it does not
# cd, does not read a sentinel, and does not exit. That is deliberate — callers
# like /bs:review and /bs:strategy operate on artifact paths and may legitimately
# run outside a git repo, so they must not inherit the quality skill's
# cd-to-git-root behavior (that lives in quality-load-root.sh, which sources
# this file for the resolver itself).
#
# Usage, in the SAME fenced bash block that runs the script (each Bash tool call
# is a fresh shell — a path resolved in an earlier block is gone):
#
#   for c in "${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/kit-find-script.sh}" \
#            "${CLAUDE_KIT_ROOT:+$CLAUDE_KIT_ROOT/scripts/kit-find-script.sh}" \
#            "$HOME/.claude/scripts/kit-find-script.sh" \
#            "$HOME/.claude/plugins/bs/scripts/kit-find-script.sh" \
#            "./scripts/kit-find-script.sh"; do
#     [ -n "$c" ] && [ -f "$c" ] && { . "$c"; break; }
#   done
#   RUNNER="$(bs_kit_find_script ensemble-runner.js)" \
#     || { echo "cannot locate ensemble-runner.js" >&2; exit 1; }
#   node "$RUNNER" ...
#
# Echoes the resolved absolute path and returns 0, or returns 1 (silent) so the
# caller owns the error message.

bs_kit_find_script() {
  local name="$1" c root
  # Prefer the repo the caller is actually sitting in, when there is one.
  root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  for c in \
    "${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/$name}" \
    "${CLAUDE_KIT_ROOT:+$CLAUDE_KIT_ROOT/scripts/$name}" \
    "${SETUP_REPO:+$SETUP_REPO/scripts/$name}" \
    "$HOME/.claude/scripts/$name" \
    "$HOME/.claude/plugins/bs/scripts/$name" \
    "${root:+$root/scripts/$name}" \
    "${root:+$root/core/scripts/$name}"
  do
    # `:+` (not `:-`) is load-bearing: with `:-`, an unset var expands to the
    # literal "/scripts/$name", which is non-empty, so the -n guard would never
    # reject it and the chain would silently probe the filesystem root.
    [ -n "$c" ] && [ -f "$c" ] && { printf '%s' "$c"; return 0; }
  done
  return 1
}
