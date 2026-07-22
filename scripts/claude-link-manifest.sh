#!/usr/bin/env bash
# Shared Claude installation surface. Source this file; do not execute it.
#
# install.sh performs a first-run install and setup-claude-sync.sh verifies or
# repairs it later. Both must use this one manifest so a new surface cannot be
# added to one path and silently omitted from the other.

CLAUDE_LINK_DIRS=(commands skills agents scripts)
CLAUDE_LINK_FILES=(
  "settings.json:config/settings.json"
  "CLAUDE.md:config/CLAUDE.md"
)
