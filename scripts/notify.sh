#!/usr/bin/env bash
# Cross-platform desktop notification. Usage: notify.sh "message"
#
# The Notification hooks used to call `osascript` directly. On Linux/WSL that
# binary doesn't exist, so the hook exited 127 and Claude Code surfaced a hook
# failure — on every permission prompt, every idle prompt, every agent completion.
# Loud, useless, and on by default for every non-macOS user.
#
# Notifications are a nicety. If the platform has no way to show one, say nothing
# and succeed.

set -uo pipefail

MSG="${1:-Claude Code}"
TITLE="Claude Code"

case "$(uname -s)" in
  Darwin)
    command -v osascript >/dev/null 2>&1 &&
      osascript -e "display notification \"${MSG//\"/\\\"}\" with title \"$TITLE\"" 2>/dev/null
    ;;
  Linux)
    # Covers WSL too, where notify-send may or may not be wired to the host.
    command -v notify-send >/dev/null 2>&1 &&
      notify-send "$TITLE" "$MSG" 2>/dev/null
    ;;
  *) ;; # Unknown platform: no notifier, no noise.
esac

# Never fail the hook. A missing notifier is not an error worth interrupting for.
exit 0
