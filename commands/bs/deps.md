---
name: bs:deps
description: 'Dependency health management: outdated packages, security audit, smart upgrades'
argument-hint: '/bs:deps → check outdated | --audit → security | --upgrade → interactive upgrade | --analyze → bundle size'
category: maintenance
model: sonnet
---

# /bs:deps - Dependency Health Management

**Proactive dependency management to prevent drift, security vulnerabilities, and bundle bloat**

## Usage

```bash
/bs:deps                # Check outdated packages
/bs:deps --audit        # Security vulnerability scan
/bs:deps --upgrade      # Interactive upgrade with tests
/bs:deps --analyze      # Bundle size analysis
```

---

## Mode 1: Check Outdated (Default)

**Shows which dependencies have updates available**

### Implementation

```bash
# Auto-detect package manager
if [ -f "pnpm-lock.yaml" ]; then
  PKG_MGR="pnpm"
  OUTDATED_CMD="pnpm outdated"
elif [ -f "yarn.lock" ]; then
  PKG_MGR="yarn"
  OUTDATED_CMD="yarn outdated"
elif [ -f "package-lock.json" ]; then
  PKG_MGR="npm"
  OUTDATED_CMD="npm outdated"
else
  echo "❌ No package manager detected (no lock file found)"
  exit 1
fi

echo "📦 Checking for outdated dependencies ($PKG_MGR)..."
echo ""

# Run outdated check
$OUTDATED_CMD

# Capture exit code (npm outdated returns 1 if outdated packages exist)
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo ""
  echo "✅ All dependencies are up to date!"
else
  echo ""
  echo "⚠️  Outdated dependencies found"
  echo ""
  echo "**Next steps:**"
  echo "  /bs:deps --upgrade    # Interactive upgrade"
  echo "  /bs:deps --audit      # Check for vulnerabilities"
fi
```

**Output Example:**

```
📦 Checking for outdated dependencies (pnpm)...

Package         Current  Wanted   Latest
next            14.0.0   14.0.4   14.1.0
typescript      5.2.2    5.2.2    5.3.3
@types/react    18.2.0   18.2.45  18.2.45

⚠️  Outdated dependencies found

**Next steps:**
  /bs:deps --upgrade    # Interactive upgrade
  /bs:deps --audit      # Check for vulnerabilities
```

---

## Mode 2: Security Audit (--audit)

**Scan for security vulnerabilities**

### Implementation

```bash
# Auto-detect package manager
if [ -f "pnpm-lock.yaml" ]; then
  AUDIT_CMD="pnpm audit"
elif [ -f "yarn.lock" ]; then
  AUDIT_CMD="yarn audit"
elif [ -f "package-lock.json" ]; then
  AUDIT_CMD="npm audit"
else
  echo "❌ No package manager detected"
  exit 1
fi

echo "🔒 Running security audit..."
echo ""

# Run audit
$AUDIT_CMD

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo ""
  echo "✅ No vulnerabilities found!"
else
  echo ""
  echo "⚠️  Vulnerabilities detected"
  echo ""
  echo "**Fix options:**"
  echo "  ${PKG_MGR} audit fix              # Auto-fix (safe updates)"
  echo "  ${PKG_MGR} audit fix --force      # Force fix (may break)"
  echo "  /bs:deps --upgrade                # Manual upgrade"
fi
```

**Output Example:**

```
🔒 Running security audit...

found 3 vulnerabilities (2 moderate, 1 high)

┌───────────────┬──────────────────────────────────────────────────┐
│ moderate      │ Prototype Pollution                              │
├───────────────┼──────────────────────────────────────────────────┤
│ Package       │ minimist                                         │
├───────────────┼──────────────────────────────────────────────────┤
│ Patched in    │ >=1.2.6                                          │
├───────────────┼──────────────────────────────────────────────────┤
│ Dependency of │ webpack-dev-server                               │
└───────────────┴──────────────────────────────────────────────────┘

⚠️  Vulnerabilities detected

**Fix options:**
  pnpm audit fix              # Auto-fix (safe updates)
  pnpm audit fix --force      # Force fix (may break)
  /bs:deps --upgrade          # Manual upgrade
```

---

## Mode 3: Interactive Upgrade (--upgrade)

**Smart dependency upgrades with test verification**

### Implementation

```bash
# Auto-detect package manager
if [ -f "pnpm-lock.yaml" ]; then
  PKG_MGR="pnpm"
  UPDATE_CMD="pnpm update --interactive"
elif [ -f "yarn.lock" ]; then
  PKG_MGR="yarn"
  UPDATE_CMD="yarn upgrade-interactive"
elif [ -f "package-lock.json" ]; then
  PKG_MGR="npm"
  # npm doesn't have interactive, use ncu if available
  if command -v ncu &> /dev/null; then
    UPDATE_CMD="ncu --interactive"
  else
    echo "💡 Install npm-check-updates for interactive mode:"
    echo "   npm install -g npm-check-updates"
    echo ""
    echo "Falling back to manual upgrade..."
    UPDATE_CMD="npm update"
  fi
else
  echo "❌ No package manager detected"
  exit 1
fi

echo "📦 Interactive dependency upgrade..."
echo ""

# Run interactive update
$UPDATE_CMD

# After upgrades, verify with tests
echo ""
echo "🧪 Verifying upgrades with tests..."
echo ""

# Detect test command
if grep -q '"test":' package.json; then
  TEST_CMD="$PKG_MGR test"

  $TEST_CMD

  if [ $? -eq 0 ]; then
    echo ""
    echo "✅ All tests pass after upgrade!"
    echo ""
    echo "**Next steps:**"
    echo "  1. Review changes: git diff package.json"
    echo "  2. Test manually in dev: ${PKG_MGR} dev"
    echo "  3. Commit: git add . && git commit -m 'chore: upgrade dependencies'"
  else
    echo ""
    echo "❌ Tests failed after upgrade"
    echo ""
    echo "**Rollback options:**"
    echo "  git checkout package.json ${PKG_MGR}-lock.*    # Undo changes"
    echo "  ${PKG_MGR} install                             # Restore old versions"
  fi
else
  echo "⚠️  No test script found - skipping verification"
  echo ""
  echo "**Recommended:**"
  echo "  1. Test manually: ${PKG_MGR} dev"
  echo "  2. Check for runtime errors"
  echo "  3. Commit if all looks good"
fi
```

**Output Example:**

```
📦 Interactive dependency upgrade...

? Select packages to update:
  ◯ next@14.0.0 → 14.1.0 (minor)
  ◉ typescript@5.2.2 → 5.3.3 (minor)
  ◯ @types/react@18.2.0 → 18.2.45 (patch)

✅ Upgraded 1 package

🧪 Verifying upgrades with tests...

  ✓ All tests passed (127/127)

✅ All tests pass after upgrade!

**Next steps:**
  1. Review changes: git diff package.json
  2. Test manually in dev: pnpm dev
  3. Commit: git add . && git commit -m 'chore: upgrade dependencies'
```

---

## Mode 4: Bundle Size Analysis (--analyze)

**Analyze bundle size and find bloat**

### Implementation

```bash
echo "📊 Analyzing bundle size..."
echo ""

# Check if webpack-bundle-analyzer is installed
if ! grep -q "webpack-bundle-analyzer" package.json; then
  echo "📦 Installing webpack-bundle-analyzer..."

  if [ -f "pnpm-lock.yaml" ]; then
    pnpm add -D webpack-bundle-analyzer
  elif [ -f "yarn.lock" ]; then
    yarn add -D webpack-bundle-analyzer
  else
    npm install -D webpack-bundle-analyzer
  fi
fi

# Check for Next.js
if grep -q '"next":' package.json; then
  echo "🔍 Detected Next.js project"
  echo ""
  echo "Adding bundle analyzer to next.config.js..."

  # Check if @next/bundle-analyzer is installed
  if ! grep -q "@next/bundle-analyzer" package.json; then
    if [ -f "pnpm-lock.yaml" ]; then
      pnpm add -D @next/bundle-analyzer
    elif [ -f "yarn.lock" ]; then
      yarn add -D @next/bundle-analyzer
    else
      npm install -D @next/bundle-analyzer
    fi
  fi

  echo ""
  echo "**Run with:**"
  echo "  ANALYZE=true npm run build"
  echo ""
  echo "This will open a visual bundle analyzer in your browser."

elif [ -f "webpack.config.js" ]; then
  echo "🔍 Detected Webpack project"
  echo ""
  echo "**Add to webpack.config.js:**"
  echo ""
  echo "const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;"
  echo ""
  echo "module.exports = {"
  echo "  plugins: ["
  echo "    new BundleAnalyzerPlugin()"
  echo "  ]"
  echo "}"

else
  echo "⚠️  No supported bundler detected"
  echo ""
  echo "**Manual options:**"
  echo "  - Use source-map-explorer: npm install -g source-map-explorer"
  echo "  - Check build output size: du -sh dist/ build/"
fi
```

---

## Quick Reference

| Command              | What It Does                               |
| -------------------- | ------------------------------------------ |
| `/bs:deps`           | Check for outdated packages                |
| `/bs:deps --audit`   | Security vulnerability scan                |
| `/bs:deps --upgrade` | Interactive upgrade with test verification |
| `/bs:deps --analyze` | Bundle size analysis                       |

---

## When to Use

**Weekly health check:**

```bash
/bs:deps --audit    # Check security issues
```

**Before major work:**

```bash
/bs:deps            # See what's outdated
/bs:deps --upgrade  # Update if needed
```

**After adding dependencies:**

```bash
/bs:deps --analyze  # Check bundle impact
```

**CI/CD integration:**

```yaml
# .github/workflows/deps-check.yml
name: Dependency Health

on:
  schedule:
    - cron: '0 0 * * 1' # Every Monday

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install
      - run: npm audit
      - run: npm outdated || true
```

---

## ⏭️ Next Steps

**After dependency upgrades:**

```bash
# Validate that upgrades didn't break anything
/bs:quality --scope changed
```

**Why:** Dependency upgrades can introduce breaking changes or subtle bugs. Run quality checks on changed files to catch issues before deploying.

---

## See Also

- `/bs:test` - Run test suite
- `/bs:quality` - Quality loop (includes dependency checks)
- `/bs:quality --level 98` - Comprehensive quality (includes security audit)
