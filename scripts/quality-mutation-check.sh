#!/usr/bin/env bash
# Proves that a high/critical campaign's persisted test command can turn red
# for the reviewed diff. The source worktree is never mutated: every candidate
# revert runs in a detached, short-lived worktree at the exact reviewed HEAD.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
MANIFEST=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --manifest) MANIFEST="${2:-}"; shift 2 ;;
    *) echo "usage: quality-mutation-check.sh --manifest <path>" >&2; exit 2 ;;
  esac
done

[ -n "$MANIFEST" ] || {
  echo "quality-mutation-check: --manifest is required" >&2
  exit 2
}
source "$SCRIPT_DIR/quality-repo-lease-pin.sh" || exit 1
quality_pin_repository_lease "$MANIFEST" || exit 1

ROOT="$(node "$SCRIPT_DIR/quality-invocation.js" locate "$MANIFEST")" || exit 1
TIER="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" risk.tier)"
case "$TIER" in
  low|medium)
    echo "[quality] mutation gate omitted for ${TIER} campaign"
    exit 0
    ;;
  high|critical) ;;
  *)
    echo "quality-mutation-check: risk tier must be resolved before mutation checking" >&2
    exit 1
    ;;
esac

bash "$SCRIPT_DIR/quality-assert-clean.sh" \
  --manifest "$MANIFEST" --phase "mutation check" || exit 1

BASE="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" revisions.baseSha)"
HEAD="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" revisions.currentHead)"
STATE_ROOT="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" stateRoot)"
INVOCATION_ID="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" invocationId)"
CHECK_SECONDS="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" risk.runtime.checkSeconds)"
TEST_PLAN="$(node "$SCRIPT_DIR/quality-invocation.js" gate-plan "$MANIFEST" --name test)"
TEST_EXECUTABLE="$(printf '%s' "$TEST_PLAN" | jq -r '.executable')"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/quality-mutation.XXXXXX")"
ARTIFACT="$STATE_ROOT/mutation/$HEAD.json"
MUTATION_ACTIVE=false

cleanup() {
  STATUS=$?
  if [ -d "$TEMP_ROOT/worktree" ]; then
    git -C "$ROOT" worktree remove --force "$TEMP_ROOT/worktree" >/dev/null 2>&1 || true
  fi
  rmdir "$TEMP_ROOT" >/dev/null 2>&1 || true
  if [ "$MUTATION_ACTIVE" = true ]; then
    MUTATION_ACTIVE=false
    if ! node "$SCRIPT_DIR/quality-invocation.js" mutation-complete "$MANIFEST"; then
      echo "quality-mutation-check: failed to close mutation execution budget" >&2
      STATUS=1
    fi
  fi
  trap - EXIT
  exit "$STATUS"
}
trap cleanup EXIT

printf '%s' "$TEST_PLAN" | jq -e '.args | type == "array" and all(.[]; type == "string")' >/dev/null || {
  echo "quality-mutation-check: persisted test command is invalid" >&2
  exit 1
}
TEST_ARGS=()
while IFS= read -r ARGUMENT; do
  TEST_ARGS+=("$ARGUMENT")
done < <(printf '%s' "$TEST_PLAN" | jq -r '.args[]')
MUTATION_TEST_ARGS=("${TEST_ARGS[@]}")
REPO_TEST_SCRIPT="$(git -C "$ROOT" show "$HEAD:package.json" 2>/dev/null | jq -r '.scripts.test // ""' || true)"

run_conventional_sibling_test() {
  local candidate="$1" log="$2" timeout_seconds="$3" directory stem sibling runner
  case "$REPO_TEST_SCRIPT" in
    vitest\ *|npx\ vitest\ *) runner=vitest ;;
    jest\ *|npx\ jest\ *) runner=jest ;;
    *) return 2 ;;
  esac
  directory="$(dirname "$candidate")"
  stem="$(basename "$candidate")"
  stem="${stem%.*}"
  for sibling in \
    "$directory/__tests__/$stem.test.js" \
    "$directory/__tests__/$stem.test.ts" \
    "$directory/$stem.test.js" \
    "$directory/$stem.test.ts"; do
    [ -f "$SANDBOX/$sibling" ] || continue
    SIBLING_TEST_SELECTED=true
    bash "$SCRIPT_DIR/quality-run-bounded.sh" --timeout "$timeout_seconds" -- \
      npx "$runner" run --bail=1 "$sibling" >> "$log" 2>&1
    return $?
  done
  return 2
}

run_candidate_tests() {
  local candidate="$1" log="$2" timeout_seconds="$3" plan mode command_count index executable
  local -a args=()
  local sibling_result
  SIBLING_TEST_SELECTED=false
  if run_conventional_sibling_test "$candidate" "$log" "$timeout_seconds"; then
    sibling_result=0
  else
    sibling_result=$?
  fi
  [ "$SIBLING_TEST_SELECTED" = false ] || return "$sibling_result"
  if [ -f "$SANDBOX/.buildproven/test-impact.json" ] &&
     [ -f "$SCRIPT_DIR/test-impact.js" ]; then
    # A delivery audit can still require the complete suite. A mutation proof
    # needs only the explicit behavioral test that can turn red. Prefer a
    # repository-owned mapping here so central workflow changes do not spend
    # the full mutation budget before reaching their guard test.
    plan="$(cd "$SANDBOX" && node "$SCRIPT_DIR/test-impact.js" \
      --prefer-explicit-mappings -- "$candidate" 2>> "$log")" || plan=""
    mode="$(printf '%s' "$plan" | jq -r '.mode // empty' 2>/dev/null || true)"
    command_count="$(printf '%s' "$plan" | jq -r '.commands | length' 2>/dev/null || printf 0)"
    if [ "$mode" = focused ] && [ "$command_count" -gt 0 ]; then
      for ((index = 0; index < command_count; index += 1)); do
        executable="$(printf '%s' "$plan" | jq -r ".commands[$index].executable")"
        args=()
        while IFS= read -r argument; do args+=("$argument"); done < <(
          printf '%s' "$plan" | jq -r ".commands[$index].args[]"
        )
        bash "$SCRIPT_DIR/quality-run-bounded.sh" --timeout "$timeout_seconds" -- \
          "$executable" "${args[@]}" >> "$log" 2>&1 || return $?
      done
      return 0
    fi
  fi
  bash "$SCRIPT_DIR/quality-run-bounded.sh" --timeout "$timeout_seconds" -- \
    "$TEST_EXECUTABLE" "${MUTATION_TEST_ARGS[@]}" >> "$log" 2>&1
}

# Mutation evidence needs one observed failure, not a complete failure report.
# Use the test runner's native fail-fast option when the persisted npm test
# script names a supported runner. This preserves the exact test suite while
# preventing already-red mutations from spending the full gate budget on
# unrelated long-running fixtures.
if [ "$TEST_EXECUTABLE" = npm ] &&
   [ "${TEST_ARGS[0]:-}" = run ] &&
   [ "${TEST_ARGS[1]:-}" = test ]; then
  case "$REPO_TEST_SCRIPT" in
    vitest\ *|jest\ *|npx\ vitest\ *|npx\ jest\ *)
      MUTATION_TEST_ARGS+=(-- --bail=1)
      # The mutation-check contract tests deliberately launch this script in
      # temporary fixture repositories. Including them in the mutation proof
      # would recursively launch more mutation proofs in the reviewed repo,
      # exhausting the gate budget without testing the product change.
      if [ -f "$ROOT/scripts/__tests__/quality-mutation-check.test.js" ]; then
        MUTATION_TEST_ARGS+=(--exclude scripts/__tests__/quality-mutation-check.test.js)
      fi
      ;;
    pytest|pytest\ *|python\ -m\ pytest|python\ -m\ pytest\ *|python3\ -m\ pytest|python3\ -m\ pytest\ *|uv\ run\ pytest|uv\ run\ pytest\ *|poetry\ run\ pytest|poetry\ run\ pytest\ *|pipenv\ run\ pytest|pipenv\ run\ pytest\ *)
      case "$REPO_TEST_SCRIPT" in
        *[!A-Za-z0-9_./:=,@%+[:blank:]-]*) ;;
        *)
          case " $REPO_TEST_SCRIPT " in
            *" -- "*) ;;
            *) MUTATION_TEST_ARGS+=(-- -x) ;;
          esac
          ;;
      esac
      ;;
  esac
fi

PYTEST_COMMAND=false
case "$TEST_EXECUTABLE" in
  pytest) PYTEST_COMMAND=true ;;
  uv|poetry|pipenv)
    if [ "${TEST_ARGS[0]:-}" = run ] && [ "${TEST_ARGS[1]:-}" = pytest ]; then
      PYTEST_COMMAND=true
    fi
    ;;
  python|python3)
    if [ "${TEST_ARGS[0]:-}" = -m ] && [ "${TEST_ARGS[1]:-}" = pytest ]; then
      PYTEST_COMMAND=true
    fi
    ;;
esac
if [ "$PYTEST_COMMAND" = true ]; then
  PYTEST_MUTATION_ARGS=()
  PYTEST_FAIL_FAST_INSERTED=false
  PYTEST_XDIST_ACTIVE=false
  for ARGUMENT in "${MUTATION_TEST_ARGS[@]}"; do
    [ "$ARGUMENT" = -- ] && break
    case "$ARGUMENT" in
      -n|--numprocesses|-n?*|--numprocesses=*) PYTEST_XDIST_ACTIVE=true ;;
    esac
  done
  for ARGUMENT in "${MUTATION_TEST_ARGS[@]}"; do
    if [ "$PYTEST_FAIL_FAST_INSERTED" = false ] && [ "$ARGUMENT" = -- ]; then
      if [ "$PYTEST_XDIST_ACTIVE" = true ]; then
        PYTEST_MUTATION_ARGS+=(-n 0)
      fi
      PYTEST_MUTATION_ARGS+=(-x)
      PYTEST_FAIL_FAST_INSERTED=true
    fi
    PYTEST_MUTATION_ARGS+=("$ARGUMENT")
  done
  if [ "$PYTEST_FAIL_FAST_INSERTED" = false ]; then
    if [ "$PYTEST_XDIST_ACTIVE" = true ]; then
      PYTEST_MUTATION_ARGS+=(-n 0)
    fi
    PYTEST_MUTATION_ARGS+=(-x)
  fi
  MUTATION_TEST_ARGS=("${PYTEST_MUTATION_ARGS[@]}")
fi

CANDIDATES=()
while IFS= read -r CANDIDATE; do
  CANDIDATES+=("$CANDIDATE")
done < <(
  git -C "$ROOT" diff --name-only --diff-filter=AM "$BASE..$HEAD" -- \
    | awk '
      /(^|\/)(test|tests|spec|__tests__)(\/|$)/ { next }
      /\.(js|cjs|mjs|jsx|ts|tsx|py|rb|go|java|kt|rs|c|cc|cpp|h|sh|bash|zsh)$/ { print }
    '
)

if [ "${#CANDIDATES[@]}" -eq 0 ]; then
  DIFF_RAW="$(git -C "$ROOT" diff --raw --diff-filter=AM "$BASE..$HEAD" --)"
  # `grep -c .` exits 1 on zero matches; `|| true` keeps an empty $DIFF_RAW
  # (e.g. a delete-only diff) from aborting the script under set -e.
  DIFF_ENTRY_COUNT="$(printf '%s\n' "$DIFF_RAW" | grep -c . || true)"
  GITLINK_ENTRY_COUNT="$(printf '%s\n' "$DIFF_RAW" | awk '$1 == ":160000" && $2 == "160000"' | wc -l | tr -d ' ')"
  # A diff with nothing mutable in it must record a skip rather than fail
  # closed: there is no source to revert, so no possible run could satisfy
  # the gate. Two disjoint shapes qualify, and both are reported distinctly
  # so the evidence says which one applied:
  #
  #   gitlink-skip       every entry is a submodule pointer (:160000)
  #   no-mutable-source  entries exist but none is executable source, e.g. a
  #                      dependency bump touching only package.json +
  #                      package-lock.json, or a docs/config-only change
  #
  # This is gated on CANDIDATES being empty, so it can never mask a real
  # mutation failure: when executable source did change, the gate still runs
  # and a failed run still exits non-zero below.
  # An empty CANDIDATES set is NOT sufficient on its own: the filter above
  # deliberately drops test paths, so a test-only diff also yields zero
  # candidates. Skipping on that would let a weakened test bypass the gate,
  # which previously failed closed. Recount the diff without the test
  # exclusion and require that no source file of any kind changed.
  SOURCE_ENTRY_COUNT="$(
    git -C "$ROOT" diff --name-only --diff-filter=AM "$BASE..$HEAD" -- \
      | awk '
        /\.(js|cjs|mjs|jsx|ts|tsx|py|rb|go|java|kt|rs|c|cc|cpp|h|sh|bash|zsh)$/ { print }
      ' \
      | grep -c . || true
  )"
  # When the ONLY changed source is a test, and what that test guards is a
  # config file the extension filter does not recognize (a workflow YAML, a
  # JSON policy), a behavioral check still exists: revert the config and the
  # test must go red. Promote those config files to candidates so the normal
  # revert-diff loop below proves it, instead of failing closed (BUI-511).
  #
  # Deliberately narrow. Reached only when CANDIDATES is empty (no executable
  # source changed) AND at least one changed file is a test. A diff touching
  # only tests, with no config subject, promotes nothing and still fails
  # closed — the BUI-483 review finding stays fixed.
  CHANGED_TEST_COUNT="$(
    git -C "$ROOT" diff --name-only --diff-filter=AM "$BASE..$HEAD" -- \
      | awk '/(^|\/)(test|tests|spec|__tests__)(\/|$)/ { print }' \
      | grep -c . || true
  )"
  # Dependency manifests and lockfiles are excluded. Reverting package.json
  # mid-run would change the very test command the sandbox is about to
  # execute, and a routine dependency bump that happens to touch any test file
  # would be misread as a guarded-config change. Those diffs are already
  # served by the no-mutable-source path below.
  if [ "$CHANGED_TEST_COUNT" -gt 0 ]; then
    while IFS= read -r CONFIG_CANDIDATE; do
      CANDIDATES+=("$CONFIG_CANDIDATE")
    done < <(
      git -C "$ROOT" diff --name-only --diff-filter=AM "$BASE..$HEAD" -- \
        | awk '
          /(^|\/)(test|tests|spec|__tests__)(\/|$)/ { next }
          /(^|\/)(package|package-lock|npm-shrinkwrap|composer|Cargo|Gemfile|go)\.(json|lock|toml|sum)$/ { next }
          /(^|\/)(yarn|poetry|uv|pnpm-lock|pnpm-workspace)\.(lock|toml|ya?ml)$/ { next }
          /\.(ya?ml|json|toml|ini|cfg|conf)$/ { print }
        '
    )
    if [ "${#CANDIDATES[@]}" -gt 1 ]; then
      ORDERED_CANDIDATES=()
      SELECTOR_CANDIDATE=""
      for CONFIG_CANDIDATE in "${CANDIDATES[@]}"; do
        if [ "$CONFIG_CANDIDATE" = ".buildproven/test-impact.json" ]; then
          SELECTOR_CANDIDATE="$CONFIG_CANDIDATE"
        else
          ORDERED_CANDIDATES+=("$CONFIG_CANDIDATE")
        fi
      done
      [ -z "$SELECTOR_CANDIDATE" ] || ORDERED_CANDIDATES+=("$SELECTOR_CANDIDATE")
      CANDIDATES=("${ORDERED_CANDIDATES[@]}")
    fi
  fi

  SKIP_METHOD=""
  SKIP_REASON=""
  if [ "${#CANDIDATES[@]}" -gt 0 ]; then
    # A config subject was promoted: fall through to the revert-diff loop,
    # which demands real red-capable evidence rather than recording a skip.
    :
  elif [ "$DIFF_ENTRY_COUNT" -gt 0 ] && [ "$DIFF_ENTRY_COUNT" -eq "$GITLINK_ENTRY_COUNT" ]; then
    SKIP_METHOD="gitlink-skip"
    SKIP_REASON="diff touches only submodule pointers (gitlinks), no source to mutate"
  elif [ "$DIFF_ENTRY_COUNT" -gt 0 ] && [ "$SOURCE_ENTRY_COUNT" -eq 0 ]; then
    SKIP_METHOD="no-mutable-source"
    SKIP_REASON="diff contains no source file to mutate"
  fi
  if [ -n "$SKIP_METHOD" ]; then
    mkdir -p "$(dirname "$ARTIFACT")"
    jq -n \
      --arg invocationId "$INVOCATION_ID" \
      --arg base "$BASE" \
      --arg head "$HEAD" \
      --arg tier "$TIER" \
      --arg method "$SKIP_METHOD" \
      '{schemaVersion: 1, invocationId: $invocationId, base: $base, head: $head, tier: $tier, method: $method, mutatedPaths: [], testFailureObserved: false}' \
      > "$ARTIFACT"
    # set -euo pipefail (line 5) means a non-zero exit from either call below
    # aborts the script before the success echo/exit 0 can be reached.
    node "$SCRIPT_DIR/quality-invocation.js" mutation-record "$MANIFEST" \
      --artifact "$ARTIFACT"
    bash "$SCRIPT_DIR/quality-assert-clean.sh" \
      --manifest "$MANIFEST" --phase "mutation check completion"
    echo "[quality] mutation gate omitted: $SKIP_REASON; evidence -> $ARTIFACT"
    exit 0
  fi
fi

MUTATION_AUTHORIZATION="$(
  node "$SCRIPT_DIR/quality-invocation.js" mutation-attempt "$MANIFEST"
)"
CHECK_SECONDS="$(
  printf '%s' "$MUTATION_AUTHORIZATION" | jq -er '.remainingSeconds'
)"
MUTATION_ACTIVE=true
DEADLINE=$(( $(date +%s) + CHECK_SECONDS ))

mkdir -p "$(dirname "$ARTIFACT")"
MUTATED_PATHS=()
ATTEMPTED_PATHS=()
TEST_FAILURE_OBSERVED=false
MAX_ATTEMPTS=3

complete_mutation_execution() {
  node "$SCRIPT_DIR/quality-invocation.js" mutation-complete "$MANIFEST"
  MUTATION_ACTIVE=false
}

initialize_mutation_worktree() {
  if ! git -C "$SANDBOX" submodule update --init --recursive; then
    echo "quality-mutation-check: failed to initialize committed submodules in mutation worktree" >&2
    return 1
  fi
  SUBMODULE_STATUS="$(git -C "$SANDBOX" submodule status --recursive || true)"
  if printf '%s\n' "$SUBMODULE_STATUS" | grep -Eq '^[+-U]'; then
    echo "quality-mutation-check: mutation worktree has an unready committed submodule:" >&2
    printf '%s\n' "$SUBMODULE_STATUS" >&2
    return 1
  fi
}

prepare_mutation_dependencies() {
  local log="$1" timeout_seconds="$2"
  if [ "$TEST_EXECUTABLE" = pnpm ] && [ -f "$SANDBOX/pnpm-lock.yaml" ]; then
    # pnpm binds node_modules to its workspace. Reusing the source worktree's
    # directory makes pnpm attempt an interactive purge in this detached,
    # headless worktree and can also mutate the source through the symlink.
    # Build an isolated modules tree from the already-populated pnpm store.
    bash "$SCRIPT_DIR/quality-run-bounded.sh" --timeout "$timeout_seconds" -- \
      env CI=true pnpm install --offline --frozen-lockfile >> "$log" 2>&1
    return $?
  fi
  if [ -d "$ROOT/node_modules" ] && [ ! -e "$SANDBOX/node_modules" ]; then
    ln -s "$ROOT/node_modules" "$SANDBOX/node_modules"
  fi
}

record_evidence() {
  METHOD="$1"
  jq -n \
    --arg invocationId "$INVOCATION_ID" \
    --arg base "$BASE" \
    --arg head "$HEAD" \
    --arg tier "$TIER" \
    --arg method "$METHOD" \
    --argjson mutatedPaths "$(printf '%s\n' "${MUTATED_PATHS[@]}" | jq -R . | jq -s .)" \
    '{schemaVersion: 1, invocationId: $invocationId, base: $base, head: $head, tier: $tier, method: $method, mutatedPaths: $mutatedPaths, testFailureObserved: true}' \
    > "$ARTIFACT"
  complete_mutation_execution
  node "$SCRIPT_DIR/quality-invocation.js" mutation-record "$MANIFEST" \
    --artifact "$ARTIFACT"
  bash "$SCRIPT_DIR/quality-assert-clean.sh" \
    --manifest "$MANIFEST" --phase "mutation check completion"
}

STRYKER_CONFIG=""
for CANDIDATE_CONFIG in stryker.conf.json stryker.conf.js stryker.conf.cjs; do
  if [ -f "$ROOT/$CANDIDATE_CONFIG" ] && [ -x "$ROOT/node_modules/.bin/stryker" ]; then
    STRYKER_CONFIG="$CANDIDATE_CONFIG"
    break
  fi
done
if [ -n "$STRYKER_CONFIG" ] && \
  git -C "$ROOT" show "$HEAD:package.json" | jq -e '.scripts["test:mutation"] | type == "string" and length > 0' >/dev/null; then
  MUTATED_PATHS=("$STRYKER_CONFIG")
  SANDBOX="$TEMP_ROOT/worktree"
  git -C "$ROOT" worktree add --detach --quiet "$SANDBOX" "$HEAD"
  initialize_mutation_worktree || exit 1
  LOG="$STATE_ROOT/mutation/${HEAD}.stryker.log"
  : > "$LOG"
  prepare_mutation_dependencies "$LOG" "$CHECK_SECONDS" || {
    echo "quality-mutation-check: failed to prepare isolated mutation dependencies; see $LOG" >&2
    exit 1
  }
  set +e
  cd "$SANDBOX"
  bash "$SCRIPT_DIR/quality-run-bounded.sh" --timeout "$CHECK_SECONDS" -- \
    "$TEST_EXECUTABLE" run test:mutation > "$LOG" 2>&1
  RESULT=$?
  set -e
  cd "$ROOT"
  git -C "$ROOT" worktree remove --force "$SANDBOX" >/dev/null
  if [ "$RESULT" -ne 0 ] || ! grep -qi "killed" "$LOG"; then
    echo "quality-mutation-check: revision-bound Stryker run did not prove a killed mutant; see $LOG" >&2
    exit 1
  fi
  record_evidence "stryker"
  echo "[quality] mutation evidence: Stryker -> $ARTIFACT"
  exit 0
fi

if [ "${#CANDIDATES[@]}" -eq 0 ]; then
  echo "quality-mutation-check: no changed executable source file can be reverted; add a behavioral test or declare a supported Stryker configuration" >&2
  exit 1
fi

for CANDIDATE in "${CANDIDATES[@]}"; do
  [ "${#ATTEMPTED_PATHS[@]}" -lt "$MAX_ATTEMPTS" ] || break
  REMAINING=$(( DEADLINE - $(date +%s) ))
  if [ "$REMAINING" -le 0 ]; then
    echo "quality-mutation-check: ${CHECK_SECONDS}s mutation budget exhausted before producing evidence" >&2
    exit 1
  fi

  SANDBOX="$TEMP_ROOT/worktree"
  git -C "$ROOT" worktree add --detach --quiet "$SANDBOX" "$HEAD"
  initialize_mutation_worktree || exit 1
  BASELINE_LOG="$STATE_ROOT/mutation/${HEAD}.$(basename "$CANDIDATE").baseline.log"
  : > "$BASELINE_LOG"
  prepare_mutation_dependencies "$BASELINE_LOG" "$REMAINING" || {
    echo "quality-mutation-check: failed to prepare isolated mutation dependencies; see $BASELINE_LOG" >&2
    exit 1
  }
  set +e
  cd "$SANDBOX"
  run_candidate_tests "$CANDIDATE" "$BASELINE_LOG" "$REMAINING"
  BASELINE_RESULT=$?
  set -e
  cd "$ROOT"
  if [ "$BASELINE_RESULT" -ne 0 ]; then
    git -C "$ROOT" worktree remove --force "$SANDBOX" >/dev/null
    if [ "$BASELINE_RESULT" -eq 124 ]; then
      echo "quality-mutation-check: serialized baseline test timed out; no red-capable evidence" >&2
    else
      echo "quality-mutation-check: serialized baseline test failed; no red-capable evidence" >&2
    fi
    exit 1
  fi
  if git -C "$ROOT" cat-file -e "$BASE:$CANDIDATE" 2>/dev/null; then
    git -C "$SANDBOX" restore --source "$BASE" -- "$CANDIDATE"
  else
    git -C "$SANDBOX" rm -q -- "$CANDIDATE"
  fi
  ATTEMPTED_PATHS+=("$CANDIDATE")
  LOG="$STATE_ROOT/mutation/${HEAD}.$(basename "$CANDIDATE").log"

  set +e
  cd "$SANDBOX"
  : > "$LOG"
  run_candidate_tests "$CANDIDATE" "$LOG" "$REMAINING"
  RESULT=$?
  set -e
  cd "$ROOT"
  git -C "$ROOT" worktree remove --force "$SANDBOX" >/dev/null
  if [ "$RESULT" -eq 124 ]; then
    echo "quality-mutation-check: controlled revert test timed out; a hang is not red-capable evidence" >&2
    exit 1
  fi
  if [ "$RESULT" -ne 0 ]; then
    MUTATED_PATHS=("$CANDIDATE")
    TEST_FAILURE_OBSERVED=true
    break
  fi
done

if [ "$TEST_FAILURE_OBSERVED" != true ]; then
  echo "quality-mutation-check: persisted tests remained green after ${#ATTEMPTED_PATHS[@]} controlled revert(s); no red-capable evidence" >&2
  exit 1
fi

record_evidence "revert-diff"
echo "[quality] mutation evidence: revert-diff caught by ${MUTATED_PATHS[${#MUTATED_PATHS[@]}-1]} -> $ARTIFACT"
