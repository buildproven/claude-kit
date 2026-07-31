#!/usr/bin/env bash
# Quality compatibility adapter over the shared workflow provider policy.

if [ -n "${BASH_VERSION:-}" ]; then
  _quality_policy_path="${BASH_SOURCE[0]}"
elif [ -n "${ZSH_VERSION:-}" ]; then
  _quality_policy_path="${(%):-%x}"
else
  _quality_policy_path="$0"
fi
_quality_policy_dir=$(cd "$(dirname "$_quality_policy_path")" && pwd)
# shellcheck source=provider-policy.sh
source "$_quality_policy_dir/provider-policy.sh"

BS_PROVIDER_ALLOW_GEMINI=1
BS_PROVIDER_PRIMARY="${BS_QUALITY_PRIMARY:-${BS_PROVIDER_PRIMARY:-}}"
BS_PROVIDER_FALLBACK="${BS_QUALITY_FALLBACK:-${BS_PROVIDER_FALLBACK:-}}"
BS_PROVIDER_CONFIG="${BS_QUALITY_PROVIDER_CONFIG:-${BS_PROVIDER_CONFIG:-$(bs_provider_default_config)}}"
if ! _quality_policy_value="$(bs_provider_load "$BS_PROVIDER_CONFIG")"; then
  return 1 2>/dev/null || exit 1
fi
read -r QUALITY_PRIMARY QUALITY_FALLBACK <<< "$_quality_policy_value"
# `auto` is validated before the invoking provider is resolved. A legal
# `auto/codex` policy can therefore become `codex/codex` at this quality-only
# boundary. That is one provider, not a fallback, and signed review evidence
# correctly rejects identical primary and fallback identities. Preserve the
# generic provider policy for other consumers and record the truthful
# single-provider quality policy here.
if [ "$QUALITY_PRIMARY" = "$QUALITY_FALLBACK" ]; then
  QUALITY_FALLBACK=none
fi
QUALITY_PROVIDER_CONFIG="$BS_PROVIDER_CONFIG"

export QUALITY_PROVIDER_CONFIG QUALITY_PRIMARY QUALITY_FALLBACK
