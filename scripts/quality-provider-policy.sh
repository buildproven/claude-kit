#!/usr/bin/env bash
# Resolve the quality reviewer policy for both Claude Code and Codex.
# Precedence: environment > user config > backwards-compatible defaults.

QUALITY_PROVIDER_CONFIG="${BS_QUALITY_PROVIDER_CONFIG:-$HOME/.claude/quality-providers.json}"
QUALITY_PRIMARY="${BS_QUALITY_PRIMARY:-}"
QUALITY_FALLBACK="${BS_QUALITY_FALLBACK:-}"

if [ -f "$QUALITY_PROVIDER_CONFIG" ]; then
  if command -v jq >/dev/null 2>&1; then
    [ -n "$QUALITY_PRIMARY" ] || QUALITY_PRIMARY="$(jq -r '.primary // empty' "$QUALITY_PROVIDER_CONFIG" 2>/dev/null)"
    [ -n "$QUALITY_FALLBACK" ] || QUALITY_FALLBACK="$(jq -r '.fallback // empty' "$QUALITY_PROVIDER_CONFIG" 2>/dev/null)"
  elif command -v node >/dev/null 2>&1; then
    _quality_policy="$(node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(`${p.primary||""}\n${p.fallback||""}`)' "$QUALITY_PROVIDER_CONFIG" 2>/dev/null)"
    [ -n "$QUALITY_PRIMARY" ] || QUALITY_PRIMARY="$(printf '%s\n' "$_quality_policy" | sed -n '1p')"
    [ -n "$QUALITY_FALLBACK" ] || QUALITY_FALLBACK="$(printf '%s\n' "$_quality_policy" | sed -n '2p')"
  fi
fi

QUALITY_PRIMARY="${QUALITY_PRIMARY:-claude}"
QUALITY_FALLBACK="${QUALITY_FALLBACK:-codex}"

case "$QUALITY_PRIMARY" in claude|codex) ;; *) echo "quality: invalid primary provider '$QUALITY_PRIMARY'" >&2; return 1 2>/dev/null || exit 1 ;; esac
case "$QUALITY_FALLBACK" in claude|codex|none) ;; *) echo "quality: invalid fallback provider '$QUALITY_FALLBACK'" >&2; return 1 2>/dev/null || exit 1 ;; esac
if [ "$QUALITY_PRIMARY" = "$QUALITY_FALLBACK" ]; then
  echo "quality: primary and fallback must differ" >&2
  return 1 2>/dev/null || exit 1
fi

export QUALITY_PROVIDER_CONFIG QUALITY_PRIMARY QUALITY_FALLBACK
