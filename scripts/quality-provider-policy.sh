#!/usr/bin/env bash
# Quality compatibility adapter over the shared workflow provider policy.

_quality_policy_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=provider-policy.sh
source "$_quality_policy_dir/provider-policy.sh"

BS_PROVIDER_PRIMARY="${BS_QUALITY_PRIMARY:-${BS_PROVIDER_PRIMARY:-}}"
BS_PROVIDER_FALLBACK="${BS_QUALITY_FALLBACK:-${BS_PROVIDER_FALLBACK:-}}"
BS_PROVIDER_CONFIG="${BS_QUALITY_PROVIDER_CONFIG:-${BS_PROVIDER_CONFIG:-$(bs_provider_default_config)}}"
read -r QUALITY_PRIMARY QUALITY_FALLBACK < <(bs_provider_load "$BS_PROVIDER_CONFIG")
QUALITY_PROVIDER_CONFIG="$BS_PROVIDER_CONFIG"

export QUALITY_PROVIDER_CONFIG QUALITY_PRIMARY QUALITY_FALLBACK
