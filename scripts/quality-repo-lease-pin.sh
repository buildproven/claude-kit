#!/usr/bin/env bash
# Pin a merge campaign's repository-lease credential once per phase process.

quality_pin_repository_lease() {
  local manifest="$1" script_dir merge_requested
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  merge_requested="$(node "$script_dir/quality-invocation.js" field "$manifest" options.merge)" || return 1
  [ "$merge_requested" = true ] || return 0
  if [ -z "${BS_QUALITY_REPOSITORY_LEASE_TOKEN:-}" ]; then
    BS_QUALITY_REPOSITORY_LEASE_TOKEN="$(
      node "$script_dir/quality-invocation.js" field "$manifest" merge.repositoryLease.token
    )" || return 1
  fi
  if [ -z "$BS_QUALITY_REPOSITORY_LEASE_TOKEN" ] && \
    [ "${NODE_ENV:-}" = test ] && [ "${VITEST:-}" = true ] && \
    [ -n "${VITEST_WORKER_ID:-}" ]; then
    node "$script_dir/quality-repo-lease.js" acquire \
      --manifest "$manifest" >/dev/null || return 1
    BS_QUALITY_REPOSITORY_LEASE_TOKEN="$(
      node "$script_dir/quality-invocation.js" field \
        "$manifest" merge.repositoryLease.token
    )" || return 1
  fi
  [ -n "$BS_QUALITY_REPOSITORY_LEASE_TOKEN" ] || {
    echo "quality: merge campaign has no repository lease credential" >&2
    return 1
  }
  export BS_QUALITY_REPOSITORY_LEASE_TOKEN
  node "$script_dir/quality-repo-lease.js" verify \
    --manifest "$manifest"
}
