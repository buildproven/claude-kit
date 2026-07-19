#!/usr/bin/env bash
# Cross-platform desktop notification, callable from either agent runtime.
#
# Usage:
#   notify.sh "message"          # Claude Code Notification hooks
#   notify.sh turn-ended         # Codex `notify = [..., "turn-ended"]`
#   notify.sh turn-ended '{...}' # Codex, when it appends a JSON payload
#
# The Notification hooks used to call `osascript` directly. On Linux/WSL that
# binary doesn't exist, so the hook exited 127 and Claude Code surfaced a hook
# failure — on every permission prompt, every idle prompt, every agent completion.
# Loud, useless, and on by default for every non-macOS user.
#
# Notifications are a nicety. If the platform has no way to show one, say nothing
# and succeed.
#
# Tool-agnostic: Claude Code passes a human-readable message; Codex passes an
# event name (and may append a JSON payload). Both must work, because the same
# workflows run under either runtime. Unknown first args are treated as a
# message, so a new Codex event never regresses to silence.

set -uo pipefail

RAW="${1:-}"
PAYLOAD="${2:-}"
TITLE="Agent"

# Codex event names arrive as the first arg. Map the ones we know to a message
# and a runtime-specific title; anything else falls through as a literal message.
case "$RAW" in
  turn-ended|agent-turn-complete)
    TITLE="Codex"
    MSG="Turn finished"
    ;;
  session-start|session-configured)
    TITLE="Codex"
    MSG="Session started"
    ;;
  "")
    MSG="Agent needs your attention"
    ;;
  *)
    MSG="$RAW"
    ;;
esac

# Codex may append a JSON payload; surface its assistant message when present so
# the notification says what happened rather than just that something did.
if [ -n "$PAYLOAD" ] && command -v jq >/dev/null 2>&1; then
  DETAIL="$(printf '%s' "$PAYLOAD" \
    | jq -r '(.["last-assistant-message"] // .last_assistant_message // empty)' 2>/dev/null \
    | head -c 120)"
  [ -n "$DETAIL" ] && MSG="$DETAIL"
fi

case "$(uname -s)" in
  Darwin)
    command -v osascript >/dev/null 2>&1 &&
      osascript -e "display notification \"${MSG//\"/\\\"}\" with title \"${TITLE//\"/\\\"}\"" 2>/dev/null
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
