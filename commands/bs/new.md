---
model: opus
name: bs:new
description: Create new project with QA Architect quality automation (framework-agnostic)
argument-hint: '<project-name> [--path dir] → new project with QA Architect'
category: project
tags: [setup, init, quality, qa-architect]
---

model: opus

# /bs:new - Create New Project

**Usage**: `/bs:new <project-name> [--path ~/Projects]`

Creates a framework-agnostic project with production-ready quality infrastructure via QA Architect.

## What This Creates

```
my-project/
├── .git/                    # Git initialized
├── .github/workflows/       # GitHub Actions (qa-architect)
├── .husky/                  # Git hooks (qa-architect)
├── .claude-setup/           # claude-setup submodule
├── .qualityrc.json          # Quality maturity: prototype
├── .prettierrc              # Formatting rules (qa-architect)
├── .prettierignore          # Ignore patterns
├── .editorconfig            # IDE consistency
├── .gitignore               # Sensible defaults
├── .claudeignore            # Context optimization for Claude Code
├── .gitleaks.toml           # Secret scanning config (qa-architect Pro)
├── .nvmrc                   # Node version (20.11.1)
├── eslint.config.cjs        # ESLint config (qa-architect)
├── CLAUDE.md                # Minimal project guide
├── BACKLOG.md               # Value-scored backlog
├── README.md                # Basic structure
└── package.json             # Quality scripts + qa-architect
```

**What's NOT included:**

- No framework (Next.js, React, etc.)
- No architecture decisions
- No database setup
- No auth/payments

**You decide later:** Frontend? Backend? Language? The quality gates adapt.

## Implementation

### Step 1: Gather Info

```markdown
Creating new project: <project-name>

**Quick setup questions:**

1. **Location?** (default: ~/Projects/<project-name>)
2. **Description?** (1 sentence - for README/CLAUDE.md)
3. **License?** (MIT/proprietary)
4. **GitHub repo?** (default: yes, private)
   - **private** (default): `gh repo create <project-name> --private`
   - **public**: `gh repo create <project-name> --public`
   - **none**: Skip GitHub repo creation (local only)
5. **QA Architect workflow tier?**
   - **minimal** (default): Single Node 22, weekly security (~$0-5/mo)
   - **standard**: Matrix on main, weekly security (~$5-20/mo)
   - **comprehensive**: Matrix every commit, inline security (~$100-350/mo)
```

### Step 2: Create Directory Structure

```bash
PROJECT_PATH="${PATH:-$HOME/Projects}/<project-name>"

# Check if exists
if [[ -d "$PROJECT_PATH" ]]; then
  echo "❌ Project already exists: $PROJECT_PATH"
  exit 1
fi

mkdir -p "$PROJECT_PATH"
cd "$PROJECT_PATH"

echo "📁 Created: $PROJECT_PATH"
```

### Step 3: Initialize Git

```bash
git init
echo "✅ Git initialized"
```

### Step 4: Add claude-setup Submodule

```bash
# Add submodule
git submodule add https://github.com/YOUR_USER/claude-power-kit.git .claude-setup

# Create symlink to make commands available
ln -s .claude-setup ~/.claude 2>/dev/null || true

echo "✅ Added claude-setup submodule"
```

### Step 5: Create .qualityrc.json

```json
{
  "version": "0.1.0",
  "maturity": "prototype",
  "detected": {
    "level": "prototype",
    "sourceFiles": 0,
    "testFiles": 0,
    "hasDocumentation": false,
    "hasDependencies": false,
    "detectedAt": "2026-01-08T00:00:00.000Z"
  },
  "checks": {
    "prettier": {
      "enabled": true,
      "required": true
    },
    "eslint": {
      "enabled": "auto",
      "required": false
    },
    "stylelint": {
      "enabled": "auto",
      "required": false
    },
    "tests": {
      "enabled": "auto",
      "required": false
    },
    "coverage": {
      "enabled": false,
      "required": false,
      "threshold": 50
    },
    "security-audit": {
      "enabled": "auto",
      "required": false
    },
    "documentation": {
      "enabled": false,
      "required": false
    },
    "lighthouse": {
      "enabled": false,
      "required": false
    }
  }
}
```

**Note:** Maturity starts at "prototype" - minimal checks. As the project grows, `.qualityrc.json` auto-detects and upgrades to `mvp` → `beta` → `production-ready`.

### Step 6: Create .gitignore

```gitignore
# Dependencies
node_modules/
.pnp
.pnp.js

# Testing
coverage/
.nyc_output

# Build outputs
dist/
build/
out/
.next/
.vercel/
.turbo/

# Misc
.DS_Store
*.pem
.env
.env.local
.env.*.local
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# OS
Thumbs.db
```

### Step 6.5: Create .claudeignore

```
# Dependencies (large, low signal for Claude)
node_modules/
.pnp.*

# Build output
.next/
out/
dist/
build/
.vercel/
.netlify/

# Coverage & test artifacts
coverage/
.nyc_output/
test-results/
playwright-report/

# Lock files
package-lock.json
pnpm-lock.yaml
yarn.lock

# Caches
.cache/
.turbo/
.eslintcache
*.tsbuildinfo

# Generated
*.min.js
*.min.css
*.map

# OS / IDE
.DS_Store
Thumbs.db
.idea/
.vscode/settings.json

# Secrets
.env
.env.*
!.env.example
```

### Step 7: Create package.json

```json
{
  "name": "<project-name>",
  "version": "0.1.0",
  "private": true,
  "description": "<description>",
  "scripts": {
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  },
  "devDependencies": {},
  "engines": {
    "node": ">=20"
  }
}
```

**Note:** Minimal starter. QA Architect (Step 11) will enhance this with:

- Full quality scripts (lint, test, security, etc.)
- ESLint, Prettier, Stylelint, Husky, lint-staged
- Framework-specific dependencies as you add code

### Step 8: Create CLAUDE.md

````markdown
# <project-name> - Claude Guide

> <description>

## Project Status

**Stage:** Early exploration
**Stack:** TBD (choose framework/language)
**Quality Maturity:** Prototype

## Commands

```bash
# Quality checks (QA Architect)
npm run lint                # ESLint
npm run lint:fix            # ESLint with auto-fix
npm run format              # Prettier formatting
npm run format:check        # Check formatting
npm run quality:check       # Run all checks
npm run quality:fix         # Auto-fix all issues

# Testing (add when you add tests)
npm test                    # Run tests
npm run test:watch          # Watch mode
npm run test:coverage       # Coverage report
```
````

## Next Steps

1. **Choose your stack:**
   - Frontend? (Next.js, React, Vue, Svelte, etc.)
   - Backend? (Node.js, Python, Go, Rust, etc.)
   - Database? (PostgreSQL, MongoDB, etc.)

2. **Quality infrastructure is ready:**
   - ✅ ESLint + Prettier already configured
   - ✅ Pre-commit hooks active (Husky + lint-staged)
   - ✅ GitHub Actions workflow ready
   - ✅ Secret scanning enabled (Gitleaks)

3. **Add when you start coding:**
   - Test framework (Vitest, Jest, pytest, etc.)
   - Framework-specific ESLint plugins
   - Build tools for your stack

4. **Quality scales automatically:**
   - Maturity auto-detects: prototype → mvp → beta → production
   - Quality checks scale with maturity

## Architecture

Document your decisions here as you make them.

## What NOT to Do

- Don't commit secrets (use .env)
- Don't skip quality gates
- Don't use `any` types (TypeScript)
- Document as you build

---

model: opus

_Quality infrastructure from claude-setup. Global rules in `~/.claude/CLAUDE.md`._

````

### Step 9: Create BACKLOG.md

```markdown
# Backlog

## 🔥 High Value - Next Up

| ID | Feature | Value Drivers (Rev/Ret/Diff) | Effort | Status |
|----|---------|------------------------------|--------|--------|
| - | Choose tech stack | Foundation for everything | S | 🎯 Next |
| - | Setup dev environment | Enables development | S | Pending |

## 📊 Medium Value - Worth Doing

| ID | Feature | Value Drivers | Effort | Status |
|----|---------|---------------|--------|--------|
| - | Add CI/CD | Quality automation | M | Pending |

## 📚 Low Value - When Needed

| ID | Feature | Value Drivers | Effort | Status |
|----|---------|---------------|--------|--------|

## Completed ✅

| ID | Feature | Completed |
|----|---------|-----------|
| - | Quality infrastructure | 2026-01-08 |

---
model: opus

**Effort:** S (<4h) | M (4-16h) | L (16-40h) | XL (40h+)
**Value:** Revenue + Retention + Differentiation (1-5 each)
**Priority:** Value ÷ Effort = ROI Score
````

### Step 10: Create README.md

````markdown
# <project-name>

> <description>

## Status

🚧 **Early Stage** - Exploring and choosing tech stack

## Setup

```bash
# Install dependencies
npm install

# Format code
npm run format

# Run checks
npm run quality:check
```
````

## Quality Infrastructure

✅ **QA Architect** - Full quality automation

- ESLint + Prettier + Stylelint
- Husky + lint-staged pre-commit hooks
- GitHub Actions (<workflow-tier> workflow)
- Gitleaks secret scanning
- Smart Test Strategy (Pro)
  ✅ **claude-setup** submodule
  ✅ **.qualityrc.json** maturity tracking
  ✅ **Adaptive quality** gates scale with project

## Next Steps

1. Choose your tech stack
2. Add framework-specific tooling
3. Start building!

## License

<license>
```

### Step 11: Run QA Architect

Now integrate qa-architect for full quality automation (ESLint, Husky, lint-staged, GitHub Actions):

```bash
# Run qa-architect with chosen workflow tier
WORKFLOW_TIER="${workflow_tier:-minimal}"  # Default to minimal if not specified

echo "🔧 Installing QA Architect (workflow: $WORKFLOW_TIER)..."

npx create-qa-architect@latest --workflow-$WORKFLOW_TIER

echo "✅ QA Architect installed with $WORKFLOW_TIER workflow"
```

**What this adds:**

- ESLint config (`eslint.config.cjs`)
- Prettier config (`.prettierrc`)
- Husky + lint-staged (`.husky/`, `lint-staged` in package.json)
- GitHub Actions workflow (`.github/workflows/quality.yml`)
- Gitleaks secret scanning (`.gitleaks.toml`) - Pro feature
- Smart Test Strategy - Pro feature
- Adaptive quality checks based on project maturity

**Workflow tiers:**

- **minimal**: Single Node 22, weekly security, path filters (~$0-5/mo)
- **standard**: Matrix on main only, weekly security (~$5-20/mo)
- **comprehensive**: Matrix every commit, inline security (~$100-350/mo)

### Step 12: Install & Commit

```bash
# Install dependencies (qa-architect already ran npm install)
echo "✅ Dependencies installed by QA Architect"

# Initial commit
git add .
git commit -m "chore: initial project setup with quality infrastructure

- Quality maturity: prototype
- QA Architect (workflow: $WORKFLOW_TIER)
- ESLint + Prettier + Stylelint
- Husky + lint-staged pre-commit hooks
- GitHub Actions quality workflow
- claude-setup submodule
- Secret scanning config
- Basic project structure

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

echo "✅ Initial commit created"
```

### Step 13: Create GitHub Repository & Push

```bash
# Skip if user chose "none" for GitHub repo
if [[ "$GITHUB_REPO" != "none" ]]; then
  VISIBILITY="${GITHUB_REPO:-private}"  # Default to private

  echo "🔗 Creating GitHub repository..."

  # Create repo and set as remote
  gh repo create <project-name> --$VISIBILITY --source=. --remote=origin --description "<description>"

  # Rename default branch to main if needed
  git branch -M main

  # Push initial commit
  git push -u origin main

  echo "✅ GitHub repository created: https://github.com/$(gh api user --jq .login)/<project-name>"
else
  echo "ℹ️  Skipping GitHub repo creation (local only)"
  echo "   Create later with: gh repo create <project-name> --private --source=. --remote=origin"
fi
```

### Step 14: Summary

```markdown
✅ Project created: <project-name>

**Location:** <path>
**GitHub:** https://github.com/<user>/<project-name> (or "local only")
**Quality Maturity:** Prototype (scales automatically)
**Workflow Tier:** <workflow-tier> (~$X-Y/mo)

**What's ready:**

- ✅ Git repository initialized + pushed to GitHub
- ✅ QA Architect quality automation
  - ESLint + Prettier + Stylelint configs
  - Husky + lint-staged pre-commit hooks
  - GitHub Actions workflow (<workflow-tier> tier)
  - Gitleaks secret scanning (if Pro)
  - Smart Test Strategy (if Pro)
- ✅ claude-setup submodule
- ✅ Project documentation templates (CLAUDE.md, README.md, BACKLOG.md)

**Next steps:**

1. `cd <path>`
2. Choose your tech stack
3. Start coding with `/bs:dev <feature-name>`
4. Quality checks run automatically on commit & push

**Available commands:**

- `/bs:dev <feature>` - Start feature work
- `/bs:quality` - Quality check before shipping
- `/bs:workflow` - See full workflow
- `npm run lint` - Run ESLint
- `npm run format` - Run Prettier
- `npm run quality:check` - Run all checks

**Quality gates in place:**

- ✅ Pre-commit: lint-staged (formats & lints changed files)
- ✅ Pre-push: Full validation (lint + format + tests)
- ✅ CI/CD: GitHub Actions (<workflow-tier> workflow)
- ✅ Secret scanning: Gitleaks on every commit

**Maturity progression:**

- Current: Prototype (formatting + linting)
- Next: MVP (+ basic tests + 50% coverage)
- Future: Production (+ 80% coverage + security audit + docs)
```

## Command Examples

```bash
# Basic usage (asks for workflow tier)
/bs:new my-saas-app

# Custom location
/bs:new my-api --path ~/Code

# With full context
/bs:new fintech-dashboard
> Location: ~/Projects/fintech-dashboard
> Description: Personal finance dashboard with AI insights
> License: MIT
> Workflow: minimal

# Different workflow tiers
/bs:new startup-mvp
> Workflow: standard    # ~$5-20/mo, matrix on main

/bs:new enterprise-app
> Workflow: comprehensive    # ~$100-350/mo, full matrix
```

## Quality Maturity Progression

Your `.qualityrc.json` starts at **prototype** and auto-upgrades:

| Maturity       | Checks                    | When                 |
| -------------- | ------------------------- | -------------------- |
| **Prototype**  | Prettier only             | 0-10 files           |
| **MVP**        | + ESLint + tests          | 11-50 files          |
| **Beta**       | + 50% coverage            | 51-150 files + tests |
| **Production** | + 80% coverage + security | 150+ files + docs    |

Each stage adds requirements as your project grows.

## What Makes This Different

**Other starter templates:**

- Opinionated framework choices
- Heavy boilerplate
- Manual quality setup required
- Hard to adapt

**This approach:**

- ✅ Framework-agnostic (choose stack later)
- ✅ Quality-first foundation (QA Architect integrated)
- ✅ Scales with maturity (prototype → production)
- ✅ Pre-commit & CI/CD ready (Husky + GitHub Actions)
- ✅ Connected to claude-setup (all `/bs:*` commands)
- ✅ 2-minute setup, production-ready quality gates

**Result:** Quality infrastructure in place from day 1, make tech choices when ready.

## Integration with Existing Workflows

Once created, use normal `/bs:*` commands:

```bash
/bs:new my-project          # Create
cd my-project

/bs:dev auth-system         # Start feature
# ... code ...

/bs:quality --merge         # Ship it
```

## See Also

- `/bs:dev` - Start development work
- `/bs:quality` - Quality loops
- `/bs:workflow` - Full workflow guide
- `/bs:sync --mode check` - Verify claude-setup
