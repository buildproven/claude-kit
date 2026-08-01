---
name: hotfix
description: Fast-track production emergency fixes (5-10 min minimal quality)
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
# Tests (affected areas only) — skip cleanly if the diff touches no JS/TS
# files, rather than passing --findRelatedTests with no paths (Jest treats
# that as "no related tests" and exits 0, which is not the same as "tested").
CHANGED_JS_TS=$(git diff --name-only main...HEAD | grep -E '\.(js|ts|jsx|tsx)$' || true)
if [ -n "$CHANGED_JS_TS" ]; then
  npm run test -- --findRelatedTests $CHANGED_JS_TS
else
  echo "ℹ️  No JS/TS files changed — targeted tests not applicable"
fi

npm run lint
npm run type-check || tsc --noEmit
npm run build
```

### Step 5: Create PR

```bash
# Re-derive the same JS/TS-changed check from Step 4 (each fenced block runs
# as its own shell, so Step 4's variables don't carry over) to describe test
# status accurately instead of always claiming "Passing".
TESTS_LINE="Tests: Passing (affected areas)"
TESTS_CHECK_LINE="- ✅ Tests (affected areas)"
if [ -z "$(git diff --name-only main...HEAD | grep -E '\.(js|ts|jsx|tsx)$' || true)" ]; then
  TESTS_LINE="Tests: N/A — no JS/TS files changed"
  TESTS_CHECK_LINE="- ➖ Tests: N/A — no JS/TS files changed"
fi

git add .
git commit -m "hotfix: ${DESCRIPTION}

🚨 EMERGENCY HOTFIX - Minimal quality checks only
- ${TESTS_LINE}
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
${TESTS_CHECK_LINE}
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
PR_URL=$(gh pr view --json url --jq '.url')

# Wait up to 2 minutes for CI. stdin is not a TTY when this runs via the
# Bash tool, so an interactive "proceed anyway? (y/n)" prompt cannot succeed
# here — it reads EOF and either hangs or silently aborts. Default to abort
# on timeout/failure instead, and print the exact command a human can run
# to merge once they've reviewed the CI result themselves.
TIMEOUT=120; ELAPSED=0; INTERVAL=5
while [ $ELAPSED -lt $TIMEOUT ]; do
  PENDING=$(gh pr checks "$PR_NUMBER" --json state --jq '.[] | select(.state != "COMPLETED") | .state' | wc -l)
  if [ "$PENDING" -eq 0 ]; then
    FAILED=$(gh pr checks "$PR_NUMBER" --json conclusion --jq '.[] | select(.conclusion != "SUCCESS" and .conclusion != "NEUTRAL" and .conclusion != "SKIPPED") | .conclusion' | wc -l)
    if [ "$FAILED" -eq 0 ]; then
      echo "✅ CI checks passed"
      gh pr merge "$PR_NUMBER" --squash --auto --delete-branch
      exit 0
    else
      echo "❌ CI checks failed. Not merging automatically."
      echo "   Review: $PR_URL"
      echo "   To merge anyway once reviewed: gh pr merge $PR_NUMBER --squash --auto --delete-branch"
      exit 1
    fi
  fi
  sleep $INTERVAL; ELAPSED=$((ELAPSED + INTERVAL))
done

echo "⚠️  CI timed out after ${TIMEOUT}s. Not merging automatically."
echo "   Review: $PR_URL"
echo "   To merge once CI completes: gh pr merge $PR_NUMBER --squash --auto --delete-branch"
exit 1
```

If Step 6 exited non-zero (CI failed, timed out, or the merge did not happen), **stop here** — do not proceed to Step 7. Report the CI/PR state to the user and wait for them to merge manually or explicitly say to retry.

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

| Flag            | Description                                            |
| --------------- | ------------------------------------------------------ |
| `--skip-verify` | Skip the reminder to manually verify production health |
| `--notify`      | Send team notification via Slack/Discord               |
| `--force`       | Skip all safety checks (DANGEROUS)                     |

## Examples

```bash
/bs:hotfix payment-processor-timeout
/bs:hotfix update-vulnerable-dependency --notify
/bs:hotfix fix-data-save-race-condition
```
