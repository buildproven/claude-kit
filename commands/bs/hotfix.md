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

Fast-track workflow for production emergencies. Skips planning, runs minimal quality, deploys immediately.

**Time:** 5-10 minutes (vs 30-60 min for /bs:quality)

## When to Use

### ✅ Use /bs:hotfix when:

- Production is down or severely degraded
- Critical bug affecting real users RIGHT NOW
- Security vulnerability needs immediate patch
- Revenue-impacting issue (payments broken, checkout failing)
- Data loss risk or corruption in progress
- Can't wait 30-60 min for full quality loop

### ❌ DON'T use /bs:hotfix for:

- New features → Use `/bs:dev`
- Minor bugs → Use `/bs:dev`
- Refactoring → Use `/bs:dev`
- Performance improvements → Use `/bs:dev`
- "I just want it faster" → Trust the process, use `/bs:dev`

**Rule of thumb:** If you're not waking people up at 3 AM, it's not a hotfix.

## What It Does

1. **Create hotfix branch** - `hotfix/<description>` from main (not feature/)
2. **Skip planning** - You know what's broken, no time for exploration
3. **Implement fix** - Fast, focused coding
4. **Minimal quality check** (5-10 min)
   - ✅ Tests (affected areas only)
   - ✅ Lint
   - ✅ TypeScript
   - ✅ Build
   - ❌ Skip: Security audit (slow)
   - ❌ Skip: Accessibility audit (slow)
   - ❌ Skip: Performance testing (slow)
   - ❌ Skip: Architecture review (slow)
5. **Create PR** - For audit trail
6. **Auto-merge immediately** - No review delay
7. **Deploy to production** - ASAP
8. **Verify deployment** - Run smoke tests (unless `--skip-verify`)
9. **Alert team** - Notify via Slack/Discord (if `--notify`)

## Implementation

### Step 0: Ensure Working Directory is Git Root

```bash
# Find git root and cd to it
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)

if [[ -z "$GIT_ROOT" ]]; then
  echo "❌ Not in a git repository"
  exit 1
fi

cd "$GIT_ROOT"
```

### Step 1: Create Hotfix Branch

```bash
DESCRIPTION="$1"

# Ensure we're starting from latest main
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != "main" && "$CURRENT_BRANCH" != "master" ]]; then
  echo "⚠️  Not on main branch. Switching to main..."
  git checkout main
  git pull
fi

# Check for uncommitted changes
if [[ -n $(git status --porcelain) ]]; then
  echo "❌ Uncommitted changes detected. Stash or commit first."
  exit 1
fi

# Create hotfix branch
BRANCH_NAME="hotfix/${DESCRIPTION}"
git checkout -b "$BRANCH_NAME"

echo "🚨 HOTFIX MODE: Fast-track production fix"
echo "✅ Created branch: $BRANCH_NAME"
```

### Step 2: Gather Emergency Context

**Ask user for MINIMAL context (no long planning):**

```markdown
🚨 **EMERGENCY HOTFIX MODE**

What's broken in production?

Please provide (be brief):

- What's failing?
- Error messages (if any)
- Which file(s) likely need fixing?

This is a fast-track workflow. No exploration phase.
```

### Step 3: Implement Fix

**Direct implementation with TodoWrite:**

```bash
# Use TodoWrite for tracking (but keep it minimal)
# Example:
# - Fix the critical bug
# - Verify fix locally
# - Deploy to production

echo "Implementing emergency fix..."
echo "Use TodoWrite to track progress, but keep it focused."
```

### Step 4: Minimal Quality Check (5-10 min)

**Run ONLY critical checks:**

```bash
echo "🔍 Running minimal quality checks (5-10 min)..."

# 1. Tests (affected areas only)
# If possible, run only tests related to the fix
npm run test -- --findRelatedTests $(git diff --name-only main...HEAD | grep -E '\.(js|ts|jsx|tsx)$' | tr '\n' ' ')

# 2. Lint
npm run lint

# 3. TypeScript
npm run type-check || tsc --noEmit

# 4. Build
npm run build

echo "✅ Minimal quality checks passed"
```

**What we skip (to save time):**

- Security audit (20-30 min)
- Accessibility testing (15-20 min)
- Performance testing (15-20 min)
- Architecture review (10-15 min)
- Full test suite (if large)

**Trade-off:** Accept technical debt for speed. Clean up later with `/bs:quality --level 98 --scope all`.

### Step 5: Create PR (Audit Trail)

```bash
# Commit all changes
git add .
git commit -m "hotfix: ${DESCRIPTION}

🚨 EMERGENCY HOTFIX - Minimal quality checks only
- Tests: Passing (affected areas)
- Lint: Clean
- Build: Successful

⚠️  Skipped: Security, A11y, Performance audits
TODO: Run full quality check post-incident

🤖 Generated with Claude Code /bs:hotfix"

# Push and create PR
git push -u origin "$BRANCH_NAME"

# Create PR with emergency label
gh pr create \
  --title "🚨 HOTFIX: ${DESCRIPTION}" \
  --body "**EMERGENCY HOTFIX**

**What's broken:** ${DESCRIPTION}

**Fix:** [Brief description of the fix]

**Quality checks:**
- ✅ Tests (affected areas)
- ✅ Lint
- ✅ TypeScript
- ✅ Build
- ⚠️  Skipped: Security, A11y, Performance (emergency fast-track)

**Post-deploy TODO:**
- [ ] Run \`/bs:verify\` to ensure production is healthy
- [ ] Run \`/bs:quality --level 98 --scope all\` within 24 hours
- [ ] Document incident in postmortem

🚨 Auto-merging immediately (production emergency)" \
  --label "hotfix" \
  --label "emergency"

echo "✅ PR created"
```

### Step 6: Auto-Merge Immediately

```bash
# Get PR number
PR_NUMBER=$(gh pr view --json number --jq '.number')

# Wait briefly for CI checks (but don't wait long - this is an emergency)
echo "⏳ Waiting for CI checks (max 2 minutes)..."

TIMEOUT=120
ELAPSED=0
INTERVAL=5

while [ $ELAPSED -lt $TIMEOUT ]; do
  # Check if CI checks are complete
  PENDING_CHECKS=$(gh pr checks "$PR_NUMBER" --json state --jq '.[] | select(.state != "COMPLETED") | .state' | wc -l)

  if [ "$PENDING_CHECKS" -eq 0 ]; then
    # All checks completed - check if they passed
    FAILED_CHECKS=$(gh pr checks "$PR_NUMBER" --json conclusion --jq '.[] | select(.conclusion != "SUCCESS" and .conclusion != "NEUTRAL" and .conclusion != "SKIPPED") | .conclusion' | wc -l)

    if [ "$FAILED_CHECKS" -eq 0 ]; then
      echo "✅ CI checks passed"
      break
    else
      echo "⚠️  CI checks failed, but this is an emergency hotfix"
      echo ""
      echo "Failed checks:"
      gh pr checks "$PR_NUMBER" --json name,conclusion --jq '.[] | select(.conclusion != "SUCCESS" and .conclusion != "NEUTRAL" and .conclusion != "SKIPPED") | "  - \(.name): \(.conclusion)"'
      echo ""
      echo "Proceed with merge anyway? (y/n)"
      read -r PROCEED

      if [ "$PROCEED" != "y" ]; then
        echo "❌ Merge aborted. Fix CI failures and deploy manually."
        exit 1
      fi

      echo "⚠️  Proceeding with merge despite CI failures (emergency override)"
      break
    fi
  fi

  # Still waiting
  echo "  Waiting for checks... ($ELAPSED/$TIMEOUT seconds)"
  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
done

if [ $ELAPSED -ge $TIMEOUT ]; then
  echo "⚠️  CI checks timed out after $TIMEOUT seconds"
  echo "Checks are still running. Proceed with merge anyway? (y/n)"
  read -r PROCEED

  if [ "$PROCEED" != "y" ]; then
    echo "❌ Merge aborted. Monitor CI and merge manually."
    exit 1
  fi

  echo "⚠️  Proceeding with merge (emergency override)"
fi

# Merge immediately
gh pr merge "$PR_NUMBER" --squash --auto --delete-branch

if [ $? -ne 0 ]; then
  echo "❌ Failed to merge PR"
  echo "Merge manually: gh pr merge $PR_NUMBER --squash"
  exit 1
fi

echo "✅ Hotfix merged to main"
```

### Step 7: Deploy to Production

```bash
# Switch to main and pull merged changes
git checkout main
git pull

# Trigger deploy (using existing /bs:git-sync logic)
echo "🚀 Deploying hotfix to production..."

# Determine deployment platform
if [ -f "vercel.json" ] || [ -f ".vercel" ]; then
  vercel --prod
elif [ -f "netlify.toml" ]; then
  netlify deploy --prod
else
  echo "⚠️  No known deployment platform detected. Deploy manually."
fi

echo "✅ Hotfix deployed"
```

### Step 8: Verify Deployment (Unless Skipped)

```bash
SKIP_VERIFY=false
if [[ "$@" == *"--skip-verify"* ]]; then
  SKIP_VERIFY=true
fi

if [ "$SKIP_VERIFY" = false ]; then
  echo "🔍 Verifying deployment..."
  /bs:verify
else
  echo "⚠️  Skipped verification (--skip-verify flag)"
  echo "IMPORTANT: Manually verify production is healthy!"
fi
```

### Step 9: Alert Team (If Requested)

```bash
NOTIFY=false
if [[ "$@" == *"--notify"* ]]; then
  NOTIFY=true
fi

if [ "$NOTIFY" = true ]; then
  # Send notification (implementation depends on setup)
  echo "📢 Sending team notification..."

  # Example: Slack webhook (if configured)
  # SLACK_WEBHOOK=$(grep SLACK_WEBHOOK .env | cut -d '=' -f2)
  # if [ -n "$SLACK_WEBHOOK" ]; then
  #   curl -X POST "$SLACK_WEBHOOK" \
  #     -H 'Content-Type: application/json' \
  #     -d "{\"text\":\"🚨 HOTFIX DEPLOYED: ${DESCRIPTION}\n\nStatus: Production fix deployed\nBranch: ${BRANCH_NAME}\nDeployed by: Claude Code /bs:hotfix\"}"
  # fi

  echo "✅ Team notified (configure Slack/Discord webhook in .env)"
else
  echo "💡 Tip: Use --notify flag to alert team automatically"
fi
```

### Step 10: Post-Hotfix Report

````markdown
🚨 HOTFIX DEPLOYED

**Fix:** ${DESCRIPTION}
**Branch:** ${BRANCH_NAME}
**Time to deploy:** [X minutes]
**PR:** [link]

**What was fixed:**
[Brief summary]

**Quality checks passed:**

- ✅ Tests (affected areas)
- ✅ Lint
- ✅ TypeScript
- ✅ Build

**Deployment verified:**

- ✅ Production is responding
- ✅ Smoke tests passed
- ✅ Error rate normal

**IMPORTANT - Follow-up required:**

1. **Within 1 hour:** Monitor production for issues
   - Check error tracking (Sentry)
   - Watch metrics dashboards
   - Verify user reports stopped

2. **Within 24 hours:** Run full quality check
   ```bash
   /bs:quality --level 98 --scope all
   ```
````

This catches any technical debt or issues missed in emergency mode.

3. **Within 1 week:** Incident postmortem
   - What caused the issue?
   - How did we detect it?
   - How can we prevent it?
   - Update monitoring/alerts

**Cleanup:**
Branch will remain for audit trail. Delete after postmortem complete.

````

## Comparison: /bs:dev vs /bs:hotfix

| | /bs:dev | /bs:hotfix |
|---|---------|-----------|
| **Use case** | Features, improvements | Production emergencies |
| **Branch prefix** | feature/, fix/, refactor/ | hotfix/ |
| **Planning** | Complexity assessment + exploration | Skip (you know the fix) |
| **Quality level** | 95% full loop (30-60 min) | Minimal (5-10 min) |
| **Agents used** | Multiple (code-reviewer, silent-failure-hunter, type-design) | None (manual implementation) |
| **PR review** | Optional (or --merge for auto) | Auto-merge immediately |
| **Deploy** | After quality loop | Immediately after minimal checks |
| **Verification** | Optional | Automatic (unless --skip-verify) |
| **Follow-up** | None required | Full quality check within 24h |

## Flags

| Flag | Description |
|------|-------------|
| `--skip-verify` | Skip post-deploy verification (not recommended) |
| `--notify` | Send team notification via Slack/Discord |
| `--force` | Skip all safety checks (DANGEROUS) |

## Examples

### Example 1: Payment Processor Down

```bash
# 3:00 AM - PagerDuty alert
/bs:hotfix payment-processor-timeout

# What's broken? "Stripe API calls timing out, checkout failing"
# Which files? "src/lib/stripe.ts - increase timeout from 5s to 30s"

# ... implement fix (2 min) ...
# ... minimal quality checks (7 min) ...
# 3:09 AM - Deployed ✅
# 3:10 AM - Verified ✅

# Total downtime: 9 minutes
````

### Example 2: Security Vulnerability

```bash
# Critical CVE in dependency
/bs:hotfix update-vulnerable-dependency --notify

# Update package.json
# Test still works
# Deploy immediately
# Team notified
```

### Example 3: Data Corruption Bug

```bash
# Users reporting lost data
/bs:hotfix fix-data-save-race-condition

# Fix race condition in save logic
# Verify with integration test
# Deploy immediately
# Monitor for 1 hour
```

## Post-Hotfix Workflow

```bash
# Immediately after hotfix
/bs:hotfix critical-bug
# ✅ Deployed in 8 minutes

# Monitor for 1 hour
# Watch Sentry, metrics dashboards

# Within 24 hours - Clean up technical debt
/bs:quality --level 98 --scope all
# → Runs full quality (security, a11y, performance)
# → Catches anything missed in emergency
# → Updates any related code

# Within 1 week - Postmortem
# Document incident
# Update monitoring
# Improve alerts
```

## Safety Notes

1. **Hotfixes create technical debt** - Minimal quality means some issues slip through
2. **Always run full quality within 24h** - Use `/bs:quality --level 98 --scope all`
3. **Monitor closely after deploy** - Watch for 1 hour minimum
4. **Document the incident** - Write postmortem within 1 week
5. **Don't abuse this command** - Only for true emergencies

## Integration with /bs:verify

**Automatic verification (default):**

```bash
/bs:hotfix critical-bug
# → Deploys
# → Runs /bs:verify automatically
# → Rolls back if verification fails
```

**Skip verification (use with caution):**

```bash
/bs:hotfix critical-bug --skip-verify
# → Deploys
# → Skips verification
# → You MUST manually verify production
```

## ⏭️ Next Steps

**After hotfix deploy:**

```bash
# CRITICAL: Run within 24 hours to clean up technical debt
/bs:quality --level 98 --scope all
```

**Why:** Hotfixes skip comprehensive quality checks. Run full quality within 24h to catch security, a11y, and performance issues missed during emergency.

---

## See Also

- `/bs:verify` - Post-deploy smoke testing and auto-rollback
- `/bs:quality --level 98` - Full quality check (run within 24h of hotfix)
- `/bs:dev` - Normal feature development workflow
- `/bs:git-sync` - Git + deploy + release workflow
