#!/usr/bin/env bash
# test-ralph-next.sh - Reliability checks for scripts/ralph-next-run.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNNER="$ROOT/scripts/ralph-next-run.sh"
TEST_BASE_REL=".claude/ralph-next-test"
BACKLOG_BACKUP="$ROOT/BACKLOG.md.test-backup"

PASS=0
FAIL=0

log() { echo "[test-ralph-next] $*"; }
pass() { PASS=$((PASS + 1)); log "PASS: $*"; }
fail() { FAIL=$((FAIL + 1)); log "FAIL: $*"; }

cleanup_dir() {
    local rel="$1"
    local abs="$ROOT/$rel"

    if [[ ! -d "$abs" ]]; then
        return
    fi

    find "$abs" -type f -delete 2>/dev/null || true
    find "$abs" -depth -type d -empty -delete 2>/dev/null || true
}

restore_backlog() {
    if [[ -f "$BACKLOG_BACKUP" ]]; then
        cp "$BACKLOG_BACKUP" "$ROOT/BACKLOG.md"
        rm -f "$BACKLOG_BACKUP"
    fi
}

assert_file_exists() {
    local file="$1"
    if [[ -f "$file" ]]; then
        return 0
    fi
    return 1
}

assert_jq_eq() {
    local file="$1"
    local query="$2"
    local expected="$3"
    local actual
    actual="$(jq -r "$query" "$file")"
    [[ "$actual" == "$expected" ]]
}

# Pick a pending item ID from BACKLOG.md for tests that run against real items.
# Returns the first CS-NNN found in active table rows.
pick_test_item() {
    grep -oE '\| CS-[0-9]+' "$ROOT/BACKLOG.md" \
        | grep -oE 'CS-[0-9]+' \
        | head -1
}

run_test_dry_run() {
    local output
    output="$(bash "$RUNNER" --dry-run --until "2 items" --evidence-dir "$TEST_BASE_REL/dry" 2>&1)"
    if grep -q "Dry run - selected" <<< "$output" && grep -Eq "CS-[0-9]+" <<< "$output"; then
        pass "dry-run selects backlog items"
    else
        fail "dry-run output missing expected selection"
        echo "$output"
    fi
}

run_test_pass_path() {
    local test_item
    test_item="$(pick_test_item)"
    if [[ -z "$test_item" ]]; then
        fail "pass path: no pending items in BACKLOG.md"
        return
    fi

    local rel="$TEST_BASE_REL/pass"
    local state="$ROOT/$rel/state.json"
    local evidence="$ROOT/$rel/evidence/${test_item}.json"
    local quality_evidence="$ROOT/$rel/quality-${test_item}.json"

    cp "$ROOT/BACKLOG.md" "$BACKLOG_BACKUP"
    bash "$RUNNER" --until "item:$test_item" --evidence-dir "$rel" >/tmp/ralph-next-pass.log 2>&1
    restore_backlog

    if assert_file_exists "$state" \
      && assert_file_exists "$evidence" \
      && assert_file_exists "$quality_evidence" \
      && assert_jq_eq "$state" ".items[\"$test_item\"].status" 'completed' \
      && assert_jq_eq "$state" ".items[\"$test_item\"].decision" 'pass'; then
        pass "pass path writes completed state, evidence, and quality evidence"
    else
        fail "pass path assertions failed"
        cat /tmp/ralph-next-pass.log
    fi
}

run_test_compact_signal() {
    local test_item
    test_item="$(pick_test_item)"
    if [[ -z "$test_item" ]]; then
        fail "compact signal: no pending items in BACKLOG.md"
        return
    fi

    local rel="$TEST_BASE_REL/compact"

    cp "$ROOT/BACKLOG.md" "$BACKLOG_BACKUP"
    local output
    output="$(bash "$RUNNER" --until "item:$test_item" --evidence-dir "$rel" 2>&1)"
    restore_backlog

    if grep -q "COMPACT_SIGNAL" <<< "$output"; then
        pass "compact signal emitted after completed item"
    else
        fail "compact signal missing from output after completed item"
        echo "$output"
    fi
}

run_test_no_compact_flag() {
    local test_item
    test_item="$(pick_test_item)"
    if [[ -z "$test_item" ]]; then
        fail "no-compact flag: no pending items in BACKLOG.md"
        return
    fi

    local rel="$TEST_BASE_REL/no-compact"

    cp "$ROOT/BACKLOG.md" "$BACKLOG_BACKUP"
    local output
    output="$(bash "$RUNNER" --until "item:$test_item" --no-compact --evidence-dir "$rel" 2>&1)"
    restore_backlog

    if ! grep -q "COMPACT_SIGNAL" <<< "$output"; then
        pass "--no-compact suppresses compact signal"
    else
        fail "--no-compact did not suppress compact signal"
        echo "$output"
    fi
}

run_test_complete_item_requires_quality_evidence() {
    local test_item
    test_item="$(pick_test_item)"
    if [[ -z "$test_item" ]]; then
        fail "complete-item gate: no pending items in BACKLOG.md"
        return
    fi

    local rel="$TEST_BASE_REL/quality-gate"

    # Call complete-item WITHOUT prior quality run — should fail
    local output exit_code
    exit_code=0
    cp "$ROOT/BACKLOG.md" "$BACKLOG_BACKUP"
    output="$(bash "$RUNNER" complete-item "$test_item" --evidence-dir "$rel" 2>&1)" || exit_code=$?
    restore_backlog

    if [[ "$exit_code" -ne 0 ]] && grep -q "Quality evidence missing" <<< "$output"; then
        pass "complete-item rejects item without quality evidence"
    else
        fail "complete-item should reject item without quality evidence (exit=$exit_code)"
        echo "$output"
    fi
}

run_test_retry_to_block() {
    local test_item
    test_item="$(pick_test_item)"
    if [[ -z "$test_item" ]]; then
        fail "retry-to-block: no pending items in BACKLOG.md"
        return
    fi

    local rel="$TEST_BASE_REL/retry-block"
    local state="$ROOT/$rel/state.json"

    cp "$ROOT/BACKLOG.md" "$BACKLOG_BACKUP"
    RALPH_NEXT_SIMULATE_FAILURE="$test_item" \
    RALPH_NEXT_SIMULATE_FAILURE_TYPE="lint" \
      bash "$RUNNER" --until "item:$test_item" --max-retries 1 --evidence-dir "$rel" >/tmp/ralph-next-retry.log 2>&1
    restore_backlog

    if assert_file_exists "$state" \
      && assert_jq_eq "$state" ".items[\"$test_item\"].status" 'blocked' \
      && assert_jq_eq "$state" ".items[\"$test_item\"].failureType" 'lint'; then
        pass "retry path eventually blocks when retries exhausted"
    else
        fail "retry-to-block assertions failed"
        cat /tmp/ralph-next-retry.log
    fi
}

run_test_security_escalate() {
    local test_item
    test_item="$(pick_test_item)"
    if [[ -z "$test_item" ]]; then
        fail "security escalation: no pending items in BACKLOG.md"
        return
    fi

    local rel="$TEST_BASE_REL/security"
    local state="$ROOT/$rel/state.json"

    cp "$ROOT/BACKLOG.md" "$BACKLOG_BACKUP"
    RALPH_NEXT_SIMULATE_FAILURE="$test_item" \
    RALPH_NEXT_SIMULATE_FAILURE_TYPE="security:critical-high" \
      bash "$RUNNER" --until "item:$test_item" --max-retries 3 --evidence-dir "$rel" >/tmp/ralph-next-security.log 2>&1
    restore_backlog

    if assert_file_exists "$state" \
      && assert_jq_eq "$state" ".items[\"$test_item\"].status" 'blocked' \
      && assert_jq_eq "$state" ".items[\"$test_item\"].decision" 'escalate' \
      && assert_jq_eq "$state" ".items[\"$test_item\"].failureType" 'security:critical-high'; then
        pass "critical security failures escalate immediately"
    else
        fail "security escalation assertions failed"
        cat /tmp/ralph-next-security.log
    fi
}

main() {
    command -v jq >/dev/null 2>&1 || { echo "jq is required"; exit 1; }
    [[ -x "$RUNNER" ]] || { echo "Runner not executable: $RUNNER"; exit 1; }

    # Ensure BACKLOG.md is restored even if script exits early
    trap restore_backlog EXIT

    cleanup_dir "$TEST_BASE_REL"

    run_test_dry_run
    run_test_pass_path
    run_test_compact_signal
    run_test_no_compact_flag
    run_test_complete_item_requires_quality_evidence
    run_test_retry_to_block
    run_test_security_escalate

    echo ""
    log "Results: $PASS passed, $FAIL failed"

    cleanup_dir "$TEST_BASE_REL"

    if [[ "$FAIL" -gt 0 ]]; then
        exit 1
    fi
}

main "$@"
