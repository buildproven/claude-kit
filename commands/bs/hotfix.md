---
name: bs:hotfix
description: Fast-track production emergency fixes (5-10 min minimal quality)
argument-hint: '<description> [--skip-verify] [--notify] → emergency fix'
tags: [workflow, hotfix, production, emergency]
category: quality
model: sonnet
---

# /bs:hotfix - Production Emergency Fast Path

**Usage**: `/bs:hotfix <description> [--skip-verify] [--notify]`

Fast-track for production emergencies: production down, critical bug, security vulnerability, revenue-impacting issue, data loss risk. For anything else, use `/bs:dev`.

**Time:** 5-10 minutes

## What It Does

1. Create `hotfix/<description>` branch from main
2. Skip planning — implement fix directly
3. Minimal quality: tests (affected areas), lint, TypeScript, build
4. Create PR → auto-merge immediately
5. Deploy to production
6. Verify deployment (unless `--skip-verify`)
7. Alert team (if `--notify`)

## Implementation

### Step 0: Ensure Git Root

```bash
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "Not in a git repository"; exit 1; }
cd "$GIT_ROOT"
```

### Step 1: Create Hotfix Branch

```bash
DESCRIPTION="$1"
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != "main" && "$CURRENT_BRANCH" != "master" ]]; then
  git checkout main && git pull
fi

[[ -n $(git status --porcelain) ]] && echo "❌ Uncommitted changes detected. Stash or commit first." && exit 1

BRANCH_NAME="hotfix/${DESCRIPTION}"
git checkout -b "$BRANCH_NAME"
echo "🚨 HOTFIX MODE | Branch: $BRANCH_NAME"
```

### Step 2: Gather Emergency Context

Ask user (be brief):

- What's failing?
- Error messages (if any)
- Which file(s) likely need fixing?

### Step 3: Implement Fix

Use TodoWrite minimally (Fix bug → Verify → Deploy). Implement directly.

### Step 4: Minimal Quality Check (5-10 min)

```bash
# Tests (affected areas only)
npm run test -- --findRelatedTests $(git diff --name-only main...HEAD | grep -E '\.(js|ts|jsx|tsx)$' | tr '\n' ' ')

npm run lint
npm run type-check || tsc --noEmit
npm run build
```

### Step 5: Create PR

```bash
git add .
git commit -m "hotfix: ${DESCRIPTION}

🚨 EMERGENCY HOTFIX - Minimal quality checks only
- Tests: Passing (affected areas)
- Lint: Clean
- Build: Successful
⚠️  Skipped: Security, A11y, Performance audits
TODO: Run full quality check post-incident"

git push -u origin "$BRANCH_NAME"

gh pr create \
  --title "🚨 HOTFIX: ${DESCRIPTION}" \
  --body "**EMERGENCY HOTFIX**

**What's broken:** ${DESCRIPTION}

**Quality checks:**
- ✅ Tests (affected areas)
- ✅ Lint / TypeScript / Build
- ⚠️  Skipped: Security, A11y, Performance

**Post-deploy TODO:**
- [ ] Manually verify production health
- [ ] Run \`/bs:quality --level 98 --scope all\` within 24 hours
- [ ] Document incident in postmortem" \
  --label "hotfix" \
  --label "emergency"
```

### Step 6: Auto-Merge

```bash
PR_NUMBER=$(gh pr view --json number --jq '.number')

# Wait up to 2 minutes for CI
TIMEOUT=120; ELAPSED=0; INTERVAL=5
while [ $ELAPSED -lt $TIMEOUT ]; do
  PENDING=$(gh pr checks "$PR_NUMBER" --json state --jq '.[] | select(.state != "COMPLETED") | .state' | wc -l)
  if [ "$PENDING" -eq 0 ]; then
    FAILED=$(gh pr checks "$PR_NUMBER" --json conclusion --jq '.[] | select(.conclusion != "SUCCESS" and .conclusion != "NEUTRAL" and .conclusion != "SKIPPED") | .conclusion' | wc -l)
    if [ "$FAILED" -eq 0 ]; then
      echo "✅ CI checks passed"; break
    else
      echo "⚠️  CI checks failed. Proceed anyway? (y/n)"
      read -r PROCEED
      [ "$PROCEED" != "y" ] && echo "❌ Merge aborted." && exit 1
      break
    fi
  fi
  sleep $INTERVAL; ELAPSED=$((ELAPSED + INTERVAL))
done

[ $ELAPSED -ge $TIMEOUT ] && echo "⚠️  CI timed out. Proceed anyway? (y/n)" && read -r PROCEED && [ "$PROCEED" != "y" ] && exit 1

gh pr merge "$PR_NUMBER" --squash --auto --delete-branch
```

### Step 7: Deploy to Production

```bash
git checkout main && git pull

if [ -f "vercel.json" ] || [ -f ".vercel" ]; then
  vercel --prod
elif [ -f "netlify.toml" ]; then
  netlify deploy --prod
else
  echo "⚠️  No known deployment platform. Deploy manually."
fi
```

### Step 8: Verify Deployment

```bash
echo "Manually verify production is healthy using your deployment tooling and app health checks."
```

### Step 9: Alert Team

```bash
if [[ "$@" == *"--notify"* ]]; then
  echo "📢 Sending team notification..."
  # Configure Slack/Discord webhook in .env: SLACK_WEBHOOK=...
fi
```

### Step 10: Post-Hotfix Report

```
HOTFIX DEPLOYED
Fix: ${DESCRIPTION} | Branch: ${BRANCH_NAME} | PR: [link]
Follow-up: /bs:quality --level 98 --scope all within 24h | Postmortem within 1 week
```

## Flags

| Flag            | Description                                     |
| --------------- | ----------------------------------------------- |
| `--skip-verify` | Skip the reminder to manually verify production health |
| `--notify`      | Send team notification via Slack/Discord        |
| `--force`       | Skip all safety checks (DANGEROUS)              |

## Examples

```bash
/bs:hotfix payment-processor-timeout
/bs:hotfix update-vulnerable-dependency --notify
/bs:hotfix fix-data-save-race-condition
```
