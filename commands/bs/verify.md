---
name: bs:verify
description: Post-deploy verification with smoke tests and auto-rollback
argument-hint: '[--auto-rollback] [--skip-rollback] [--timeout ms] → post-deploy verification'
tags: [deploy, verification, production, smoke-tests]
category: quality
model: sonnet
---

# /bs:verify - Post-Deploy Verification

**Usage**: `/bs:verify [--auto-rollback] [--skip-rollback] [--timeout 300]`

Verifies that a deployment actually works in production. Runs smoke tests and auto-rolls back on failure.

**Time:** 1-3 minutes
**Saves:** Hours of debugging production issues + user frustration

## Why You Need This

**Your tests pass, but production still breaks because:**

1. **Environment differences**
   - Prod uses PostgreSQL, dev uses SQLite
   - Different environment variables
   - Different API keys/credentials
   - Different resource limits

2. **Infrastructure issues**
   - CDN cache issues
   - Database connection pool exhausted
   - Network timeouts different in prod
   - Load balancer misconfigured

3. **Third-party failures**
   - Stripe API down
   - Auth0 misconfigured
   - S3 permissions wrong
   - External API rate limits

4. **Data-dependent bugs**
   - Works with test data, fails with real production data
   - Edge cases only in prod (million-row tables)
   - Production data violates assumptions

## What It Does

```bash
/bs:verify

# 1. Check Deployment Platform Status (30 sec)
#    ✅ Vercel/Netlify deployment succeeded?
#    ✅ Build completed without errors?
#    ✅ DNS pointing to new version?

# 2. Run Smoke Tests (1-2 min)
#    ✅ Homepage loads (GET /)
#    ✅ API responds (GET /api/health)
#    ✅ Auth works (POST /api/login)
#    ✅ Critical flows work (checkout, signup, etc)
#    ✅ Response times < 3 seconds

# 3. Check Health Endpoints (10 sec)
#    ✅ /api/health → 200 OK
#    ✅ /api/ready → 200 OK
#    ✅ Database connected
#    ✅ Cache connected (Redis, etc)
#    ✅ External services reachable

# 4. Monitor Error Tracking (30 sec)
#    ✅ Check Sentry for error spikes
#    ✅ Compare error rate: now vs 10 min ago
#    ✅ No new critical errors introduced

# 5. If ANY check fails → Auto-Rollback
#    ↩️  Revert to previous commit
#    🚀 Deploy previous version
#    📢 Alert: "Deploy failed verification, rolled back"
```

## Implementation

### Step 1: Check Deployment Platform Status

```bash
echo "🔍 Verifying deployment status..."

# Detect platform
if [ -f "vercel.json" ] || [ -d ".vercel" ]; then
  PLATFORM="vercel"
elif [ -f "netlify.toml" ] || [ -d ".netlify" ]; then
  PLATFORM="netlify"
else
  echo "⚠️  Unknown deployment platform. Skipping platform checks."
  PLATFORM="unknown"
fi

# Check Vercel deployment
if [ "$PLATFORM" = "vercel" ]; then
  # Get latest deployment
  LATEST_DEPLOYMENT=$(vercel ls --prod --json | jq -r '.[0]')
  DEPLOYMENT_STATE=$(echo "$LATEST_DEPLOYMENT" | jq -r '.state')
  DEPLOYMENT_URL=$(echo "$LATEST_DEPLOYMENT" | jq -r '.url')

  if [ "$DEPLOYMENT_STATE" != "READY" ]; then
    echo "❌ Vercel deployment not ready. State: $DEPLOYMENT_STATE"
    exit 1
  fi

  echo "✅ Vercel deployment ready: https://$DEPLOYMENT_URL"
fi

# Check Netlify deployment
if [ "$PLATFORM" = "netlify" ]; then
  DEPLOY_STATUS=$(netlify status --json | jq -r '.state')

  if [ "$DEPLOY_STATUS" != "current" ]; then
    echo "❌ Netlify deployment not current. Status: $DEPLOY_STATUS"
    exit 1
  fi

  echo "✅ Netlify deployment current"
fi
```

### Step 2: Run Smoke Tests

**Critical user flows that MUST work:**

```bash
echo "🧪 Running smoke tests..."

# Determine production URL
if [ "$PLATFORM" = "vercel" ]; then
  PROD_URL="https://$DEPLOYMENT_URL"
elif [ "$PLATFORM" = "netlify" ]; then
  PROD_URL=$(netlify status --json | jq -r '.siteUrl')
else
  # Check for PRODUCTION_URL env var
  PROD_URL="${PRODUCTION_URL:-}"
  if [ -z "$PROD_URL" ]; then
    echo "⚠️  No production URL detected. Set PRODUCTION_URL env var."
    echo "Skipping smoke tests."
    return 0
  fi
fi

echo "Testing production: $PROD_URL"

# Test 1: Homepage loads
echo "  → Testing homepage..."
HOMEPAGE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$PROD_URL/" --max-time 10)
if [ "$HOMEPAGE_STATUS" != "200" ]; then
  echo "❌ Homepage failed: HTTP $HOMEPAGE_STATUS"
  SMOKE_TESTS_PASSED=false
else
  echo "  ✅ Homepage: 200 OK"
fi

# Test 2: API health check
echo "  → Testing API health..."
HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$PROD_URL/api/health" --max-time 10)
if [ "$HEALTH_STATUS" != "200" ]; then
  echo "❌ API health check failed: HTTP $HEALTH_STATUS"
  SMOKE_TESTS_PASSED=false
else
  echo "  ✅ API health: 200 OK"
fi

# Test 3: Response time check
echo "  → Testing response time..."
RESPONSE_TIME=$(curl -s -o /dev/null -w "%{time_total}" "$PROD_URL/" --max-time 10)
RESPONSE_TIME_MS=$(echo "$RESPONSE_TIME * 1000" | bc | cut -d. -f1)

if [ "$RESPONSE_TIME_MS" -gt 3000 ]; then
  echo "⚠️  Slow response: ${RESPONSE_TIME_MS}ms (>3s threshold)"
  # Don't fail, just warn
else
  echo "  ✅ Response time: ${RESPONSE_TIME_MS}ms"
fi

# Test 4: Critical API endpoints (if defined)
# Check for .verifyrc.json config file
if [ -f ".verifyrc.json" ]; then
  echo "  → Running custom smoke tests from .verifyrc.json..."

  # Read critical endpoints from config
  # Example .verifyrc.json:
  # {
  #   "endpoints": [
  #     { "path": "/api/login", "method": "GET", "expectedStatus": 200 },
  #     { "path": "/api/products", "method": "GET", "expectedStatus": 200 }
  #   ]
  # }

  ENDPOINTS=$(jq -r '.endpoints[] | @json' .verifyrc.json)

  while IFS= read -r endpoint; do
    PATH=$(echo "$endpoint" | jq -r '.path')
    METHOD=$(echo "$endpoint" | jq -r '.method')
    EXPECTED=$(echo "$endpoint" | jq -r '.expectedStatus')

    echo "    → Testing $METHOD $PATH..."
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X "$METHOD" "$PROD_URL$PATH" --max-time 10)

    if [ "$STATUS" != "$EXPECTED" ]; then
      echo "    ❌ $PATH failed: HTTP $STATUS (expected $EXPECTED)"
      SMOKE_TESTS_PASSED=false
    else
      echo "    ✅ $PATH: $STATUS"
    fi
  done <<< "$ENDPOINTS"
fi

if [ "$SMOKE_TESTS_PASSED" = false ]; then
  echo "❌ Smoke tests failed"
  exit 1
fi

echo "✅ All smoke tests passed"
```

### Step 3: Check Health Endpoints

```bash
echo "🏥 Checking health endpoints..."

# Health endpoint (readiness)
HEALTH_RESPONSE=$(curl -s "$PROD_URL/api/health" --max-time 10)
HEALTH_STATUS=$?

if [ $HEALTH_STATUS -ne 0 ]; then
  echo "❌ Health endpoint unreachable"
  exit 1
fi

# Parse health response (assumes JSON)
# Example response:
# {
#   "status": "healthy",
#   "database": "connected",
#   "cache": "connected",
#   "uptime": 12345
# }

DB_STATUS=$(echo "$HEALTH_RESPONSE" | jq -r '.database // "unknown"')
CACHE_STATUS=$(echo "$HEALTH_RESPONSE" | jq -r '.cache // "unknown"')

echo "  Database: $DB_STATUS"
echo "  Cache: $CACHE_STATUS"

if [ "$DB_STATUS" != "connected" ]; then
  echo "❌ Database not connected"
  exit 1
fi

if [ "$CACHE_STATUS" != "connected" ] && [ "$CACHE_STATUS" != "unknown" ]; then
  echo "⚠️  Cache not connected (non-critical)"
fi

echo "✅ Health checks passed"
```

### Step 4: Monitor Error Tracking

```bash
echo "📊 Checking error rates..."

# Check if Sentry is configured
SENTRY_DSN="${SENTRY_DSN:-}"
SENTRY_AUTH_TOKEN="${SENTRY_AUTH_TOKEN:-}"

if [ -z "$SENTRY_DSN" ] || [ -z "$SENTRY_AUTH_TOKEN" ]; then
  echo "⚠️  Sentry not configured. Skipping error rate check."
  echo "   Set SENTRY_DSN and SENTRY_AUTH_TOKEN to enable."
else
  # Get current error rate (last 5 minutes)
  # This is a simplified example - actual Sentry API call would be more complex

  echo "  → Querying Sentry for recent errors..."

  # Example: Check for errors in last 5 minutes
  CURRENT_ERRORS=$(curl -s \
    -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
    "https://sentry.io/api/0/projects/.../issues/?statsPeriod=5m" \
    | jq '. | length')

  # Get baseline error rate (5-10 minutes ago)
  BASELINE_ERRORS=$(curl -s \
    -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
    "https://sentry.io/api/0/projects/.../issues/?start=10m&end=5m" \
    | jq '. | length')

  # Compare
  ERROR_INCREASE=$((CURRENT_ERRORS - BASELINE_ERRORS))

  if [ "$ERROR_INCREASE" -gt 5 ]; then
    echo "❌ Error spike detected: +${ERROR_INCREASE} errors in last 5 min"
    exit 1
  elif [ "$ERROR_INCREASE" -gt 0 ]; then
    echo "⚠️  Slight error increase: +${ERROR_INCREASE} errors"
  else
    echo "✅ Error rate normal"
  fi
fi
```

### Step 5: Auto-Rollback on Failure (CS-060)

```bash
# This runs if any of the above steps fail (exit 1)

# Parse flags
SKIP_ROLLBACK=false
AUTO_ROLLBACK=false
CREATE_ISSUE=false
ROLLBACK_STRATEGY="vercel-promote"  # Default: use Vercel promote (fastest)

# Load defaults from .verifyrc.json if present
if [ -f ".verifyrc.json" ]; then
  AUTO_ROLLBACK=$(jq -r '.autoRollback // true' .verifyrc.json)
  CREATE_ISSUE=$(jq -r '.createIssueOnFailure // true' .verifyrc.json)
  ROLLBACK_STRATEGY=$(jq -r '.rollbackStrategy // "vercel-promote"' .verifyrc.json)
else
  AUTO_ROLLBACK=true  # Default to auto-rollback if no config
fi

# Override with command-line flags
if [[ "$@" == *"--skip-rollback"* ]]; then
  SKIP_ROLLBACK=true
  AUTO_ROLLBACK=false
fi

if [[ "$@" == *"--auto-rollback"* ]]; then
  AUTO_ROLLBACK=true
  SKIP_ROLLBACK=false
fi

if [[ "$@" == *"--create-issue"* ]]; then
  CREATE_ISSUE=true
fi

# Create GitHub issue with failure details
create_failure_issue() {
  local FAILURE_REASON="$1"
  local FAILED_COMMIT="$2"
  local ROLLBACK_COMMIT="$3"

  if [ "$CREATE_ISSUE" != "true" ]; then
    return 0
  fi

  if ! command -v gh &> /dev/null; then
    echo "⚠️  gh CLI not installed - skipping issue creation"
    return 0
  fi

  echo "📝 Creating GitHub issue..."

  PROJECT_NAME=$(basename "$(pwd)")
  TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M:%S UTC")

  ISSUE_BODY=$(cat <<EOF
## 🚨 Production Verification Failed - Auto-Rollback Triggered

**Project:** ${PROJECT_NAME}
**Time:** ${TIMESTAMP}
**Production URL:** ${PROD_URL:-"(unknown)"}

### Failure Details

${FAILURE_REASON}

### Commits

- **Failed Deployment:** \`${FAILED_COMMIT}\`
- **Rolled Back To:** \`${ROLLBACK_COMMIT}\`

### Investigation Checklist

- [ ] Review deployment logs on Vercel/Netlify
- [ ] Check error tracking (Sentry) for new errors
- [ ] Verify environment variables are correct
- [ ] Check database migrations ran successfully
- [ ] Test critical flows locally

### Rollback Log

Check \`.claude/rollback-log.json\` for rollback history.

### To Redeploy

1. Fix the root cause
2. Run \`/bs:quality --merge\` to redeploy

---
*Auto-generated by /bs:verify (CS-060)*
EOF
)

  gh issue create \
    --title "🚨 Production rollback: Verification failed ($TIMESTAMP)" \
    --body "$ISSUE_BODY" \
    --label "bug,production,urgent" 2>/dev/null || echo "⚠️  Failed to create issue (check gh auth)"
}

# Perform rollback using configured strategy
perform_rollback() {
  local FAILURE_REASON="$1"

  echo ""
  echo "🚨 VERIFICATION FAILED - INITIATING ROLLBACK"
  echo ""
  echo "Strategy: $ROLLBACK_STRATEGY"
  echo ""

  # Get current and previous commit info
  CURRENT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
  PREVIOUS_COMMIT=$(git rev-parse HEAD~1 2>/dev/null || echo "unknown")

  echo "Current (broken): $CURRENT_COMMIT"
  echo "Rolling back to: $PREVIOUS_COMMIT"

  ROLLBACK_SUCCESS=false
  ROLLBACK_START=$(date +%s)

  case "$ROLLBACK_STRATEGY" in
    "vercel-promote")
      # Fastest: Use Vercel promote to switch to previous deployment
      echo ""
      echo "🚀 Using Vercel promote (fastest rollback method)..."

      # Use the vercel-rollback.sh script if available
      if [ -f "./scripts/vercel-rollback.sh" ]; then
        if ./scripts/vercel-rollback.sh; then
          ROLLBACK_SUCCESS=true
        fi
      elif [ -f "${HOME}/Projects/claude-setup/scripts/vercel-rollback.sh" ]; then
        if "${HOME}/Projects/claude-setup/scripts/vercel-rollback.sh"; then
          ROLLBACK_SUCCESS=true
        fi
      else
        # Inline rollback logic
        PREV_DEPLOYMENT=$(vercel ls --prod 2>/dev/null | grep -E "^[a-z]" | head -2 | tail -1 | awk '{print $1}' || echo "")

        if [ -n "$PREV_DEPLOYMENT" ]; then
          if vercel promote "$PREV_DEPLOYMENT" --yes 2>/dev/null; then
            ROLLBACK_SUCCESS=true
          fi
        fi
      fi
      ;;

    "git-revert")
      # Git-based: Revert commit and redeploy
      echo ""
      echo "🔄 Using git revert (revert commit and redeploy)..."

      # Create rollback branch
      ROLLBACK_BRANCH="rollback/$(date +%Y%m%d-%H%M%S)"
      git checkout -b "$ROLLBACK_BRANCH" 2>/dev/null || true

      # Revert the last commit
      if git revert HEAD --no-edit 2>/dev/null; then
        git push origin "$ROLLBACK_BRANCH" 2>/dev/null || true

        # Trigger redeploy
        if [ "$PLATFORM" = "vercel" ]; then
          vercel --prod && ROLLBACK_SUCCESS=true
        elif [ "$PLATFORM" = "netlify" ]; then
          netlify deploy --prod && ROLLBACK_SUCCESS=true
        fi
      fi
      ;;

    "manual")
      # Manual: Just notify, don't rollback
      echo ""
      echo "⚠️  Manual rollback strategy - notification only"
      echo "CRITICAL: Production may be broken. Manual intervention required."
      ROLLBACK_SUCCESS=false
      ;;
  esac

  ROLLBACK_END=$(date +%s)
  ROLLBACK_DURATION=$((ROLLBACK_END - ROLLBACK_START))

  # Log the rollback
  LOG_FILE=".claude/rollback-log.json"
  mkdir -p "$(dirname "$LOG_FILE")"

  LOG_ENTRY=$(cat <<EOF
{
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "project": "$(basename "$(pwd)")",
  "from_deployment": "$CURRENT_COMMIT",
  "to_deployment": "$PREVIOUS_COMMIT",
  "success": $ROLLBACK_SUCCESS,
  "strategy": "$ROLLBACK_STRATEGY",
  "duration_seconds": $ROLLBACK_DURATION,
  "failure_reason": "$FAILURE_REASON",
  "triggered_by": "auto-verify"
}
EOF
)

  if [ -f "$LOG_FILE" ]; then
    TMP_FILE=$(mktemp)
    jq --argjson entry "$LOG_ENTRY" '. + [$entry]' "$LOG_FILE" > "$TMP_FILE" 2>/dev/null || echo "[$LOG_ENTRY]" > "$TMP_FILE"
    mv "$TMP_FILE" "$LOG_FILE"
  else
    echo "[$LOG_ENTRY]" > "$LOG_FILE"
  fi

  # Create GitHub issue
  create_failure_issue "$FAILURE_REASON" "$CURRENT_COMMIT" "$PREVIOUS_COMMIT"

  # Send notifications
  if [ "$ROLLBACK_SUCCESS" = true ]; then
    notify_team "failure" \
      "Production Rollback: Verification Failed" \
      "*Failed Deployment:* $CURRENT_COMMIT\n*Rolled Back To:* $PREVIOUS_COMMIT\n*Reason:* $FAILURE_REASON\n*Duration:* ${ROLLBACK_DURATION}s"

    echo ""
    echo "✅ ROLLBACK COMPLETE (${ROLLBACK_DURATION}s)"
    echo ""
    echo "Production has been restored to previous version."
    echo "Investigate the failure before attempting to redeploy."
    echo ""
    echo "Failed commit: $CURRENT_COMMIT"
    echo "Rollback log: $LOG_FILE"
    echo ""
    echo "⏭️ Next Steps:"
    echo "  1. Check GitHub issue for investigation checklist"
    echo "  2. Run /debug to investigate the failure"
    echo "  3. Fix and run /bs:quality --merge to redeploy"
  else
    echo ""
    echo "❌ ROLLBACK FAILED"
    echo ""
    echo "CRITICAL: Production may be broken. Manual intervention required."
    echo ""
    echo "Try manually:"
    echo "  vercel promote <previous-deployment-id> --yes"
    echo "  OR"
    echo "  ./scripts/vercel-rollback.sh"
  fi
}

# Main rollback handler
rollback_on_failure() {
  local EXIT_CODE=$?
  local FAILURE_REASON="Verification checks failed"

  if [ "$SKIP_ROLLBACK" = true ]; then
    echo "⚠️  Verification failed, but --skip-rollback specified"
    echo "CRITICAL: Production may be broken. Manual intervention required."
    echo ""
    echo "⏭️ Next Steps:"
    echo "  Run /debug to investigate the failure"
    exit 1
  fi

  if [ "$AUTO_ROLLBACK" != "true" ]; then
    echo "⚠️  Verification failed, auto-rollback disabled"
    echo "Enable with --auto-rollback flag or set autoRollback: true in .verifyrc.json"
    echo ""
    echo "⏭️ Next Steps:"
    echo "  Run /debug to investigate the failure"
    exit 1
  fi

  perform_rollback "$FAILURE_REASON"
  exit 1
}

# Set trap to catch failures
trap rollback_on_failure EXIT
```

### Step 6: Success Report

```bash
# If we reach here, all checks passed

echo ""
echo "✅ DEPLOYMENT VERIFIED"
echo ""
echo "All checks passed:"
echo "  ✅ Deployment platform: Ready"
echo "  ✅ Smoke tests: Passed"
echo "  ✅ Health checks: Passed"
echo "  ✅ Error rate: Normal"
echo ""
echo "Production URL: $PROD_URL"
echo "Deploy time: $(date)"
echo ""

# Remove the rollback trap (we succeeded)
trap - EXIT
```

### Step 6.5: Send Team Notifications (CS-076)

**Notify team on verification outcomes:**

```bash
# Send notification to Slack (if configured)
send_team_notification() {
  local STATUS="$1"      # "success" or "failure"
  local MESSAGE="$2"     # Notification message
  local DETAILS="$3"     # Additional details (optional)

  # Check if webhook is configured in .verifyrc.json
  SLACK_WEBHOOK=$(jq -r '.notifications.slack.webhook // empty' .verifyrc.json 2>/dev/null)
  SLACK_CHANNEL=$(jq -r '.notifications.slack.channel // "#deployments"' .verifyrc.json 2>/dev/null)

  if [ -z "$SLACK_WEBHOOK" ]; then
    # Fall back to environment variable
    SLACK_WEBHOOK="${SLACK_WEBHOOK_URL:-}"
  fi

  if [ -z "$SLACK_WEBHOOK" ]; then
    echo "ℹ️  Slack notifications not configured (add to .verifyrc.json)"
    return 0
  fi

  # Determine emoji and color based on status
  if [ "$STATUS" = "success" ]; then
    EMOJI=":white_check_mark:"
    COLOR="good"
  else
    EMOJI=":rotating_light:"
    COLOR="danger"
  fi

  # Build notification payload
  PAYLOAD=$(cat <<EOF
{
  "channel": "$SLACK_CHANNEL",
  "attachments": [
    {
      "color": "$COLOR",
      "blocks": [
        {
          "type": "header",
          "text": {
            "type": "plain_text",
            "text": "$EMOJI $MESSAGE"
          }
        },
        {
          "type": "section",
          "fields": [
            {
              "type": "mrkdwn",
              "text": "*Project:*\n$(basename $(pwd))"
            },
            {
              "type": "mrkdwn",
              "text": "*Environment:*\nProduction"
            },
            {
              "type": "mrkdwn",
              "text": "*Time:*\n$(date -u +"%Y-%m-%d %H:%M:%S UTC")"
            },
            {
              "type": "mrkdwn",
              "text": "*URL:*\n$PROD_URL"
            }
          ]
        }
      ]
    }
  ]
}
EOF
)

  # Add details section if provided
  if [ -n "$DETAILS" ]; then
    PAYLOAD=$(echo "$PAYLOAD" | jq --arg details "$DETAILS" '.attachments[0].blocks += [{"type": "section", "text": {"type": "mrkdwn", "text": $details}}]')
  fi

  # Send notification
  curl -s -X POST "$SLACK_WEBHOOK" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" > /dev/null

  if [ $? -eq 0 ]; then
    echo "📢 Slack notification sent to $SLACK_CHANNEL"
  else
    echo "⚠️  Failed to send Slack notification"
  fi
}

# Check for Discord webhook as alternative
send_discord_notification() {
  local STATUS="$1"
  local MESSAGE="$2"
  local DETAILS="$3"

  DISCORD_WEBHOOK=$(jq -r '.notifications.discord.webhook // empty' .verifyrc.json 2>/dev/null)

  if [ -z "$DISCORD_WEBHOOK" ]; then
    return 0
  fi

  # Determine color based on status
  if [ "$STATUS" = "success" ]; then
    COLOR=5763719  # Green
  else
    COLOR=15548997  # Red
  fi

  PAYLOAD=$(cat <<EOF
{
  "embeds": [
    {
      "title": "$MESSAGE",
      "color": $COLOR,
      "fields": [
        {"name": "Project", "value": "$(basename $(pwd))", "inline": true},
        {"name": "Environment", "value": "Production", "inline": true},
        {"name": "Time", "value": "$(date -u +"%Y-%m-%d %H:%M:%S UTC")", "inline": true},
        {"name": "URL", "value": "$PROD_URL", "inline": false}
      ],
      "footer": {"text": "Via /bs:verify"}
    }
  ]
}
EOF
)

  if [ -n "$DETAILS" ]; then
    PAYLOAD=$(echo "$PAYLOAD" | jq --arg details "$DETAILS" '.embeds[0].description = $details')
  fi

  curl -s -X POST "$DISCORD_WEBHOOK" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" > /dev/null

  if [ $? -eq 0 ]; then
    echo "📢 Discord notification sent"
  fi
}

# Send notifications to all configured channels
notify_team() {
  local STATUS="$1"
  local MESSAGE="$2"
  local DETAILS="$3"

  send_team_notification "$STATUS" "$MESSAGE" "$DETAILS"
  send_discord_notification "$STATUS" "$MESSAGE" "$DETAILS"
}
```

**Update rollback function to send notification:**

```bash
# In rollback_on_failure(), add at the end:
notify_team "failure" \
  "Production Rollback: Verification Failed" \
  "*Failed Deployment:* $CURRENT_COMMIT\n*Rolled Back To:* $PREVIOUS_COMMIT\n*Reason:* Verification failed"
```

**Update success report to send notification:**

```bash
# At end of successful verification:
notify_team "success" \
  "Deployment Verified Successfully" \
  "*Checks Passed:* Platform, Smoke Tests, Health, Error Rate"
```

## Configuration File: .verifyrc.json

**Create this file to customize smoke tests and notifications:**

```json
{
  "endpoints": [
    {
      "path": "/",
      "method": "GET",
      "expectedStatus": 200,
      "description": "Homepage loads"
    },
    {
      "path": "/api/health",
      "method": "GET",
      "expectedStatus": 200,
      "description": "API health check"
    },
    {
      "path": "/api/login",
      "method": "POST",
      "expectedStatus": 401,
      "description": "Auth endpoint responds (expects 401 without creds)"
    },
    {
      "path": "/api/products",
      "method": "GET",
      "expectedStatus": 200,
      "description": "Products API"
    }
  ],
  "thresholds": {
    "maxResponseTime": 3000,
    "maxErrorIncrease": 5
  },
  "sentry": {
    "enabled": true,
    "projectSlug": "your-project"
  },
  "notifications": {
    "slack": {
      "webhook": "https://hooks.slack.com/services/xxx/yyy/zzz",
      "channel": "#deployments",
      "notifyOnSuccess": true,
      "notifyOnFailure": true
    },
    "discord": {
      "webhook": "https://discord.com/api/webhooks/xxx/yyy"
    }
  }
}
```

## Integration with Other Commands

### Used automatically by /bs:quality --merge

```bash
# In /bs:quality Step 6 (after deploy)
if [ "$AUTO_MERGE" = true ]; then
  # Deploy completed
  echo "🔍 Verifying deployment..."
  /bs:verify

  if [ $? -ne 0 ]; then
    echo "❌ Deploy verification failed and was rolled back"
    echo "Check logs and fix issues before redeploying"
    exit 1
  fi
fi
```

### Used automatically by /bs:hotfix

```bash
# In /bs:hotfix Step 8 (after emergency deploy)
if [ "$SKIP_VERIFY" = false ]; then
  /bs:verify
fi
```

### Manual usage

```bash
# After any deploy, verify it worked
vercel --prod
/bs:verify

# Or skip auto-rollback
/bs:verify --skip-rollback
# (You'll manually roll back if needed)
```

## Flags

| Flag              | Description                                                            |
| ----------------- | ---------------------------------------------------------------------- |
| `--auto-rollback` | Enable auto-rollback on failure (default: reads from `.verifyrc.json`) |
| `--skip-rollback` | Don't auto-rollback on failure (for investigation)                     |
| `--timeout N`     | Max wait time for checks in seconds (default: 300)                     |
| `--verbose`       | Show detailed output from all checks                                   |
| `--notify`        | Force send notifications (even without config)                         |
| `--silent`        | Skip team notifications                                                |
| `--create-issue`  | Create GitHub issue on failure (default: reads from `.verifyrc.json`)  |

## Team Notifications (CS-076)

**Automatic notifications on deployment outcomes:**

- **Success:** Team notified of successful verification
- **Failure:** Team notified with rollback details, failed deployment info
- **Channels:** Slack, Discord (configure in `.verifyrc.json`)

**Setup:**

1. Create Slack webhook at https://api.slack.com/messaging/webhooks
2. Add webhook URL to `.verifyrc.json` under `notifications.slack.webhook`
3. Optionally add Discord webhook under `notifications.discord.webhook`

**Notification contents:**

- Project name
- Environment (Production)
- Timestamp
- Production URL
- For failures: rollback details, failed commit, root cause hints

## Examples

### Example 1: Successful Deploy

```bash
/bs:quality --merge
# → Creates PR, merges, deploys

/bs:verify
# 🔍 Verifying deployment status...
# ✅ Vercel deployment ready
# 🧪 Running smoke tests...
#   ✅ Homepage: 200 OK
#   ✅ API health: 200 OK
#   ✅ Response time: 450ms
# 🏥 Checking health endpoints...
#   Database: connected
#   Cache: connected
#   ✅ Health checks passed
# 📊 Checking error rates...
#   ✅ Error rate normal
#
# ✅ DEPLOYMENT VERIFIED
```

### Example 2: Failed Deploy (Auto-Rollback)

```bash
/bs:quality --merge
# → Creates PR, merges, deploys

/bs:verify
# 🔍 Verifying deployment status...
# ✅ Vercel deployment ready
# 🧪 Running smoke tests...
#   ✅ Homepage: 200 OK
#   ❌ API health check failed: HTTP 500
#
# 🚨 VERIFICATION FAILED - INITIATING ROLLBACK
#
# Current (broken): abc1234
# Rolling back to: def5678
# 🚀 Deploying previous version...
#
# ✅ ROLLBACK COMPLETE
#
# Production has been restored to previous version.
# Failed commit: abc1234
```

### Example 3: Skip Auto-Rollback (For Investigation)

```bash
/bs:verify --skip-rollback
# → Runs checks but doesn't rollback on failure
# → Useful for debugging production issues
```

## Health Endpoint Implementation

**Add to your API:**

```typescript
// pages/api/health.ts (Next.js example)
export default async function handler(req, res) {
  try {
    // Check database connection
    const dbStatus = await db.$queryRaw`SELECT 1`

    // Check cache connection (if applicable)
    let cacheStatus = 'unknown'
    if (redis) {
      await redis.ping()
      cacheStatus = 'connected'
    }

    // Check external services (optional)
    // const stripeStatus = await checkStripeAPI();

    return res.status(200).json({
      status: 'healthy',
      database: dbStatus ? 'connected' : 'disconnected',
      cache: cacheStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    })
  } catch (error) {
    return res.status(503).json({
      status: 'unhealthy',
      error: error.message,
    })
  }
}
```

## Common Failure Scenarios

### Scenario 1: Database Migration Failed

```
❌ Health endpoint failed: Database not connected
→ Rollback initiated
→ Previous version restored
→ Action: Fix migration, redeploy
```

### Scenario 2: Environment Variable Missing

```
✅ Deployment ready
❌ API health check failed: HTTP 500
→ Rollback initiated
→ Action: Set missing env var, redeploy
```

### Scenario 3: Third-Party API Down

```
✅ Smoke tests passed
⚠️  Error spike detected: +12 errors (Stripe API)
→ Rollback initiated
→ Action: Add fallback handling, redeploy
```

### Scenario 4: Performance Degradation

```
✅ All checks passed
⚠️  Slow response: 4500ms (>3s threshold)
→ Warning only (no rollback)
→ Action: Investigate performance issue
```

## Best Practices

1. **Always use with auto-merge:**

   ```bash
   /bs:quality --merge  # Includes verification automatically
   ```

2. **Add critical endpoints to .verifyrc.json:**
   - Authentication
   - Checkout flow
   - Data submission
   - Any revenue-impacting endpoints

3. **Set up health endpoints:**
   - `/api/health` - Database, cache, external services
   - `/api/ready` - Is app ready to serve traffic?

4. **Configure error tracking:**
   - Set SENTRY_DSN and SENTRY_AUTH_TOKEN
   - Get alerts on error spikes

5. **Monitor after deploy:**
   - Even if verification passes, watch for 15-30 min
   - Check metrics dashboards
   - Watch user reports

## ⏭️ Next Steps

**If verification fails:**

```bash
# Investigate the failure
/debug
```

**Why:** Failed verification indicates production issues. Use `/debug` to investigate logs, error traces, and system state before attempting fixes.

**If verification passes:** No action needed. Monitor production for 15-30 minutes.

---

## See Also

- `/bs:hotfix` - Emergency production fixes (includes automatic verification)
- `/bs:quality --merge` - Full quality + deploy workflow
- `/bs:rollback` - Manual rollback to specific version (TODO)
