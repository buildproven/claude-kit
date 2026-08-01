---
name: bs:test
standalone: true
description: Run tests with various modes (watch, coverage, specific files)
argument-hint: "[file|pattern] [--watch|--coverage|--debug] → run tests"
tags: [testing, development, workflow]
category: quality
---

# /bs:test - Standalone Test Command

## Usage

```bash
# Run all tests
/bs:test

# Watch mode for TDD
/bs:test --watch

# Coverage report
/bs:test --coverage

# Specific file or pattern
/bs:test path/to/file.test
/bs:test "**/*.test.ts"

# Debug failing tests
/bs:test --debug

# Update snapshots
/bs:test --update-snapshots

# Run specific test suite
/bs:test --grep "authentication"
```

## Implementation Instructions

### Step 1: Detect Package Manager

```bash
# Auto-detect package manager
if [ -f "pnpm-lock.yaml" ]; then
  PKG_MANAGER="pnpm"
elif [ -f "yarn.lock" ]; then
  PKG_MANAGER="yarn"
elif [ -f "package-lock.json" ]; then
  PKG_MANAGER="npm"
else
  PKG_MANAGER="npm"  # default fallback
fi
```

### Step 2: Parse Arguments and Build Test Command

```bash
# Parse arguments into an array, not a concatenated string — avoids needing
# eval (and its quoting hazards) to expand this later.
TEST_ARGS=()
FILE_PATTERN=""
MODE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --watch)
      MODE="watch"
      shift
      ;;
    --coverage)
      TEST_ARGS+=(--coverage)
      shift
      ;;
    --debug)
      TEST_ARGS+=(--verbose --no-coverage)
      shift
      ;;
    --update-snapshots)
      TEST_ARGS+=(--updateSnapshot)
      shift
      ;;
    --grep)
      TEST_ARGS+=(--grep "$2")
      shift 2
      ;;
    --*)
      # Pass through any other flags
      TEST_ARGS+=("$1")
      shift
      ;;
    *)
      # Assume it's a file pattern
      FILE_PATTERN="$1"
      shift
      ;;
  esac
done
```

### Step 3: Build and Execute Test Command

```bash
# Build the full command as an array — same pieces as before, but expanded
# with "${TEST_CMD[@]}" instead of eval, so a file pattern or --grep value
# containing shell metacharacters (e.g. `/bs:test "**/*.test.ts"`) is passed
# through literally rather than re-interpreted by the shell.
# "${TEST_ARGS[@]+"${TEST_ARGS[@]}"}" (not plain "${TEST_ARGS[@]}") because
# macOS ships bash 3.2 by default, and pre-4.4 bash treats an empty array
# expansion as an unbound variable under `set -u`.
if [ "$MODE" = "watch" ]; then
  case $PKG_MANAGER in
    pnpm) TEST_CMD=(pnpm test --watch "${TEST_ARGS[@]+"${TEST_ARGS[@]}"}") ;;
    yarn) TEST_CMD=(yarn test --watch "${TEST_ARGS[@]+"${TEST_ARGS[@]}"}") ;;
    npm) TEST_CMD=(npm test -- --watch "${TEST_ARGS[@]+"${TEST_ARGS[@]}"}") ;;
  esac
else
  case $PKG_MANAGER in
    pnpm) TEST_CMD=(pnpm test "${TEST_ARGS[@]+"${TEST_ARGS[@]}"}") ;;
    yarn) TEST_CMD=(yarn test "${TEST_ARGS[@]+"${TEST_ARGS[@]}"}") ;;
    npm) TEST_CMD=(npm test -- "${TEST_ARGS[@]+"${TEST_ARGS[@]}"}") ;;
  esac
fi

# Add file pattern if specified. The documented usage (`/bs:test
# "**/*.test.ts"`) expects glob expansion, not a literal string passed to
# the runner — most runners treat positional args as path substrings, not
# shell globs. `shopt -s globstar` is bash 4+ only and macOS ships bash 3.2
# by default (still true as of macOS's current release) — `shopt -s
# globstar` hard-errors there, so recursive `**` needs `find`, not bash
# glob options, to work on every supported shell. Multiple matches are
# passed as separate positional args (each a filter, per Jest/Vitest
# semantics) — this is intentional: it's what the documented pattern is
# supposed to do, and is now reliable instead of depending on the caller's
# shell state the way the eval path did.
FILE_MATCHES=()
if [ -n "$FILE_PATTERN" ]; then
  case "$FILE_PATTERN" in
    '**/'*)
      # Only the documented leading-**/ form is handled recursively (e.g.
      # "**/*.test.ts") — find -path's fnmatch already spans "/" for a bare
      # "*", so stripping the leading "**/ " and matching the remainder
      # against every path (not just the top level) is sufficient and
      # matches files at any depth, including depth zero. A "**" appearing
      # mid-pattern (e.g. "src/**/*.test.ts") or with no trailing wildcard
      # (e.g. "**/auth.test.ts") is not a documented usage and falls through
      # to the literal branch below instead of guessing at semantics.
      FIND_PATTERN="./${FILE_PATTERN#\*\*/}"
      case "$FIND_PATTERN" in
        *'**'*) ;; # mid-pattern ** after stripping the prefix — not supported, fall through
        *)
          # Prune common dependency/build/vcs trees — an unpruned recursive
          # search over "**/*.test.ts" in a real Node repo can pull in
          # thousands of node_modules test files, select unintended tests,
          # or exceed the shell's argument limit.
          while IFS= read -r -d '' match; do
            FILE_MATCHES+=("${match#./}")
          done < <(find . \( -name node_modules -o -name .git -o -name dist \
            -o -name build -o -name coverage -o -name .next -o -name .turbo \) \
            -prune -o -type f -path "$FIND_PATTERN" -print0 2>/dev/null)
          ;;
      esac
      ;;
    *'**'*) ;; # mid-pattern ** — not supported, fall through to literal
    *)
      # Single-level glob or a plain filename — ordinary bash globbing
      # (no globstar needed) works on every supported shell.
      shopt -s nullglob
      # shellcheck disable=SC2206  # word-splitting is the point: expand into an array
      FILE_MATCHES=($FILE_PATTERN)
      shopt -u nullglob
      ;;
  esac
  if [ "${#FILE_MATCHES[@]}" -gt 0 ]; then
    TEST_CMD+=("${FILE_MATCHES[@]}")
  else
    # No glob metacharacters, nothing matched, or an unsupported ** position
    # — pass through literally so a plain filename (`/bs:test
    # path/to/file.test`) still works and the runner reports "no match"
    # itself for anything else, rather than the argument silently vanishing.
    TEST_CMD+=("$FILE_PATTERN")
  fi
fi

# Execute
echo "🧪 Running tests..."
echo "Command: ${TEST_CMD[*]}"
echo ""

"${TEST_CMD[@]}"
TEST_EXIT_CODE=$?
```

### Step 4: Report Results

```bash
echo ""
if [ $TEST_EXIT_CODE -eq 0 ]; then
  echo "✅ All tests passed"
else
  echo "❌ Tests failed (exit code: $TEST_EXIT_CODE)"
  echo ""
  echo "💡 Tip: Use --debug for verbose output"
  echo "💡 Tip: Use --watch for TDD workflow"
fi

exit $TEST_EXIT_CODE
```

## Examples

```bash
/bs:test                              # Full test suite
/bs:test --watch                      # TDD watch mode
/bs:test --coverage                   # Coverage report (→ coverage/)
/bs:test src/auth/login.test.ts       # Specific file
/bs:test "**/*auth*.test.ts"          # Pattern
/bs:test --debug                      # Verbose, no coverage overhead
/bs:test --update-snapshots           # After intentional UI changes
/bs:test --grep "authentication"      # Filter by name (Jest/Vitest/Mocha)
```
