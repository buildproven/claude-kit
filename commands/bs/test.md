---
name: bs:test
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
# Parse arguments
TEST_ARGS=""
FILE_PATTERN=""
MODE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --watch)
      MODE="watch"
      shift
      ;;
    --coverage)
      TEST_ARGS="$TEST_ARGS --coverage"
      shift
      ;;
    --debug)
      TEST_ARGS="$TEST_ARGS --verbose --no-coverage"
      shift
      ;;
    --update-snapshots)
      TEST_ARGS="$TEST_ARGS --updateSnapshot"
      shift
      ;;
    --grep)
      TEST_ARGS="$TEST_ARGS --grep $2"
      shift 2
      ;;
    --*)
      # Pass through any other flags
      TEST_ARGS="$TEST_ARGS $1"
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
# Build base command
if [ "$MODE" = "watch" ]; then
  # Watch mode
  case $PKG_MANAGER in
    pnpm)
      TEST_CMD="pnpm test --watch $TEST_ARGS"
      ;;
    yarn)
      TEST_CMD="yarn test --watch $TEST_ARGS"
      ;;
    npm)
      TEST_CMD="npm test -- --watch $TEST_ARGS"
      ;;
  esac
else
  # Regular mode
  case $PKG_MANAGER in
    pnpm)
      TEST_CMD="pnpm test $TEST_ARGS"
      ;;
    yarn)
      TEST_CMD="yarn test $TEST_ARGS"
      ;;
    npm)
      TEST_CMD="npm test -- $TEST_ARGS"
      ;;
  esac
fi

# Add file pattern if specified
if [ -n "$FILE_PATTERN" ]; then
  TEST_CMD="$TEST_CMD $FILE_PATTERN"
fi

# Execute
echo "🧪 Running tests..."
echo "Command: $TEST_CMD"
echo ""

eval $TEST_CMD
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
