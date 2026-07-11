#!/usr/bin/env bash
# test-ralph-next.sh — Reliability checks for scripts/ralph-next-run.sh
#
# Architecture: each test scenario builds an ephemeral git repo in /tmp with
# its own synthetic BACKLOG.md fixture, then runs the runner from that cwd.
# This isolates tests from the live repo and lets us cover both legacy
# (BACKLOG.md present) and Linear-mode (BACKLOG.md absent) code paths
# without mutating the developer's working tree.
#
# Test fixtures live in `$TEST_FIXTURE_ROOT` (default: a per-run mktemp
# directory). Each scenario gets its own subdirectory so failures don't
# cross-contaminate.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNNER="$ROOT/scripts/ralph-next-run.sh"

PASS=0
FAIL=0
TEST_FIXTURE_ROOT="$(mktemp -d -t ralph-next-tests.XXXXXX)"

log() { echo "[test-ralph-next] $*"; }
pass() { PASS=$((PASS + 1)); log "PASS: $*"; }
fail() { FAIL=$((FAIL + 1)); log "FAIL: $*"; }

# Idempotent cleanup. Per CLAUDE.md filesystem-safety rule we do NOT call
# `rm -rf` on a path resolved through a variable — even one that came from
# `mktemp -d`, because trap-time evaluation could in principle see a
# clobbered TEST_FIXTURE_ROOT. Instead, walk + delete with `find -delete`
# (which only descends into the named root) and then `rmdir` the empty
# parent. The non-empty + isdir guards cover normal early-exit paths.
cleanup_fixtures() {
    if [[ -n "${TEST_FIXTURE_ROOT:-}" && -d "$TEST_FIXTURE_ROOT" ]]; then
        find "$TEST_FIXTURE_ROOT" -mindepth 1 -delete 2>/dev/null || true
        rmdir "$TEST_FIXTURE_ROOT" 2>/dev/null || true
    fi
}
trap cleanup_fixtures EXIT

# Build a fresh ephemeral git repo with a synthetic BACKLOG.md.
# Echoes the absolute repo path. Caller cd's into it for runner invocations.
make_fixture_repo() {
    local label="$1"
    local repo="$TEST_FIXTURE_ROOT/$label"

    mkdir -p "$repo"
    (
        cd "$repo"
        git init -q -b main
        git config user.email "test@ralph-next.local"
        git config user.name "test"
        # commit signing off in test env can prompt — disable.
        git config commit.gpgsign false
        # Seed file so we have a real commit, then add the backlog fixture.
        echo "fixture" > .gitkeep
        cat > BACKLOG.md <<'BACKLOG_EOF'
# Test Backlog

## High Value

| ID     | Description       | Type    | Status  | Effort | Score | Status  |
| ------ | ----------------- | ------- | ------- | ------ | ----- | ------- |
| TST-1  | First test item   | feature | -       | S      | 0.9   | pending |
| TST-2  | Second test item  | bug     | -       | M      | 0.8   | pending |
| TST-3  | Third test item   | feature | -       | S      | 0.7   | pending |
| TST-4  | Fourth test item  | bug     | -       | M      | 0.6   | pending |
| TST-5  | Fifth test item   | feature | -       | S      | 0.5   | pending |
| TST-6  | Sixth test item   | bug     | -       | M      | 0.4   | pending |
| TST-7  | Seventh test item | feature | -       | S      | 0.3   | pending |

## Completed

| ID  | Description | Type | Completed |
| --- | ----------- | ---- | --------- |
BACKLOG_EOF
        git add -A
        git commit -q -m "init test fixture"
    )

    echo "$repo"
}

# Build an ephemeral git repo WITHOUT a BACKLOG.md — Linear-mode test fixture.
make_linear_only_repo() {
    local label="$1"
    local repo="$TEST_FIXTURE_ROOT/$label"

    mkdir -p "$repo"
    (
        cd "$repo"
        git init -q -b main
        git config user.email "test@ralph-next.local"
        git config user.name "test"
        git config commit.gpgsign false
        echo "linear-only fixture" > README.md
        git add -A
        git commit -q -m "init Linear-only fixture"
    )

    echo "$repo"
}

assert_file_exists() {
    [[ -f "$1" ]]
}

assert_jq_eq() {
    local file="$1" query="$2" expected="$3"
    local actual
    actual="$(jq -r "$query" "$file")"
    [[ "$actual" == "$expected" ]]
}

# ---- Legacy-mode tests (BACKLOG.md fixture present) ----

run_test_dry_run() {
    local repo
    repo="$(make_fixture_repo dry-run)"
    local output
    output="$(cd "$repo" && bash "$RUNNER" --dry-run --until "2 items" --evidence-dir ".claude/evidence" 2>&1)"
    if grep -q "Dry run - selected" <<< "$output" && grep -Eq "TST-[0-9]+" <<< "$output"; then
        pass "dry-run selects backlog items"
    else
        fail "dry-run output missing expected selection"
        echo "$output"
    fi
}

run_test_pass_path() {
    local repo
    repo="$(make_fixture_repo pass-path)"
    local rel=".claude/evidence"
    local state="$repo/$rel/state.json"
    local item="TST-1"
    local evidence="$repo/$rel/evidence/${item}.json"
    local quality_evidence="$repo/$rel/quality-${item}.json"

    (cd "$repo" && bash "$RUNNER" --until "item:$item" --evidence-dir "$rel") \
        > "$TEST_FIXTURE_ROOT/pass-path.log" 2>&1

    # Verify state.json + evidence + the BACKLOG.md mutation (the item should
    # be removed from the active section and appear under ## Completed). The
    # awk-based mover only inserts the completed row when it sees a `| --- |`
    # divider in the Completed section, so this assertion is what would have
    # caught a fixture missing that header.
    if assert_file_exists "$state" \
        && assert_file_exists "$evidence" \
        && assert_file_exists "$quality_evidence" \
        && assert_jq_eq "$state" ".items[\"$item\"].status" 'completed' \
        && assert_jq_eq "$state" ".items[\"$item\"].decision" 'pass' \
        && grep -A 999 '^## Completed' "$repo/BACKLOG.md" | grep -qE "^\| $item \|"; then
        pass "pass path writes completed state, evidence, quality evidence, and moves item to Completed"
    else
        fail "pass path assertions failed"
        cat "$TEST_FIXTURE_ROOT/pass-path.log"
        echo "--- fixture BACKLOG.md ---"
        cat "$repo/BACKLOG.md"
    fi
}

run_test_compact_signal() {
    local repo
    repo="$(make_fixture_repo compact)"
    local item="TST-1"
    local output
    output="$(cd "$repo" && bash "$RUNNER" --until "item:$item" --evidence-dir ".claude/evidence" 2>&1)"

    if grep -q "COMPACT_SIGNAL" <<< "$output"; then
        pass "compact signal emitted after completed item"
    else
        fail "compact signal missing from output after completed item"
        echo "$output"
    fi
}

run_test_no_compact_flag() {
    local repo
    repo="$(make_fixture_repo no-compact)"
    local item="TST-1"
    local output
    output="$(cd "$repo" && bash "$RUNNER" --until "item:$item" --no-compact --evidence-dir ".claude/evidence" 2>&1)"

    if ! grep -q "COMPACT_SIGNAL" <<< "$output"; then
        pass "--no-compact suppresses compact signal"
    else
        fail "--no-compact did not suppress compact signal"
        echo "$output"
    fi
}

run_test_complete_item_requires_quality_evidence() {
    local repo
    repo="$(make_fixture_repo quality-gate)"
    local rel=".claude/evidence"
    local item="TST-1"

    # Initialize state but skip the quality-evidence step so the gate fires.
    (cd "$repo" && bash "$RUNNER" init --evidence-dir "$rel" --until "item:$item") \
        > "$TEST_FIXTURE_ROOT/quality-gate-init.log" 2>&1

    local output exit_code=0
    output="$(cd "$repo" && bash "$RUNNER" complete-item "$item" --evidence-dir "$rel" 2>&1)" || exit_code=$?

    if [[ "$exit_code" -ne 0 ]] && grep -q "Quality evidence missing" <<< "$output"; then
        pass "complete-item rejects item without quality evidence"
    else
        fail "complete-item should reject item without quality evidence (exit=$exit_code)"
        echo "$output"
    fi
}

run_test_retry_to_block() {
    local repo
    repo="$(make_fixture_repo retry-block)"
    local rel=".claude/evidence"
    local state="$repo/$rel/state.json"
    local item="TST-1"

    (cd "$repo" && \
        RALPH_NEXT_SIMULATE_FAILURE="$item" \
        RALPH_NEXT_SIMULATE_FAILURE_TYPE="lint" \
        bash "$RUNNER" --until "item:$item" --max-retries 1 --evidence-dir "$rel") \
        > "$TEST_FIXTURE_ROOT/retry-block.log" 2>&1

    if assert_file_exists "$state" \
        && assert_jq_eq "$state" ".items[\"$item\"].status" 'blocked' \
        && assert_jq_eq "$state" ".items[\"$item\"].failureType" 'lint'; then
        pass "retry path eventually blocks when retries exhausted"
    else
        fail "retry-to-block assertions failed"
        cat "$TEST_FIXTURE_ROOT/retry-block.log"
    fi
}

run_test_security_escalate() {
    local repo
    repo="$(make_fixture_repo security)"
    local rel=".claude/evidence"
    local state="$repo/$rel/state.json"
    local item="TST-1"

    (cd "$repo" && \
        RALPH_NEXT_SIMULATE_FAILURE="$item" \
        RALPH_NEXT_SIMULATE_FAILURE_TYPE="security:critical-high" \
        bash "$RUNNER" --until "item:$item" --max-retries 3 --evidence-dir "$rel") \
        > "$TEST_FIXTURE_ROOT/security.log" 2>&1

    if assert_file_exists "$state" \
        && assert_jq_eq "$state" ".items[\"$item\"].status" 'blocked' \
        && assert_jq_eq "$state" ".items[\"$item\"].decision" 'escalate' \
        && assert_jq_eq "$state" ".items[\"$item\"].failureType" 'security:critical-high'; then
        pass "critical security failures escalate immediately"
    else
        fail "security escalation assertions failed"
        cat "$TEST_FIXTURE_ROOT/security.log"
    fi
}

# ---- Linear-mode tests (no BACKLOG.md — verify shims no-op gracefully) ----

run_test_linear_pick_items_noop() {
    local repo
    repo="$(make_linear_only_repo linear-pick)"
    local rel=".claude/evidence"

    (cd "$repo" && bash "$RUNNER" init --evidence-dir "$rel" --until "1 items") \
        > "$TEST_FIXTURE_ROOT/linear-pick-init.log" 2>&1

    local output exit_code=0
    output="$(cd "$repo" && bash "$RUNNER" pick-items --evidence-dir "$rel" 2>&1)" || exit_code=$?

    if [[ "$exit_code" -eq 0 ]] \
        && grep -q "Linear-only mode: BACKLOG.md not found" <<< "$output" \
        && grep -q '^\[\]$' <<< "$output"; then
        pass "Linear-mode pick-items no-ops with empty array + warning"
    else
        fail "Linear-mode pick-items should exit 0 with [] and warning (exit=$exit_code)"
        echo "$output"
    fi
}

run_test_linear_complete_item_noop() {
    local repo
    repo="$(make_linear_only_repo linear-complete)"
    local rel=".claude/evidence"

    (cd "$repo" && bash "$RUNNER" init --evidence-dir "$rel" --until "item:BUI-99") \
        > "$TEST_FIXTURE_ROOT/linear-complete-init.log" 2>&1

    local output exit_code=0
    output="$(cd "$repo" && bash "$RUNNER" complete-item BUI-99 --evidence-dir "$rel" 2>&1)" || exit_code=$?

    if [[ "$exit_code" -eq 0 ]] \
        && grep -q "Linear-only mode" <<< "$output" \
        && grep -q "mcp__linear__update_issue" <<< "$output"; then
        pass "Linear-mode complete-item no-ops with Linear MCP guidance"
    else
        fail "Linear-mode complete-item should exit 0 with guidance (exit=$exit_code)"
        echo "$output"
    fi
}

run_test_linear_block_item_noop() {
    local repo
    repo="$(make_linear_only_repo linear-block)"
    local rel=".claude/evidence"

    (cd "$repo" && bash "$RUNNER" init --evidence-dir "$rel" --until "item:BUI-99") \
        > "$TEST_FIXTURE_ROOT/linear-block-init.log" 2>&1

    local output exit_code=0
    output="$(cd "$repo" && bash "$RUNNER" block-item BUI-99 --evidence-dir "$rel" 2>&1)" || exit_code=$?

    if [[ "$exit_code" -eq 0 ]] \
        && grep -q "Linear-only mode" <<< "$output" \
        && grep -q 'labels=\["blocked"\]' <<< "$output"; then
        pass "Linear-mode block-item no-ops with Linear MCP guidance"
    else
        fail "Linear-mode block-item should exit 0 with guidance (exit=$exit_code)"
        echo "$output"
    fi
}

main() {
    command -v jq >/dev/null 2>&1 || { echo "jq is required"; exit 1; }
    command -v git >/dev/null 2>&1 || { echo "git is required"; exit 1; }
    [[ -x "$RUNNER" ]] || { echo "Runner not executable: $RUNNER"; exit 1; }

    log "Fixture root: $TEST_FIXTURE_ROOT"

    # Legacy-mode (BACKLOG.md fixture)
    run_test_dry_run
    run_test_pass_path
    run_test_compact_signal
    run_test_no_compact_flag
    run_test_complete_item_requires_quality_evidence
    run_test_retry_to_block
    run_test_security_escalate

    # Linear-mode shims (BACKLOG.md absent)
    run_test_linear_pick_items_noop
    run_test_linear_complete_item_noop
    run_test_linear_block_item_noop

    echo ""
    log "Results: $PASS passed, $FAIL failed"

    if [[ "$FAIL" -gt 0 ]]; then
        exit 1
    fi
}

main "$@"
