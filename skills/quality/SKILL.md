---
name: quality
description: Autonomous quality loop with configurable thoroughness (95% or 98%). Runs lint, tests, build, security scans, and specialized quality agents. Auto-fixes issues and creates PRs.
context: fork
---

# Quality Skill — Autonomous Quality Loop

Makes your project ship-ready in one autonomous command. Replaces manual review cycles with parallel quality agents.

**CRITICAL: This is AUTONOMOUS. Do NOT stop and ask the user between loops.**

## Execution Flow

### Step -1: Resolve Audit Target (Git Root + Worktree Discipline)

**Bug fixed 2026-05-11**: when invoked as `/bs:quality --merge` with PR context
in the natural-language args (e.g. `#410`, `codex/foo`, or a worktree path),
prior versions ignored those references and audited whatever happened to be in
the operator's cwd — producing irrelevant reports about uncommitted changes in
the primary checkout. Target resolution now honors, in priority order:

1. **Explicit PR number** in args (`#NNN`, `PR NNN`, `pr#NNN`, `pull/NNN`, or
   `--pr NNN`) — `gh pr view <N> --json headRefName` resolves the head branch,
   then we look up the local worktree.
2. **Branch name** in args (e.g. `codex/foo`, `feat/bar`) or via `--branch`
   flag — find the local worktree for that branch.
3. **Worktree path** via `--target-dir <path>` / `--target <path>` /
   `--worktree <path>` or any bare absolute-path arg that exists.
4. **cwd is a non-primary worktree** — audit cwd's diff vs base. This is the
   "I'm working in my feature branch worktree" case.
5. **Fallback: primary checkout** — only with a LOUD warning. **Forbidden
   under `--merge`** — `--merge` mode hard-refuses to fall through to (5).

The parsing + resolution logic lives in
`<claude-setup-root>/scripts/quality-target-resolver.js` (pure, unit-tested at
`scripts/__tests__/quality-target-resolution.test.js`). The skill calls it as
a subprocess and acts on the JSON result.

```bash
# --- args-file bridge (REQUIRED — bug fixed 2026-05-12) ---------------------
# The /bs:quality slash command writes the user's $ARGUMENTS to a tempfile
# and passes the path here as --args-file <path>. This is the reliable
# channel for getting args into a forked Skill execution; the runtime does
# not propagate `Skill(args=...)` to the fork's $@ on its own.
#
# We extract --args-file from $@ and, if found, REPLACE $@ with the file
# contents (preserving any other args that were passed alongside).
# The file is removed once read, so concurrent /bs:merge-train invocations
# don't pile up stale state.
ARGS_FILE=""
REMAINING_ARGS=()
prev_arg=""
for arg in "$@"; do
  case "$prev_arg" in
    --args-file)
      ARGS_FILE="$arg"
      prev_arg=""
      continue
      ;;
  esac
  case "$arg" in
    --args-file)
      prev_arg="--args-file"
      continue
      ;;
    --args-file=*)
      ARGS_FILE="${arg#*=}"
      continue
      ;;
  esac
  REMAINING_ARGS+=("$arg")
  prev_arg=""
done

if [ -n "$ARGS_FILE" ] && [ -f "$ARGS_FILE" ]; then
  # Read the file, strip trailing newline, split on whitespace into args.
  # Use a subshell + xargs to safely tokenize without eval.
  FILE_ARGS=()
  while IFS= read -r tok; do
    [ -n "$tok" ] && FILE_ARGS+=("$tok")
  done < <(xargs -n1 < "$ARGS_FILE" 2>/dev/null)
  # Defensive: only unlink files inside the expected mktemp -d directory.
  # The slash command writes to `<tmpdir>/bs-quality-args.XXXXXX/args.txt`.
  # If a caller passes an unexpected path (e.g. a config file by mistake),
  # leave it alone rather than deleting it.
  case "$ARGS_FILE" in
    */bs-quality-args.*/args.txt|*/bs-quality-args-*.txt)
      rm -f "$ARGS_FILE"
      # Also try to rmdir the parent (only succeeds if empty — which it
      # will be, since args.txt was the only file inside).
      ARGS_PARENT=$(dirname "$ARGS_FILE")
      case "$ARGS_PARENT" in
        */bs-quality-args.*)
          rmdir "$ARGS_PARENT" 2>/dev/null || true
          ;;
      esac
      ;;
    *)
      echo "[quality] WARNING: --args-file path does not match the expected" >&2
      echo "  bs-quality-args.*/args.txt pattern; leaving it in place: $ARGS_FILE" >&2
      ;;
  esac
  # Use file args ONLY if the caller didn't already pass concrete args
  # alongside --args-file (belt-and-suspenders mode). The file is the
  # fallback; explicit args win.
  # Replace $@ with REMAINING_ARGS (explicit args minus --args-file token),
  # unioned with FILE_ARGS when REMAINING is empty. The --args-file token
  # itself never propagates beyond this block — downstream code must never
  # see it in $@.
  if [ "${#REMAINING_ARGS[@]}" -gt 0 ]; then
    set -- "${REMAINING_ARGS[@]}"
  elif [ "${#FILE_ARGS[@]}" -gt 0 ]; then
    set -- "${FILE_ARGS[@]}"
  else
    set --
  fi
fi

# Locate the resolver. It lives in the claude-setup overlay repo (the parent
# of the kit-pro submodule). $CLAUDE_PLUGIN_ROOT points at kit-pro; the
# overlay is its parent.
RESOLVER=""
for candidate in \
  "${CLAUDE_SETUP_ROOT:-}/scripts/quality-target-resolver.js" \
  "${CLAUDE_PLUGIN_ROOT:-}/../scripts/quality-target-resolver.js" \
  "$HOME/Projects/internal/claude-setup/scripts/quality-target-resolver.js" \
  "$HOME/.claude/scripts/quality-target-resolver.js"; do
  if [ -n "$candidate" ] && [ -f "$candidate" ]; then
    RESOLVER="$candidate"; break
  fi
done

if [ -z "$RESOLVER" ]; then
  # Resolver missing — fall back to the legacy --target-dir-only behavior.
  # This preserves backwards compatibility in environments where the overlay
  # repo isn't checked out, at the cost of losing PR/branch resolution.
  echo "[quality] WARNING: quality-target-resolver.js not found — falling back to legacy --target-dir parsing." >&2
  TARGET_DIR=""
  prev_arg=""
  for arg in "$@"; do
    case "$prev_arg" in
      --target-dir|--target) TARGET_DIR="$arg" ;;
    esac
    case "$arg" in
      --target-dir=*|--target=*) TARGET_DIR="${arg#*=}" ;;
    esac
    prev_arg="$arg"
  done
  if [ -z "$TARGET_DIR" ] && [ -n "${BS_QUALITY_TARGET_DIR:-}" ]; then
    TARGET_DIR="$BS_QUALITY_TARGET_DIR"
  fi
  if [ -n "$TARGET_DIR" ]; then
    TARGET_DIR="${TARGET_DIR/#\~/$HOME}"
    [ -d "$TARGET_DIR" ] || { echo "❌ target dir does not exist: $TARGET_DIR"; exit 1; }
    cd "$TARGET_DIR" || exit 1
  fi
else
  # Use the resolver. It returns a JSON plan we act on.
  # Pre-build helper inputs the resolver needs.
  PRIMARY_CHECKOUT=$(git worktree list --porcelain 2>/dev/null \
    | awk '/^worktree / {p=$2} /^branch refs\/heads\/main$/ {print p; exit}')
  CWD_INPUT=$(pwd)

  # Invoke the resolver. It expects ARGS (positional) and reads context from
  # env vars: QUALITY_CWD, QUALITY_PRIMARY_CHECKOUT.
  RESOLUTION_JSON=$(QUALITY_CWD="$CWD_INPUT" \
                    QUALITY_PRIMARY_CHECKOUT="$PRIMARY_CHECKOUT" \
                    node "$RESOLVER" --cli "$@" 2>/dev/null) || RESOLUTION_JSON=""

  if [ -n "$RESOLUTION_JSON" ]; then
    RES_OK=$(echo "$RESOLUTION_JSON" | jq -r '.ok // false' 2>/dev/null)
    RES_KIND=$(echo "$RESOLUTION_JSON" | jq -r '.resolution // ""' 2>/dev/null)
    RES_PATH=$(echo "$RESOLUTION_JSON" | jq -r '.targetPath // ""' 2>/dev/null)
    RES_BRANCH=$(echo "$RESOLUTION_JSON" | jq -r '.targetBranch // ""' 2>/dev/null)
    RES_REASON=$(echo "$RESOLUTION_JSON" | jq -r '.reason // ""' 2>/dev/null)
    RES_WARNINGS=$(echo "$RESOLUTION_JSON" | jq -r '.warnings[]?' 2>/dev/null)

    # Always print warnings (loudly, so a primary-fallback is unmissable).
    if [ -n "$RES_WARNINGS" ]; then
      echo ""
      echo "============================================================"
      echo "  [quality] TARGET RESOLUTION WARNINGS"
      echo "============================================================"
      echo "$RES_WARNINGS" | sed 's/^/  /'
      echo "============================================================"
      echo ""
    fi

    if [ "$RES_OK" != "true" ]; then
      echo "❌ /bs:quality could not resolve an audit target."
      echo "   Reason: $RES_REASON"
      echo "   Resolution: $RES_KIND"
      exit 1
    fi

    if [ "$RES_KIND" = "pr" ] || [ "$RES_KIND" = "branch" ]; then
      if [ -z "$RES_PATH" ] && [ -n "$RES_BRANCH" ]; then
        # No local worktree for the branch — materialize one in a sibling dir.
        # We use a deterministic path so repeat invocations reuse the worktree.
        REPO_ROOT_FOR_WT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
        REPO_NAME=$(basename "$REPO_ROOT_FOR_WT")
        SLUG=$(echo "$RES_BRANCH" | tr '/' '-' )
        RES_PATH="${REPO_ROOT_FOR_WT%/*}/${REPO_NAME}-${SLUG}"
        if [ ! -d "$RES_PATH" ]; then
          git fetch origin "$RES_BRANCH" 2>/dev/null || true
          git worktree add "$RES_PATH" "$RES_BRANCH" 2>/dev/null \
            || git worktree add -B "$RES_BRANCH" "$RES_PATH" "origin/$RES_BRANCH" \
            || { echo "❌ Could not materialize worktree for $RES_BRANCH at $RES_PATH"; exit 1; }
        fi
      fi
    fi

    if [ -n "$RES_PATH" ]; then
      echo "[quality] audit target: $RES_PATH (resolution=$RES_KIND${RES_BRANCH:+, branch=$RES_BRANCH})"
      cd "$RES_PATH" || { echo "❌ failed to cd to $RES_PATH"; exit 1; }
    fi
  fi
fi

GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$GIT_ROOT" ]; then
  echo "❌ /bs:quality could not resolve a git root from $(pwd)."
  echo "   Pass --target-dir <path>, a PR number (#NNN), or a branch name,"
  echo "   or export BS_QUALITY_TARGET_DIR=<path> in the spawning agent harness."
  exit 1
fi
cd "$GIT_ROOT" || exit 1

# Worktree discipline: when --merge is requested, refuse to run from the
# primary checkout's main branch. The resolver already hard-refuses the
# "no target specified + --merge" case; this is the belt-and-suspenders check
# for the "I cd'd into the primary checkout and asked for --merge" case.
ARGS_MERGE=false
for arg in "$@"; do
  case "$arg" in
    --merge|--merge=*) ARGS_MERGE=true; break ;;
  esac
done

if [ "$ARGS_MERGE" = true ]; then
  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
  PRIMARY=$(git worktree list --porcelain | awk '/^worktree / {p=$2} /^branch refs\/heads\/main$/ {print p; exit}')
  if [ "$CURRENT_BRANCH" = "main" ] && [ -n "$PRIMARY" ] && [ "$GIT_ROOT" = "$PRIMARY" ]; then
    echo "❌ /bs:quality --merge cannot run from the primary checkout on main."
    echo "   Create a worktree first:"
    echo "     git worktree add ../$(basename "$GIT_ROOT")-worktrees/<slug> -b <type>/<slug> main"
    echo "   Move uncommitted changes there with: git stash; cd <worktree>; git stash pop"
    exit 1
  fi
fi

# --- persist resolved git root for downstream bash blocks --------------------
# Each Bash tool invocation in later steps starts a fresh shell — cwd and
# shell vars set above do NOT survive. Without this, the resolver's target
# (--target-dir / PR / branch) is silently dropped beyond Step -1, and
# downstream `$GIT_ROOT` references resolve to empty. Write the resolved
# root to a session-scoped sentinel file that every downstream block reads
# with the BS_QUALITY_LOAD_ROOT preamble below.
BS_QUALITY_ROOT_FILE="${TMPDIR:-/tmp}/bs-quality-gitroot-${CLAUDE_CODE_SESSION_ID:-default}.txt"
if ! printf '%s\n' "$GIT_ROOT" > "$BS_QUALITY_ROOT_FILE" 2>/dev/null; then
  echo "❌ /bs:quality could not write git-root sentinel to $BS_QUALITY_ROOT_FILE"
  echo "   Check that \$TMPDIR is writable: ${TMPDIR:-/tmp}"
  exit 1
fi
echo "BS_QUALITY_ROOT_FILE=$BS_QUALITY_ROOT_FILE"

# NOTE on within-session concurrency: the sentinel filename only varies by
# CLAUDE_CODE_SESSION_ID, so two /bs:quality invocations sharing the same
# session (rare — merge-train workers spawn in separate Task subagents with
# their own session IDs) would race on this file. Last writer wins. If you
# need parallel quality runs, ensure they're spawned as separate sessions.
```

> **MANDATORY for every subsequent bash block in this skill** — start with the
> following preamble so the working directory matches the root resolved in
> Step -1, not the fork's harness cwd. Without it, target resolution is
> silently dropped after Step -1 (regression seen 2026-05-13).
>
> ```bash
> # BS_QUALITY_LOAD_ROOT — restore cwd resolved in Step -1
> BS_QUALITY_ROOT_FILE="${TMPDIR:-/tmp}/bs-quality-gitroot-${CLAUDE_CODE_SESSION_ID:-default}.txt"
> GIT_ROOT="$(cat "$BS_QUALITY_ROOT_FILE" 2>/dev/null)"
> if [ -z "$GIT_ROOT" ]; then
>   echo "[quality] WARN: sentinel missing ($BS_QUALITY_ROOT_FILE) — falling back to cwd git root" >&2
>   GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
> fi
> [ -n "$GIT_ROOT" ] || { echo "❌ git root unresolved (no sentinel, not in a git repo)"; exit 1; }
> cd "$GIT_ROOT" || { echo "❌ cannot enter git root: $GIT_ROOT"; exit 1; }
> ```

### Step 0: Parse Arguments

Read `reference.md` for flag definitions. Key flags: `--level` (auto|95|98), `--scope` (changed|branch|all), `--merge`, `--deploy`, `--preflight`, `--audit`, `--teams`, `--codex-effort` (medium|high|xhigh), `--codex-skip "<reason>"`.

Handle early exits: `--status` shows history, `--preflight` runs quick checks (<10s), `--audit` runs read-only assessment.

### Step 0.5: Tier Classification (when `--level auto`)

When `--level auto` (the default), read the consuming repo's risk tier from `harness-config.json` via `scripts/risk-policy-gate.js`. This routes agent count + Codex usage per tier — `low` runs 2 agents and skips Codex, `critical` runs 6 + Codex adversarial.

```bash
# BS_QUALITY_LOAD_ROOT — restore cwd resolved in Step -1
BS_QUALITY_ROOT_FILE="${TMPDIR:-/tmp}/bs-quality-gitroot-${CLAUDE_CODE_SESSION_ID:-default}.txt"
GIT_ROOT="$(cat "$BS_QUALITY_ROOT_FILE" 2>/dev/null)"
if [ -z "$GIT_ROOT" ]; then
  echo "[quality] WARN: sentinel missing ($BS_QUALITY_ROOT_FILE) — falling back to cwd git root" >&2
  GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
fi
# Empty-string guard: bash 3.2 (macOS default /bin/bash) treats `cd ""` as a
# silent no-op, defeating the `cd ... || exit` check. Verify GIT_ROOT is
# non-empty before attempting cd.
[ -n "$GIT_ROOT" ] || { echo "❌ git root unresolved (no sentinel, not in a git repo)"; exit 1; }
cd "$GIT_ROOT" || { echo "❌ cannot enter git root: $GIT_ROOT"; exit 1; }

# Default --level auto. Explicit --level 95 or 98 bypasses tier classification.
TIER=""
if [ "$LEVEL" = "auto" ]; then
  if [ -f "harness-config.json" ] && [ -f "scripts/risk-policy-gate.js" ]; then
    GH_OUT=$(mktemp)
    GITHUB_OUTPUT="$GH_OUT" node scripts/risk-policy-gate.js >/dev/null 2>&1
    GATE_EXIT=$?
    if [ $GATE_EXIT -ne 0 ]; then
      echo "❌ risk-policy-gate.js failed — refusing to silently route as low tier."
      echo "   Re-run with explicit --level 95 to bypass tier classification."
      rm -f "$GH_OUT"
      exit 1
    fi
    TIER=$(grep '^highestRisk=' "$GH_OUT" | cut -d= -f2)
    rm -f "$GH_OUT"
  else
    # No harness present in this repo — fall back to L95 behavior (existing default).
    # Loud multi-line warning so the operator notices and can opt into tier
    # classification rather than silently getting the heaviest review on every PR.
    echo ""
    echo "============================================================"
    echo "  [quality] TIER CLASSIFICATION DISABLED — falling back to L95"
    echo "============================================================"
    echo "  Missing: harness-config.json (and/or scripts/risk-policy-gate.js)"
    echo "  Effect:  every PR gets the full 6-agent + Codex review,"
    echo "           regardless of risk. Slower + more expensive than needed."
    echo ""
    echo "  Recommended: run /bs:init-project to bootstrap tier classification"
    echo "  (adds harness-config.json with sensible riskTierRules defaults)."
    echo ""
    echo "  Continuing at L95 in 2s..."
    echo "============================================================"
    echo ""
    sleep 2
    LEVEL=95
  fi
fi
```

**Tier → agent + Codex map** (read tier name from `harness-config.json:riskTierRules` at runtime — do NOT hand-render path globs anywhere in the skill):

| Resolved tier | Claude agents                                 | Codex role          | Time cap |
| ------------- | --------------------------------------------- | ------------------- | -------- |
| `low`         | 2 (code-reviewer + silent-failure-hunter)     | skip                | ≤2 min   |
| `medium`      | 4 (+ type-design-analyzer + security-auditor) | judge findings      | ≤8 min   |
| `high`        | 6 (full L95)                                  | judge + adversarial | ≤25 min  |
| `critical`    | 6 + existing `break-glass-approval` check     | judge + adversarial | ≤25 min  |

**Drift guard**: a `riskTierRules drift guard` test in `risk-policy-gate.test.js` asserts the keys are exactly `{critical, high, medium, low}` — adding a fifth tier without updating this map is a contract break.

### Step 1: Automated Checks

1. **Determine files** based on scope (changed/branch/all)
2. **Run checks**: TypeScript (`tsc --noEmit`), ESLint, build
3. **Optional tools**: Trivy (vulns), Semgrep (security), Lighthouse (web perf)
4. **Calculate quality score** from passed/total checks

### Step 1.3: Hard Test Gate (BLOCKING)

Tests must exist and pass. This is a hard blocker, not advisory. Skip with `--skip-tests` for config-only repos.

#### 1.3a: Test Existence Check

For each changed source file, verify a corresponding test file exists:

```bash
# BS_QUALITY_LOAD_ROOT — restore cwd resolved in Step -1
BS_QUALITY_ROOT_FILE="${TMPDIR:-/tmp}/bs-quality-gitroot-${CLAUDE_CODE_SESSION_ID:-default}.txt"
GIT_ROOT="$(cat "$BS_QUALITY_ROOT_FILE" 2>/dev/null)"
if [ -z "$GIT_ROOT" ]; then
  echo "[quality] WARN: sentinel missing ($BS_QUALITY_ROOT_FILE) — falling back to cwd git root" >&2
  GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
fi
# Empty-string guard: bash 3.2 (macOS default /bin/bash) treats `cd ""` as a
# silent no-op, defeating the `cd ... || exit` check. Verify GIT_ROOT is
# non-empty before attempting cd.
[ -n "$GIT_ROOT" ] || { echo "❌ git root unresolved (no sentinel, not in a git repo)"; exit 1; }
cd "$GIT_ROOT" || { echo "❌ cannot enter git root: $GIT_ROOT"; exit 1; }

CHANGED_SRC=$(git diff --name-only main...HEAD | grep -E '\.(ts|tsx|js|jsx)$' | grep -v -E '\.(test|spec|d)\.' | grep -v -E '(config|setup|types|index\.d)\.')
MISSING_TESTS=""

for src in $CHANGED_SRC; do
  # Derive expected test path: src/foo.ts → src/foo.test.ts OR tests/foo.test.ts
  base=$(echo "$src" | sed 's/\.\(ts\|tsx\|js\|jsx\)$//')
  ext=$(echo "$src" | grep -oE '\.(ts|tsx|js|jsx)$')

  # Check multiple patterns
  found=false
  for pattern in "${base}.test${ext}" "${base}.spec${ext}" "tests/$(basename ${base}).test${ext}" "__tests__/$(basename ${base}).test${ext}"; do
    if [ -f "$pattern" ]; then found=true; break; fi
  done

  if [ "$found" = false ]; then
    MISSING_TESTS="$MISSING_TESTS\n  - $src"
  fi
done

if [ -n "$MISSING_TESTS" ]; then
  echo "⚠️ Source files without tests:$MISSING_TESTS"
  # Not a hard fail — test-generator agent will create them in Step 1.8
  # But flag it so test-generator knows what to target
  TEST_GAPS="$MISSING_TESTS"
fi
```

**Exempt file patterns** (no test required): `*.config.*`, `*.d.ts`, `types.ts`, `index.ts` (re-exports only), migration files, seed files.

#### 1.3b: Run Tests (Hard Gate)

```bash
# BS_QUALITY_LOAD_ROOT — restore cwd resolved in Step -1
BS_QUALITY_ROOT_FILE="${TMPDIR:-/tmp}/bs-quality-gitroot-${CLAUDE_CODE_SESSION_ID:-default}.txt"
GIT_ROOT="$(cat "$BS_QUALITY_ROOT_FILE" 2>/dev/null)"
if [ -z "$GIT_ROOT" ]; then
  echo "[quality] WARN: sentinel missing ($BS_QUALITY_ROOT_FILE) — falling back to cwd git root" >&2
  GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
fi
# Empty-string guard: bash 3.2 (macOS default /bin/bash) treats `cd ""` as a
# silent no-op, defeating the `cd ... || exit` check. Verify GIT_ROOT is
# non-empty before attempting cd.
[ -n "$GIT_ROOT" ] || { echo "❌ git root unresolved (no sentinel, not in a git repo)"; exit 1; }
cd "$GIT_ROOT" || { echo "❌ cannot enter git root: $GIT_ROOT"; exit 1; }

# Run test suite — this MUST pass
npm test 2>&1
TEST_EXIT=$?

if [ $TEST_EXIT -ne 0 ]; then
  echo "❌ Tests failed — attempting auto-fix (up to 3 attempts)"

  for attempt in 1 2 3; do
    echo "Fix attempt $attempt/3..."
    # Read test output, identify failures, fix them
    npm test 2>&1
    TEST_EXIT=$?
    if [ $TEST_EXIT -eq 0 ]; then break; fi
  done

  if [ $TEST_EXIT -ne 0 ]; then
    echo "❌ HARD FAIL: Tests still failing after 3 fix attempts"
    echo "Cannot proceed to review agents with broken tests."
    exit 1
  fi
fi
echo "✅ All tests passing"
```

#### 1.3c: Test-Generator Targeting

Pass `$TEST_GAPS` to the `test-generator` agent in Step 1.8 so it generates tests for specifically identified gaps. After test-generator runs, re-run `npm test` to verify generated tests pass:

```bash
# BS_QUALITY_LOAD_ROOT — restore cwd resolved in Step -1
BS_QUALITY_ROOT_FILE="${TMPDIR:-/tmp}/bs-quality-gitroot-${CLAUDE_CODE_SESSION_ID:-default}.txt"
GIT_ROOT="$(cat "$BS_QUALITY_ROOT_FILE" 2>/dev/null)"
if [ -z "$GIT_ROOT" ]; then
  echo "[quality] WARN: sentinel missing ($BS_QUALITY_ROOT_FILE) — falling back to cwd git root" >&2
  GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
fi
# Empty-string guard: bash 3.2 (macOS default /bin/bash) treats `cd ""` as a
# silent no-op, defeating the `cd ... || exit` check. Verify GIT_ROOT is
# non-empty before attempting cd.
[ -n "$GIT_ROOT" ] || { echo "❌ git root unresolved (no sentinel, not in a git repo)"; exit 1; }
cd "$GIT_ROOT" || { echo "❌ cannot enter git root: $GIT_ROOT"; exit 1; }

npm test 2>&1
if [ $? -ne 0 ]; then
  echo "❌ Generated tests are failing — fix before continuing"
  # Auto-fix loop (same 3 attempts)
fi
```

### Step 1.5: Semantic Pattern Analysis

Run defensive pattern analysis on changed files. See `checklist.md` for pattern categories.

### Step 1.6: Test Coverage Validation

Scan test files for quality issues. Read `checklist.md` "Test Quality" section for validation criteria.

### Step 1.7: Documentation Sync Check

Detect API changes, new commands, modified exports. Skip with `--skip-docs`. Spawn doc-writer agent if changes detected.

### Step 1.8: Quality Agents

**Scope `changed`**: Skip agents — automated checks are sufficient.

**Agent count is tier-aware when `--level auto`** (Step 0.5). Explicit `--level 95` runs all 6 agents regardless of tier; `--level 98` adds 4 more.

**Tier → agent panel** (resolved from Step 0.5):

| Tier (auto)               | Agents (in panel order)                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `low`                     | code-reviewer, silent-failure-hunter                                                              |
| `medium`                  | + type-design-analyzer, security-auditor                                                          |
| `high` / `critical` / L95 | + test-generator, pr-test-analyzer (full 6)                                                       |
| `--level 98`              | full 6 + Phase 2: code-simplifier, accessibility-tester, performance-engineer, architect-reviewer |

| Agent                 | Focus                            | Model  |
| --------------------- | -------------------------------- | ------ |
| code-reviewer         | Bugs, logic errors, code smells  | opus   |
| silent-failure-hunter | Empty catches, swallowed errors  | opus   |
| type-design-analyzer  | Type safety, generics, null gaps | opus   |
| security-auditor      | OWASP top 10, secrets, injection | opus   |
| test-generator        | Generate missing tests           | sonnet |
| pr-test-analyzer      | Validate test quality            | opus   |

```bash
# BS_QUALITY_LOAD_ROOT — restore cwd resolved in Step -1
BS_QUALITY_ROOT_FILE="${TMPDIR:-/tmp}/bs-quality-gitroot-${CLAUDE_CODE_SESSION_ID:-default}.txt"
GIT_ROOT="$(cat "$BS_QUALITY_ROOT_FILE" 2>/dev/null)"
if [ -z "$GIT_ROOT" ]; then
  echo "[quality] WARN: sentinel missing ($BS_QUALITY_ROOT_FILE) — falling back to cwd git root" >&2
  GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
fi
# Empty-string guard: bash 3.2 (macOS default /bin/bash) treats `cd ""` as a
# silent no-op, defeating the `cd ... || exit` check. Verify GIT_ROOT is
# non-empty before attempting cd.
[ -n "$GIT_ROOT" ] || { echo "❌ git root unresolved (no sentinel, not in a git repo)"; exit 1; }
cd "$GIT_ROOT" || { echo "❌ cannot enter git root: $GIT_ROOT"; exit 1; }

# Build the agent list for this run from $TIER (Step 0.5) or $LEVEL.
case "${TIER:-$LEVEL}" in
  low)        AGENTS=(code-reviewer silent-failure-hunter) ;;
  medium)     AGENTS=(code-reviewer silent-failure-hunter type-design-analyzer security-auditor) ;;
  high|95)    AGENTS=(code-reviewer silent-failure-hunter type-design-analyzer security-auditor \
                      test-generator pr-test-analyzer) ;;
  critical)   AGENTS=(code-reviewer silent-failure-hunter type-design-analyzer security-auditor \
                      test-generator pr-test-analyzer)
              # Critical-only break-glass enforcement (see Step 1.8a).
              REQUIRE_BREAK_GLASS=true ;;
  98)         AGENTS=(code-reviewer silent-failure-hunter type-design-analyzer security-auditor \
                      test-generator pr-test-analyzer code-simplifier accessibility-tester \
                      performance-engineer architect-reviewer) ;;
  *)          echo "❌ Unknown tier/level: ${TIER:-$LEVEL}"; exit 1 ;;
esac
echo "[quality] Running ${#AGENTS[@]} agents for tier=${TIER:-n/a} level=${LEVEL}"
```

#### Step 1.8a: Break-glass approval (critical tier only)

Critical-tier changes (per `harness-config.json:mergePolicy.critical.requiredChecks`) require explicit human approval before review stamping. The skill cannot self-authorize critical merges.

```bash
# BS_QUALITY_LOAD_ROOT — restore cwd resolved in Step -1
BS_QUALITY_ROOT_FILE="${TMPDIR:-/tmp}/bs-quality-gitroot-${CLAUDE_CODE_SESSION_ID:-default}.txt"
GIT_ROOT="$(cat "$BS_QUALITY_ROOT_FILE" 2>/dev/null)"
if [ -z "$GIT_ROOT" ]; then
  echo "[quality] WARN: sentinel missing ($BS_QUALITY_ROOT_FILE) — falling back to cwd git root" >&2
  GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
fi
# Empty-string guard: bash 3.2 (macOS default /bin/bash) treats `cd ""` as a
# silent no-op, defeating the `cd ... || exit` check. Verify GIT_ROOT is
# non-empty before attempting cd.
[ -n "$GIT_ROOT" ] || { echo "❌ git root unresolved (no sentinel, not in a git repo)"; exit 1; }
cd "$GIT_ROOT" || { echo "❌ cannot enter git root: $GIT_ROOT"; exit 1; }

if [ "${REQUIRE_BREAK_GLASS:-false}" = true ]; then
  # Look for a break-glass approval trailer or env var on this run.
  # Operator must explicitly opt in — there is no auto-pass at critical.
  if [ "$BREAK_GLASS_APPROVED" != true ] && \
     ! git log "${RESOLVED_BASE:-origin/main}..HEAD" --format=%B | grep -q "^Break-Glass-Approval: "; then
    echo "❌ MERGE BLOCKED: critical tier requires explicit break-glass approval."
    echo "   Either set BREAK_GLASS_APPROVED=true in the environment for this run,"
    echo "   or add a 'Break-Glass-Approval: <approver-handle>' trailer to a commit on this branch."
    echo "   See harness-config.json:mergePolicy.critical.requiredChecks."
    exit 1
  fi
  echo "[quality] Break-glass approval verified for critical tier"
fi
```

#### Diff Context Injection (CRITICAL)

Before spawning agents, capture the diff and file list:

```bash
# BS_QUALITY_LOAD_ROOT — restore cwd resolved in Step -1
BS_QUALITY_ROOT_FILE="${TMPDIR:-/tmp}/bs-quality-gitroot-${CLAUDE_CODE_SESSION_ID:-default}.txt"
GIT_ROOT="$(cat "$BS_QUALITY_ROOT_FILE" 2>/dev/null)"
if [ -z "$GIT_ROOT" ]; then
  echo "[quality] WARN: sentinel missing ($BS_QUALITY_ROOT_FILE) — falling back to cwd git root" >&2
  GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
fi
# Empty-string guard: bash 3.2 (macOS default /bin/bash) treats `cd ""` as a
# silent no-op, defeating the `cd ... || exit` check. Verify GIT_ROOT is
# non-empty before attempting cd.
[ -n "$GIT_ROOT" ] || { echo "❌ git root unresolved (no sentinel, not in a git repo)"; exit 1; }
cd "$GIT_ROOT" || { echo "❌ cannot enter git root: $GIT_ROOT"; exit 1; }

DIFF=$(git diff main...HEAD)
CHANGED_FILES=$(git diff --name-only main...HEAD)
```

Each agent prompt MUST include:

1. The actual diff content (not "run git diff" — the agent should NOT re-fetch)
2. The list of changed files
3. The branch name and commit messages (`git log main..HEAD --oneline`)
4. Relevant project conventions from CLAUDE.md

Template for agent prompt:

```
Review the following code changes for [AGENT_FOCUS].

## Changed Files
$CHANGED_FILES

## Diff
$DIFF

## Commit History
$COMMIT_LOG

## Project Conventions
[Extract relevant rules from CLAUDE.md]

Return findings as structured output with file:line references.
Do NOT review unchanged code. Focus ONLY on the diff.
```

This prevents agents from doing generic scans and forces them to review the actual changes.

#### Step 2.6: Codex Invocation (tier-aware)

claude-kit-pro enables a second-opinion review via Codex — different model, different blind spots. **Tier-aware**: skipped at `low`, judge mode at `medium`, judge + adversarial at `high`/`critical`. Disable explicitly with `--no-codex` or skip on this run with `--codex-skip "<reason>"`.

The canonical invocation is the Codex companion CLI documented in `claude-setup/docs/quality-tier-codex-judge-plan.md` line 125-126. The `--base` arg uses the resolved base from `risk-policy-gate.js`, NOT hardcoded `main`.

```bash
# BS_QUALITY_LOAD_ROOT — restore cwd resolved in Step -1
BS_QUALITY_ROOT_FILE="${TMPDIR:-/tmp}/bs-quality-gitroot-${CLAUDE_CODE_SESSION_ID:-default}.txt"
GIT_ROOT="$(cat "$BS_QUALITY_ROOT_FILE" 2>/dev/null)"
if [ -z "$GIT_ROOT" ]; then
  echo "[quality] WARN: sentinel missing ($BS_QUALITY_ROOT_FILE) — falling back to cwd git root" >&2
  GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
fi
# Empty-string guard: bash 3.2 (macOS default /bin/bash) treats `cd ""` as a
# silent no-op, defeating the `cd ... || exit` check. Verify GIT_ROOT is
# non-empty before attempting cd.
[ -n "$GIT_ROOT" ] || { echo "❌ git root unresolved (no sentinel, not in a git repo)"; exit 1; }
cd "$GIT_ROOT" || { echo "❌ cannot enter git root: $GIT_ROOT"; exit 1; }

# Resolve base the same way risk-policy-gate.js does (origin/main → origin/master → main → master).
RESOLVED_BASE=""
for ref in origin/main origin/master main master; do
  if git rev-parse --verify --quiet "${ref}^{commit}" >/dev/null 2>&1; then
    RESOLVED_BASE="$ref"; break
  fi
done
if [ -z "$RESOLVED_BASE" ]; then
  echo "❌ No resolvable base ref for Codex; pass --no-codex or set --base manually"
  exit 1
fi

# Default --codex-effort high; medium/xhigh override.
CODEX_EFFORT="${CODEX_EFFORT:-high}"
COMPANION="${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs"

case "${TIER:-$LEVEL}" in
  low)
    # No Codex at low.
    CODEX_MODE="skip"
    ;;
  medium|95)
    # Judge mode — pass Claude findings as focus text to adversarial-review.
    # Foreground (--wait), bounded by companion's wall-time cap.
    CODEX_MODE="judge"
    if [ "$NO_CODEX" != true ] && [ -z "$CODEX_SKIP_REASON" ]; then
      node "$COMPANION" adversarial-review --wait --base "$RESOLVED_BASE" --scope branch \
        "Judge the following Claude findings for accuracy, actionability, and false-positive risk. \
         Approve, request-changes, or flag specific findings as low-confidence. Findings: $CLAUDE_FINDINGS"
    fi
    ;;
  high|critical|98)
    # Judge + adversarial. Background for adversarial; bounded poll to terminal state.
    CODEX_MODE="judge+adversarial"
    CODEX_VERDICT="not-run"
    CODEX_FINDINGS=0
    if [ "$NO_CODEX" != true ] && [ -z "$CODEX_SKIP_REASON" ]; then
      LAUNCH_OUT=$(node "$COMPANION" adversarial-review --background --base "$RESOLVED_BASE" --scope branch \
        "Adversarial review focused on bugs, security, data loss, race conditions, breaking changes. \
         Effort: $CODEX_EFFORT. Verdict: APPROVE or REQUEST_CHANGES with file:line findings." 2>&1)
      # Extract job id printed by the launcher (e.g. "[codex] Job <id> queued").
      CODEX_JOB=$(echo "$LAUNCH_OUT" | grep -oE 'Job [0-9a-f-]+' | head -1 | awk '{print $2}')

      if [ -n "$CODEX_JOB" ]; then
        # Bounded poll: 25-min cap matches the spec's high/critical time cap.
        DEADLINE=${CODEX_DEADLINE:-1500}
        WAITED=0
        while [ "$WAITED" -lt "$DEADLINE" ]; do
          STATUS=$(node "$COMPANION" status "$CODEX_JOB" --json 2>/dev/null | jq -r '.status // "unknown"')
          case "$STATUS" in
            completed|succeeded|failed|cancelled|timed-out) break ;;
          esac
          sleep 15; WAITED=$((WAITED + 15))
        done

        if [ "$STATUS" = "completed" ] || [ "$STATUS" = "succeeded" ]; then
          CODEX_OUT=$(node "$COMPANION" result "$CODEX_JOB" --json 2>/dev/null)
          # Parse verdict from companion output. Accept a few common shapes.
          CODEX_VERDICT=$(echo "$CODEX_OUT" | jq -r '.verdict // .status // "unknown"' 2>/dev/null)
          CODEX_FINDINGS=$(echo "$CODEX_OUT" | jq -r '(.findings // []) | length' 2>/dev/null || echo 0)
          # Fail-closed on REQUEST_CHANGES at high/critical — operator must address findings or use --codex-skip.
          case "$CODEX_VERDICT" in
            request-changes|REQUEST_CHANGES|needs-attention|fail|failed)
              echo "❌ Codex adversarial review: $CODEX_VERDICT ($CODEX_FINDINGS findings)"
              echo "   Address findings, or re-run with --codex-skip \"<reason>\" if accepted."
              exit 1
              ;;
          esac
        else
          echo "❌ Codex review did not complete (status=$STATUS, waited=${WAITED}s)."
          echo "   Re-run, raise CODEX_DEADLINE, or use --codex-skip \"<reason>\"."
          exit 1
        fi
      else
        echo "❌ Failed to obtain Codex job id from launcher output."
        exit 1
      fi
    fi
    ;;
  *)
    CODEX_MODE="skip"
    ;;
esac
```

**Failure modes (asymmetric per spec)**:

| Condition                        | low/medium      | high/critical                                              |
| -------------------------------- | --------------- | ---------------------------------------------------------- |
| Codex unavailable                | Skip + warn     | Block local-merge until `--codex-skip "<reason>"` provided |
| Codex finds BLOCKING after judge | Block merge     | Block merge                                                |
| Wall-time cap exceeded           | Post partial    | Post partial; require manual rerun (no silent downgrade)   |
| `--codex-skip <reason>`          | Allowed, logged | Allowed only with non-empty reason; logged                 |

Merge Codex findings into the judge report. Codex findings overlapping Claude findings boost confidence. New Codex findings get added to WARNINGS.

#### Review Stamp + Quality-Skip Trailer

After all agents pass, add commit trailers to the merge commit message. The trailer is the **authoritative** record of what review actually ran (NOT `.claude/quality-skip-log.json`, which is telemetry only).

```bash
# BS_QUALITY_LOAD_ROOT — restore cwd resolved in Step -1
BS_QUALITY_ROOT_FILE="${TMPDIR:-/tmp}/bs-quality-gitroot-${CLAUDE_CODE_SESSION_ID:-default}.txt"
GIT_ROOT="$(cat "$BS_QUALITY_ROOT_FILE" 2>/dev/null)"
if [ -z "$GIT_ROOT" ]; then
  echo "[quality] WARN: sentinel missing ($BS_QUALITY_ROOT_FILE) — falling back to cwd git root" >&2
  GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
fi
# Empty-string guard: bash 3.2 (macOS default /bin/bash) treats `cd ""` as a
# silent no-op, defeating the `cd ... || exit` check. Verify GIT_ROOT is
# non-empty before attempting cd.
[ -n "$GIT_ROOT" ] || { echo "❌ git root unresolved (no sentinel, not in a git repo)"; exit 1; }
cd "$GIT_ROOT" || { echo "❌ cannot enter git root: $GIT_ROOT"; exit 1; }

HEAD_SHA=$(git rev-parse HEAD)
BASE_SHA=$(git merge-base HEAD "$RESOLVED_BASE")
TIER_LABEL="${TIER:-L${LEVEL}}"
AGENT_COUNT=${#AGENTS[@]}
FINDING_COUNT=${BLOCKING_COUNT:-0}

# Always write claude-quality (preserves existing CI grep in harness-gate.yml).
echo "Reviewed-By: claude-quality (tier=${TIER_LABEL}, agents=${AGENT_COUNT}, findings=${FINDING_COUNT})"

# Mark that the pipeline ran in this invocation so Step 4 can distinguish
# "operator just ran quality but trailer didn't land on a commit" (auto-stamp)
# from "operator passed --merge with no quality work" (hard-block).
QUALITY_PIPELINE_RAN=true

# Codex trailer ONLY when Codex actually ran.
if [ "$CODEX_MODE" != "skip" ] && [ -z "$CODEX_SKIP_REASON" ] && [ "$NO_CODEX" != true ]; then
  echo "Reviewed-By: codex (tier=${TIER_LABEL}, mode=${CODEX_MODE}, status=${CODEX_VERDICT:-unknown}, findings=${CODEX_FINDINGS:-0})"
fi

# Quality-Skip trailer — required when --codex-skip was used at high/critical.
# Carries full SHAs so reusing a stale trailer on a new commit fails verification.
if [ -n "$CODEX_SKIP_REASON" ]; then
  case "$TIER" in
    high|critical)
      echo "Quality-Skip: codex-judge (reason=\"${CODEX_SKIP_REASON}\"; head=${HEAD_SHA}; base=${BASE_SHA})"
      # Append to telemetry log (non-authoritative).
      mkdir -p .claude
      jq --arg ts "$(date -u +%FT%TZ)" --arg tier "$TIER" --arg reason "$CODEX_SKIP_REASON" \
         --arg branch "$(git rev-parse --abbrev-ref HEAD)" --arg head "$HEAD_SHA" --arg base "$BASE_SHA" \
         --arg op "$(git config user.email)" \
         '.skips += [{timestamp:$ts, tier:$tier, reason:$reason, branch:$branch,
                      head_sha:$head, base_sha:$base, operator:$op}]' \
         .claude/quality-skip-log.json 2>/dev/null > .claude/quality-skip-log.json.tmp \
         && mv .claude/quality-skip-log.json.tmp .claude/quality-skip-log.json \
         || echo '{"skips":[]}' > .claude/quality-skip-log.json
      ;;
  esac
fi
```

CI checks the `Reviewed-By: claude-quality` trailer to verify local review ran. See `harness-gate.yml`.

### Step 2: Agent Result Validation

Validate agent outputs per `checklist.md` "Agent Validation" section. Check expected sections, minimum content length, and reject generic responses.

### Step 2.5: Judge Agent — Finding Synthesis (CRITICAL)

**Purpose**: Filter noise, deduplicate, severity-classify. This is the most impactful step for review quality (per HubSpot: "most impactful change" in their AI review system — fewer, better, more actionable comments).

After all agent results are validated, run a single synthesis pass:

1. **Collect** all findings from: Claude review agents + Codex cross-review (when available)
2. **Deduplicate**: Same file:line from multiple agents → merge into one finding, note which agents flagged it (higher confidence)
3. **Severity classify** every finding into exactly one category:
   - **BLOCKING** — Bugs, security vulns, data loss, breaking changes. Must fix before merge.
   - **WARNING** — Missing edge cases, performance concerns, weak error handling. Should fix.
   - **SUPPRESSED** — Style nits, import ordering, naming preferences, suggestions for unchanged code. Do NOT report.
4. **Confidence boost**: Findings flagged by 2+ independent agents (e.g., Claude code-reviewer AND Codex) are promoted one severity level
5. **Output**: Consolidated report with only BLOCKING and WARNING findings. Include finding count and agent attribution.

```
## Quality Review Summary

**Reviewed by**: 6 Claude agents (Opus) + Codex cross-review
**Files**: N files, M lines changed
**Findings**: X blocking, Y warnings (Z suppressed)

### BLOCKING
[findings with file:line, why it matters, specific fix]

### WARNINGS
[findings with file:line, impact, fix suggestion]

### VERDICT: PASS | FAIL
```

**Rules**:

- If 0 BLOCKING findings → PASS
- If any BLOCKING findings → auto-fix loop (up to 3 attempts) → re-run agents on fixed code → if still BLOCKING → FAIL
- SUPPRESSED findings are never shown to the user
- An empty report (0 blocking, 0 warnings) is a valid outcome — it means the code is clean. Do NOT fabricate findings.

### Step 3: Verification & Commit

1. Re-run automated checks to confirm fixes
2. Generate smart commit message from branch name + changes
3. For `--scope changed`: auto-commit and exit
4. For `--scope branch`/`all`: create PR

### Step 4: Merge & Deploy (if `--merge`)

**HARD GATE — Review Trailer Required (NON-NEGOTIABLE)**

Before calling `gh pr merge`, verify the review pipeline actually ran. At high/critical tier, also verify any `Quality-Skip` trailer is well-formed.

```bash
# BS_QUALITY_LOAD_ROOT — restore cwd resolved in Step -1
BS_QUALITY_ROOT_FILE="${TMPDIR:-/tmp}/bs-quality-gitroot-${CLAUDE_CODE_SESSION_ID:-default}.txt"
GIT_ROOT="$(cat "$BS_QUALITY_ROOT_FILE" 2>/dev/null)"
if [ -z "$GIT_ROOT" ]; then
  echo "[quality] WARN: sentinel missing ($BS_QUALITY_ROOT_FILE) — falling back to cwd git root" >&2
  GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
fi
# Empty-string guard: bash 3.2 (macOS default /bin/bash) treats `cd ""` as a
# silent no-op, defeating the `cd ... || exit` check. Verify GIT_ROOT is
# non-empty before attempting cd.
[ -n "$GIT_ROOT" ] || { echo "❌ git root unresolved (no sentinel, not in a git repo)"; exit 1; }
cd "$GIT_ROOT" || { echo "❌ cannot enter git root: $GIT_ROOT"; exit 1; }

# Use the resolved base from Step 0.5/2.6 — NOT hardcoded main.
BASE_REF="${RESOLVED_BASE:-origin/main}"

# 1. Reviewed-By: claude-quality is required at every tier.
#    If the trailer is missing but the quality pipeline just completed in THIS
#    run (Step 1.8 set $QUALITY_PIPELINE_RAN=true), auto-stamp the trailer via
#    an empty commit so the merge gate is consistent regardless of how the
#    fix commits were authored. This avoids "quality passed but the last commit
#    didn't include the trailer → operator must manually amend" footgun.
#
#    If the pipeline did NOT run in this invocation (e.g. operator passed
#    --merge alone with no quality work), we hard-block — auto-stamping then
#    would be forging review evidence.
if ! git log "${BASE_REF}..HEAD" --format=%B | grep -q "Reviewed-By: claude-quality"; then
  if [ "${QUALITY_PIPELINE_RAN:-false}" = true ]; then
    TIER_LABEL="${TIER:-L${LEVEL}}"
    AGENT_COUNT=${#AGENTS[@]}
    FINDING_COUNT=${BLOCKING_COUNT:-0}
    echo "[quality] No claude-quality trailer on existing commits — auto-stamping (pipeline ran in this invocation)."
    git commit --allow-empty -m "chore(quality): stamp review trailer

Reviewed-By: claude-quality (tier=${TIER_LABEL}, agents=${AGENT_COUNT}, findings=${FINDING_COUNT})" \
      || { echo "❌ Failed to create auto-stamp commit — aborting merge"; exit 1; }
    git push || { echo "❌ Failed to push auto-stamp commit — aborting merge"; exit 1; }
  else
    echo "❌ MERGE BLOCKED: No 'Reviewed-By: claude-quality' trailer found."
    echo "   The review pipeline (Step 1.8) did not run or did not complete in this invocation."
    echo "   You MUST run the full quality loop including review agents before --merge."
    echo "   Do NOT manually add this trailer — it is only valid when produced by Step 1.8."
    exit 1
  fi
fi

# 2. High/critical tiers: require EITHER a real Reviewed-By: codex trailer
#    OR a verified Quality-Skip trailer with non-empty reason.
if [ "$TIER" = "high" ] || [ "$TIER" = "critical" ]; then
  HAS_CODEX_TRAILER=false
  if git log "${BASE_REF}..HEAD" --format=%B | grep -q "^Reviewed-By: codex"; then
    HAS_CODEX_TRAILER=true
  fi

  SKIP_TRAILER=$(git log "${BASE_REF}..HEAD" --format=%B | grep "^Quality-Skip:" | tail -1)
  HAS_VALID_SKIP=false
  if [ -n "$SKIP_TRAILER" ]; then
    # Parse trailer: head=<sha>, base=<sha>, reason=<text>
    SKIP_HEAD=$(echo "$SKIP_TRAILER" | grep -oE 'head=[a-f0-9]+' | cut -d= -f2)
    SKIP_BASE=$(echo "$SKIP_TRAILER" | grep -oE 'base=[a-f0-9]+' | cut -d= -f2)
    SKIP_REASON=$(echo "$SKIP_TRAILER" | grep -oE 'reason="[^"]*"' | sed 's/reason="//;s/"$//')
    CURRENT_HEAD=$(git rev-parse HEAD)
    CURRENT_HEAD_PARENT=$(git rev-parse HEAD~1 2>/dev/null || true)
    CURRENT_BASE=$(git merge-base HEAD "$BASE_REF")

    # SKIP_HEAD may match HEAD (trailer baked into the reviewed commit) OR
    # HEAD~1 (canonical stamp-pattern: empty trailer commit on top of the
    # reviewed change). The HEAD~1 path closes a chicken-and-egg defect —
    # a self-referential head= is unsatisfiable since adding the trailer
    # changes the commit's own SHA. Mirrors harness-gate.yml check.
    if [ "$SKIP_HEAD" != "$CURRENT_HEAD" ] && [ "$SKIP_HEAD" != "$CURRENT_HEAD_PARENT" ]; then
      echo "❌ MERGE BLOCKED: Quality-Skip trailer head=$SKIP_HEAD does not match HEAD=$CURRENT_HEAD or HEAD~1=$CURRENT_HEAD_PARENT."
      echo "   Stale skip trailer cannot authorize this merge — re-run quality."
      exit 1
    elif [ "$SKIP_BASE" != "$CURRENT_BASE" ]; then
      echo "❌ MERGE BLOCKED: Quality-Skip trailer base=$SKIP_BASE does not match merge-base=$CURRENT_BASE."
      exit 1
    elif [ -z "$(echo "$SKIP_REASON" | tr -d '[:space:]')" ]; then
      echo "❌ MERGE BLOCKED: Quality-Skip reason= is empty after stripping whitespace."
      exit 1
    else
      HAS_VALID_SKIP=true
      echo "[quality] Quality-Skip trailer verified (reason=\"$SKIP_REASON\")"
    fi
  fi

  # The XOR rule: at high/critical, exactly ONE form of evidence — both is
  # ambiguous (which is authoritative?), neither is unauthorized.
  if [ "$HAS_CODEX_TRAILER" = false ] && [ "$HAS_VALID_SKIP" = false ]; then
    echo "❌ MERGE BLOCKED: tier=$TIER requires either:"
    echo "     (a) a 'Reviewed-By: codex' trailer from a completed Codex review, or"
    echo "     (b) a verified 'Quality-Skip: codex-judge' trailer with a non-empty reason."
    echo "   Neither was found. --no-codex at $TIER must be converted to --codex-skip \"<reason>\"."
    exit 1
  fi
  if [ "$HAS_CODEX_TRAILER" = true ] && [ "$HAS_VALID_SKIP" = true ]; then
    echo "❌ MERGE BLOCKED: tier=$TIER has BOTH a 'Reviewed-By: codex' trailer AND a"
    echo "   'Quality-Skip' trailer. Exactly one is authoritative — drop the stale one."
    echo "   If Codex actually ran on this commit, remove the Quality-Skip trailer."
    echo "   If Codex was skipped, drop the stale Reviewed-By: codex (likely from a prior commit)."
    exit 1
  fi
fi
```

This gate prevents merging when review agents were skipped — whether by shortcutting, by error, or by running only automated checks. The trailer is written in Step 1.8 (Review Stamp) ONLY after all review agents + judge synthesis complete. No trailer = no merge. No exceptions. At high/critical, a `Quality-Skip` trailer is the ONLY authoritative bypass — `.claude/quality-skip-log.json` is telemetry only.

1. Push branch, create PR via `gh pr create`
2. Wait for CI (unless `--skip-ci`)
3. Auto-merge via `gh pr merge --squash`
4. **Worktree-aware cleanup** — leave the operator on the primary checkout's
   `main`, merged worktree removed, local branch deleted, stale refs pruned.
   Failures here MUST surface (CLAUDE.md "zero silent failures") — a partial
   cleanup is worse than a noisy one because it leaks state into the next
   session.

   ```bash
   # Capture the worktree path + branch BEFORE checking out main, so we know
   # what to remove after returning to the primary checkout.
   WORKTREE_PATH=$(git rev-parse --show-toplevel)
   FEATURE_BRANCH=$(git rev-parse --abbrev-ref HEAD)
   PRIMARY_CHECKOUT=$(git worktree list --porcelain | awk '/^worktree / {p=$2} /^branch refs\/heads\/main$/ {print p; exit}')

   if [ -z "$PRIMARY_CHECKOUT" ]; then
     echo "[quality] Could not locate primary checkout (no worktree has main checked out)."
     echo "         Skipping cleanup — operator must remove worktree + branch manually:"
     echo "           git worktree remove $WORKTREE_PATH"
     echo "           git branch -D $FEATURE_BRANCH"
     exit 0
   fi

   if [ "$PRIMARY_CHECKOUT" = "$WORKTREE_PATH" ]; then
     # Running directly in the primary checkout (against project policy, but
     # supported for backwards compatibility — Step -1 only blocks this for
     # `--merge`-from-main).
     git checkout main || { echo "❌ Could not checkout main in primary — aborting cleanup"; exit 1; }
     git pull --ff-only || { echo "❌ git pull --ff-only failed — investigate before retrying"; exit 1; }
     git branch -D "$FEATURE_BRANCH" || \
       echo "[quality] Could not delete branch $FEATURE_BRANCH — remove manually."
     exit 0
   fi

   # We ran in a linked worktree. Tear it down in the right order:
   # checkout main FIRST (so the branch is no longer "in use" by the worktree
   # we are about to remove), then remove the worktree, then delete the branch.
   cd "$PRIMARY_CHECKOUT" || { echo "❌ Could not cd to $PRIMARY_CHECKOUT — aborting cleanup"; exit 1; }
   git checkout main || { echo "❌ Could not checkout main in $PRIMARY_CHECKOUT (likely uncommitted changes there) — aborting cleanup"; exit 1; }
   git pull --ff-only || { echo "❌ git pull --ff-only failed — investigate before retrying"; exit 1; }

   if ! git worktree remove "$WORKTREE_PATH"; then
     echo "❌ Could not remove worktree $WORKTREE_PATH (likely uncommitted changes inside)."
     echo "   Resolve manually, then run: git worktree remove $WORKTREE_PATH && git branch -D $FEATURE_BRANCH"
     exit 1
   fi
   if ! git branch -D "$FEATURE_BRANCH"; then
     echo "❌ Could not delete branch $FEATURE_BRANCH — remove manually with: git branch -D $FEATURE_BRANCH"
     exit 1
   fi
   git worktree prune -v
   ```

   Without this tail, every merge leaves an orphaned worktree and a stale local
   branch — within a few PRs the repo accumulates a graveyard.

5. Remind the user to verify deployment health with their normal deployment tooling

### Step 5: Record Quality History

Update `.qualityrc.json` with run results (score, coverage, duration, cost). Display next-step suggestions.

## Parallel Sub-Review Mode (acpx)

When invoked with `--parallel`, fire security, coverage, and perf sub-reviews as concurrent acpx sessions instead of running them sequentially inside the main loop.

### Usage

```
/bs:quality --parallel [other flags]
```

### How It Works

Requires acpx ≥ 0.5.3. Commands are agent-scoped (`acpx claude …`) in current versions.

1. **Check acpx availability**: `command -v acpx`. If unavailable, fall back to sequential (log a warning).
2. **Create sessions, then fire prompts concurrently**:

```bash
# BS_QUALITY_LOAD_ROOT — restore cwd resolved in Step -1
BS_QUALITY_ROOT_FILE="${TMPDIR:-/tmp}/bs-quality-gitroot-${CLAUDE_CODE_SESSION_ID:-default}.txt"
GIT_ROOT="$(cat "$BS_QUALITY_ROOT_FILE" 2>/dev/null)"
if [ -z "$GIT_ROOT" ]; then
  echo "[quality] WARN: sentinel missing ($BS_QUALITY_ROOT_FILE) — falling back to cwd git root" >&2
  GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
fi
# Empty-string guard: bash 3.2 (macOS default /bin/bash) treats `cd ""` as a
# silent no-op, defeating the `cd ... || exit` check. Verify GIT_ROOT is
# non-empty before attempting cd.
[ -n "$GIT_ROOT" ] || { echo "❌ git root unresolved (no sentinel, not in a git repo)"; exit 1; }
cd "$GIT_ROOT" || { echo "❌ cannot enter git root: $GIT_ROOT"; exit 1; }

TIMESTAMP=$(date +%s)
for kind in security coverage perf; do
  acpx claude sessions new --name "quality-${kind}-${TIMESTAMP}" >/dev/null
done

acpx claude prompt --no-wait -s "quality-security-${TIMESTAMP}" \
  "Security review: examine [diff/files] for OWASP top 10, secrets, injection flaws. Output structured findings."
acpx claude prompt --no-wait -s "quality-coverage-${TIMESTAMP}" \
  "Coverage review: examine [diff/files] for missing tests, uncovered branches, weak assertions. Output structured findings."
acpx claude prompt --no-wait -s "quality-perf-${TIMESTAMP}" \
  "Performance review: examine [diff/files] for N+1 queries, unguarded loops, missing memoization. Output structured findings."
```

3. **Poll until all sessions complete** (status can stay "running" post-completion, so detect an assistant entry after the latest user entry via history):

```bash
# BS_QUALITY_LOAD_ROOT — restore cwd resolved in Step -1
BS_QUALITY_ROOT_FILE="${TMPDIR:-/tmp}/bs-quality-gitroot-${CLAUDE_CODE_SESSION_ID:-default}.txt"
GIT_ROOT="$(cat "$BS_QUALITY_ROOT_FILE" 2>/dev/null)"
if [ -z "$GIT_ROOT" ]; then
  echo "[quality] WARN: sentinel missing ($BS_QUALITY_ROOT_FILE) — falling back to cwd git root" >&2
  GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
fi
# Empty-string guard: bash 3.2 (macOS default /bin/bash) treats `cd ""` as a
# silent no-op, defeating the `cd ... || exit` check. Verify GIT_ROOT is
# non-empty before attempting cd.
[ -n "$GIT_ROOT" ] || { echo "❌ git root unresolved (no sentinel, not in a git repo)"; exit 1; }
cd "$GIT_ROOT" || { echo "❌ cannot enter git root: $GIT_ROOT"; exit 1; }

session_done() {
  local session="$1"
  acpx claude sessions read "$session" --tail 4 2>/dev/null \
    | awk '/^user/{u=NR} /^assistant/{a=NR} END{exit !(a>u)}'
}

for session in quality-security-${TIMESTAMP} quality-coverage-${TIMESTAMP} quality-perf-${TIMESTAMP}; do
  for _ in $(seq 1 80); do
    session_done "$session" && break
    sleep 3
  done
done
```

4. **Collect outputs** (read session history):

```bash
# BS_QUALITY_LOAD_ROOT — restore cwd resolved in Step -1
BS_QUALITY_ROOT_FILE="${TMPDIR:-/tmp}/bs-quality-gitroot-${CLAUDE_CODE_SESSION_ID:-default}.txt"
GIT_ROOT="$(cat "$BS_QUALITY_ROOT_FILE" 2>/dev/null)"
if [ -z "$GIT_ROOT" ]; then
  echo "[quality] WARN: sentinel missing ($BS_QUALITY_ROOT_FILE) — falling back to cwd git root" >&2
  GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
fi
# Empty-string guard: bash 3.2 (macOS default /bin/bash) treats `cd ""` as a
# silent no-op, defeating the `cd ... || exit` check. Verify GIT_ROOT is
# non-empty before attempting cd.
[ -n "$GIT_ROOT" ] || { echo "❌ git root unresolved (no sentinel, not in a git repo)"; exit 1; }
cd "$GIT_ROOT" || { echo "❌ cannot enter git root: $GIT_ROOT"; exit 1; }

SECURITY_OUT=$(acpx claude sessions read "quality-security-${TIMESTAMP}" --tail 1)
COVERAGE_OUT=$(acpx claude sessions read "quality-coverage-${TIMESTAMP}" --tail 1)
PERF_OUT=$(acpx claude sessions read "quality-perf-${TIMESTAMP}" --tail 1)

for kind in security coverage perf; do
  acpx claude sessions close "quality-${kind}-${TIMESTAMP}" >/dev/null 2>&1 || true
done
```

5. **Synthesize**: combine all three outputs into the unified quality report (same format as sequential mode). Continue to Step 2 (Agent Result Validation) as normal.

### Fallback

If `acpx` is not installed or any session fails to launch, log:

```
[quality] acpx unavailable or launch failed — falling back to sequential sub-reviews
```

Then run security → coverage → perf in order using the standard sequential flow.

## Supporting Files

- `reference.md` — Flag definitions, scope options, quality levels, audit mode, teams mode
- `checklist.md` — Exit criteria, agent validation rules, scoring, pattern categories
