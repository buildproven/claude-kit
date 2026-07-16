#!/usr/bin/env bash
# Persist a provider preference shared by Claude Code and Codex.
set -eu

PRIMARY=""
FALLBACK=""
CONFIG="${BS_QUALITY_PROVIDER_CONFIG:-$HOME/.claude/quality-providers.json}"
while [ $# -gt 0 ]; do
  case "$1" in
    --primary) PRIMARY="$2"; shift 2 ;;
    --fallback) FALLBACK="$2"; shift 2 ;;
    --config) CONFIG="$2"; shift 2 ;;
    *) echo "usage: quality-provider-config.sh --primary claude|codex --fallback claude|codex|none" >&2; exit 1 ;;
  esac
done
case "$PRIMARY" in claude|codex) ;; *) echo "invalid primary: $PRIMARY" >&2; exit 1 ;; esac
case "$FALLBACK" in claude|codex|none) ;; *) echo "invalid fallback: $FALLBACK" >&2; exit 1 ;; esac
[ "$PRIMARY" != "$FALLBACK" ] || { echo "primary and fallback must differ" >&2; exit 1; }

mkdir -p "$(dirname "$CONFIG")"
TMP_CONFIG="$(mktemp "$(dirname "$CONFIG")/.quality-providers.XXXXXX")"
printf '{\n  "primary": "%s",\n  "fallback": "%s"\n}\n' "$PRIMARY" "$FALLBACK" > "$TMP_CONFIG"
mv "$TMP_CONFIG" "$CONFIG"
echo "quality providers: primary=$PRIMARY fallback=$FALLBACK ($CONFIG)"
