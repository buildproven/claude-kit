#!/usr/bin/env bash
# Shared provider policy for model-using workflows.

bs_provider_default_config() {
  printf '%s\n' "${XDG_CONFIG_HOME:-$HOME/.config}/buildproven/agent-providers.json"
}

bs_provider_validate() {
  local primary="$1" fallback="$2"
  case "$primary" in auto|codex|claude) ;; *) return 1 ;; esac
  case "$fallback" in none|codex|claude) ;; *) return 1 ;; esac
  [ "$primary" = auto ] || [ "$primary" != "$fallback" ]
}

bs_provider_invoker() {
  if [ -n "${CODEX_THREAD_ID:-}" ]; then
    printf 'codex\n'
  elif [ -n "${CLAUDE_CODE_SESSION_ID:-}" ] || [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then
    printf 'claude\n'
  elif command -v codex >/dev/null 2>&1; then
    printf 'codex\n'
  elif command -v claude >/dev/null 2>&1; then
    printf 'claude\n'
  else
    printf 'none\n'
  fi
}

bs_provider_load() {
  local config="${1:-${BS_PROVIDER_CONFIG:-$(bs_provider_default_config)}}"
  local legacy="${BS_QUALITY_PROVIDER_CONFIG:-$HOME/.claude/quality-providers.json}"
  local primary="${BS_PROVIDER_PRIMARY:-}" fallback="${BS_PROVIDER_FALLBACK:-}"

  if [ -z "$primary" ]; then
    if [ -f "$config" ]; then
      read -r primary fallback < <(
        python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("primary",""), d.get("fallback",""))' "$config" 2>/dev/null || true
      )
    elif [ -f "$legacy" ]; then
      read -r primary fallback < <(
        python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("primary",""), d.get("fallback",""))' "$legacy" 2>/dev/null || true
      )
    fi
  fi

  primary="${primary:-auto}"
  fallback="${fallback:-none}"
  bs_provider_validate "$primary" "$fallback" || {
    echo "invalid provider policy: primary=$primary fallback=$fallback" >&2
    return 1
  }
  if [ "$primary" = auto ]; then
    primary=$(bs_provider_invoker)
    [ "$primary" != none ] || {
      echo "no supported provider CLI is available" >&2
      return 1
    }
  fi
  printf '%s %s\n' "$primary" "$fallback"
}

bs_provider_exhausted() {
  grep -Eiq '(^|[^0-9])429([^0-9]|$)|weekly (usage )?limit|usage limit|rate.?limit|quota (exceeded|exhausted)|too many requests|try again at' "$1" 2>/dev/null
}

bs_provider_unavailable() {
  grep -Eiq 'command not found|not authenticated|not logged in|login required|setup required|no such file or directory|connection (refused|failed)|service unavailable|(^|[^0-9])5(02|03|04)([^0-9]|$)' "$1" 2>/dev/null
}
