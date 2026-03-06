---
name: bs:test
description: Run tests with various modes (watch, coverage, specific files)
argument-hint: '[file|pattern] [--watch|--coverage|--debug] → run tests'
tags: [testing, development, workflow]
category: quality
model: sonnet
---

# /bs:test - Standalone Test Command

**Run tests without full quality loop**

## What This Does

Runs your project's test suite with support for different modes and targets. Essential for TDD workflow and quick validation during development.

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

### Basic Test Run

```bash
/bs:test
# Runs full test suite once
```

### TDD Workflow

```bash
/bs:test --watch
# Watches for file changes and re-runs tests
# Perfect for test-driven development
```

### Coverage Report

```bash
/bs:test --coverage
# Generates coverage report
# Usually outputs to coverage/ directory
```

### Test Specific File

```bash
/bs:test src/auth/login.test.ts
# Runs only tests in specified file
```

### Test Pattern

```bash
/bs:test "**/*auth*.test.ts"
# Runs all auth-related tests
```

### Debug Failing Test

```bash
/bs:test --debug
# Verbose output, no coverage overhead
# Helps diagnose test failures
```

### Update Snapshots

```bash
/bs:test --update-snapshots
# Updates all snapshot files
# Use after intentional UI changes
```

### Test Specific Suite

```bash
/bs:test --grep "authentication"
# Runs only tests matching "authentication"
# Works with Mocha, Jest, Vitest
```

## Common Workflows

### TDD Cycle

```bash
# 1. Start watch mode
/bs:test --watch

# 2. Write failing test
# 3. Watch it fail (red)
# 4. Write minimal code to pass
# 5. Watch it pass (green)
# 6. Refactor
# 7. Tests still pass (green)
```

### Pre-Commit Check

```bash
# Quick validation before committing
/bs:test

# If all pass, commit
git add .
git commit -m "feat: add new feature"
```

### Coverage Analysis

```bash
# Generate coverage report
/bs:test --coverage

# Open coverage report (typical location)
open coverage/lcov-report/index.html
```

### Debugging Failed Test

```bash
# Step 1: Run with debug mode
/bs:test --debug

# Step 2: Run specific failing test
/bs:test path/to/failing.test.ts --debug

# Step 3: Add console.log or debugger statements
# Step 4: Re-run to see output
```

## Integration with Other Commands

### Before Creating PR

```bash
# Quick test run
/bs:test

# If pass, proceed to quality loop
/bs:quality --merge
```

### During Development

```bash
# Start feature
/bs:dev new-feature

# Open watch mode in separate terminal
/bs:test --watch

# Develop with instant feedback
```

### Full Quality Check

```bash
# Tests are included in /bs:quality and /bs:quality --level 98
# But /bs:test is faster for iteration

/bs:test              # Quick (seconds)
/bs:quality             # Comprehensive (30-60 min)
/bs:quality --level 98           # Production-grade (1-3 hours)
```

## Test Framework Support

This command works with standard test runners:

- **Jest** - Default for most React/Node projects
- **Vitest** - Fast Vite-native test runner
- **Mocha** - Classic Node test framework
- **Ava** - Concurrent test runner
- **tape** - Minimal TAP test framework

All assume `test` script in `package.json`. Use ONE of these:

```json
// Jest (React/Node default)
{ "scripts": { "test": "jest" } }

// Vitest (Vite projects)
{ "scripts": { "test": "vitest" } }

// Mocha (Node classic)
{ "scripts": { "test": "mocha" } }
```

## Flags Reference

| Flag                 | Description                                            | Example                       |
| -------------------- | ------------------------------------------------------ | ----------------------------- |
| `--watch`            | Watch mode for TDD                                     | `/bs:test --watch`            |
| `--coverage`         | Generate coverage report                               | `/bs:test --coverage`         |
| `--debug`            | Verbose output, no coverage                            | `/bs:test --debug`            |
| `--update-snapshots` | Update snapshot files (Jest: `-u`, Vitest: `--update`) | `/bs:test --update-snapshots` |
| `--grep <pattern>`   | Run tests matching pattern                             | `/bs:test --grep "auth"`      |
| `<file-pattern>`     | Run specific file(s)                                   | `/bs:test "*.test.ts"`        |

## Exit Codes

- `0` - All tests passed
- `1` - One or more tests failed
- `127` - Test command not found (missing package.json script)

## Troubleshooting

**No tests found:**

- Verify `package.json` has `test` script
- Check file patterns match your test files
- Common patterns: `*.test.js`, `*.spec.ts`, `__tests__/*`

**Watch mode not working:**

- Some test runners require additional setup
- Check test runner documentation
- Try: `npm test -- --watchAll` (Jest)

**Coverage not generating:**

- Verify test runner supports coverage
- Check coverage directory in `.gitignore`
- Some runners need explicit config

**Tests pass locally but fail in CI:**

- Check for timing issues (use `waitFor` helpers)
- Verify environment variables are set
- Check for timezone differences
- Look for file system path issues

## See Also

- `/bs:quality` - 95% ship-ready standard (includes tests)
- `/bs:quality --level 98` - 98% production-perfect (includes tests + coverage)
- `/bs:dev` - Start development workflow
- `/bs:workflow` - Full workflow reference

---

**Quick testing without full quality loop - essential for TDD workflow**
