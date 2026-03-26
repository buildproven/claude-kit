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

## Implementation

### Step 1: Check Deployment Platform Status

```bash
echo "🔍 Verifying deployment status..."

if [ -f "vercel.json" ] || [ -d ".vercel" ]; then
  PLATFORM="vercel"
elif [ -f "netlify.toml" ] || [ -d ".netlify" ]; then
  PLATFORM="netlify"
else
  echo "⚠️  Unknown deployment platform. Skipping platform checks."
  PLATFORM="unknown"
fi

if [ "$PLATFORM" = "vercel" ]; then
  LATEST_DEPLOYMENT=$(vercel ls --prod --json | jq -r '.[0]')
  DEPLOYMENT_STATE=$(echo "$LATEST_DEPLOYMENT" | jq -r '.state')
  DEPLOYMENT_URL=$(echo "$LATEST_DEPLOYMENT" | jq -r '.url')

  if [ "$DEPLOYMENT_STATE" != "READY" ]; then
    echo "❌ Vercel deployment not ready. State: $DEPLOYMENT_STATE"
    exit 1
  fi
  echo "✅ Vercel deployment ready: https://$DEPLOYMENT_URL"
fi

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

```bash
echo "🧪 Running smoke tests..."

if [ "$PLATFORM" = "vercel" ]; then
  PROD_URL="https://$DEPLOYMENT_URL"
elif [ "$PLATFORM" = "netlify" ]; then
  PROD_URL=$(netlify status --json | jq -r '.siteUrl')
else
  PROD_URL="${PRODUCTION_URL:-}"
  if [ -z "$PROD_URL" ]; then
    echo "⚠️  No production URL detected. Set PRODUCTION_URL env var."
    echo "Skipping smoke tests."
    return 0
  fi
fi

echo "Testing production: $PROD_URL"

echo "  → Testing homepage..."
HOMEPAGE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$PROD_URL/" --max-time 10)
if [ "$HOMEPAGE_STATUS" != "200" ]; then
  echo "❌ Homepage failed: HTTP $HOMEPAGE_STATUS"
  SMOKE_TESTS_PASSED=false
else
  echo "  ✅ Homepage: 200 OK"
fi

echo "  → Testing API health..."
HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$PROD_URL/api/health" --max-time 10)
if [ "$HEALTH_STATUS" != "200" ]; then
  echo "❌ API health check failed: HTTP $HEALTH_STATUS"
  SMOKE_TESTS_PASSED=false
else
  echo "  ✅ API health: 200 OK"
fi

echo "  → Testing response time..."
RESPONSE_TIME=$(curl -s -o /dev/null -w "%{time_total}" "$PROD_URL/" --max-time 10)
RESPONSE_TIME_MS=$(echo "$RESPONSE_TIME * 1000" | bc | cut -d. -f1)

if [ "$RESPONSE_TIME_MS" -gt 3000 ]; then
  echo "⚠️  Slow response: ${RESPONSE_TIME_MS}ms (>3s threshold)"
else
  echo "  ✅ Response time: ${RESPONSE_TIME_MS}ms"
fi

if [ -f ".verifyrc.json" ]; then
  echo "  → Running custom smoke tests from .verifyrc.json..."
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

HEALTH_RESPONSE=$(curl -s "$PROD_URL/api/health" --max-time 10)
HEALTH_STATUS=$?

if [ $HEALTH_STATUS -ne 0 ]; then
  echo "❌ Health endpoint unreachable"
  exit 1
fi

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

SENTRY_DSN="${SENTRY_DSN:-}"
SENTRY_AUTH_TOKEN="${SENTRY_AUTH_TOKEN:-}"

if [ -z "$SENTRY_DSN" ] || [ -z "$SENTRY_AUTH_TOKEN" ]; then
  echo "⚠️  Sentry not configured. Skipping error rate check."
  echo "   Set SENTRY_DSN and SENTRY_AUTH_TOKEN to enable."
else
  echo "  → Querying Sentry for recent errors..."

  CURRENT_ERRORS=$(curl -s \
    -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
    "https://sentry.io/api/0/projects/.../issues/?statsPeriod=5m" \
    | jq '. | length')

  BASELINE_ERRORS=$(curl -s \
    -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
    "https://sentry.io/api/0/projects/.../issues/?start=10m&end=5m" \
    | jq '. | length')

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
      echo ""
      echo "🚀 Using Vercel promote (fastest rollback method)..."

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
      echo ""
      echo "🔄 Using git revert (revert commit and redeploy)..."

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
    notify_team "failure" "Production Rollback: Verification Failed" \
      "*Failed:* $CURRENT_COMMIT\n*Rolled back to:* $PREVIOUS_COMMIT\n*Reason:* $FAILURE_REASON\n*Duration:* ${ROLLBACK_DURATION}s"
    echo "✅ ROLLBACK COMPLETE (${ROLLBACK_DURATION}s) — log: $LOG_FILE"
    echo "Next: check GitHub issue → /debug → fix → /bs:quality --merge"
  else
    echo "❌ ROLLBACK FAILED — CRITICAL: Manual intervention required."
    echo "Try: vercel promote <previous-deployment-id> --yes  OR  ./scripts/vercel-rollback.sh"
  fi
}

# Main rollback handler
rollback_on_failure() {
  local FAILURE_REASON="Verification checks failed"
  if [ "$SKIP_ROLLBACK" = true ]; then
    echo "⚠️  Verification failed (--skip-rollback). CRITICAL: Manual intervention required. Run /debug."
    exit 1
  fi
  if [ "$AUTO_ROLLBACK" != "true" ]; then
    echo "⚠️  Verification failed, auto-rollback disabled. Enable with --auto-rollback or autoRollback: true in .verifyrc.json"
    exit 1
  fi
  perform_rollback "$FAILURE_REASON"
  exit 1
}

trap rollback_on_failure EXIT
```

### Step 6: Success Report

```bash
echo "✅ DEPLOYMENT VERIFIED — Platform: Ready | Smoke tests: Passed | Health: Passed | Errors: Normal"
echo "Production URL: $PROD_URL | Deploy time: $(date)"
trap - EXIT
```

### Step 6.5: Send Team Notifications (CS-076)

```bash
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

  if [ "$STATUS" = "success" ]; then
    EMOJI=":white_check_mark:"
    COLOR="good"
  else
    EMOJI=":rotating_light:"
    COLOR="danger"
  fi

  # Build notification payload (Slack Block Kit format)
  PAYLOAD=$(jq -n --arg ch "$SLACK_CHANNEL" --arg color "$COLOR" --arg msg "$EMOJI $MESSAGE" \
    --arg proj "$(basename $(pwd))" --arg url "$PROD_URL" \
    '{"channel":$ch,"attachments":[{"color":$color,"blocks":[{"type":"header","text":{"type":"plain_text","text":$msg}},{"type":"section","fields":[{"type":"mrkdwn","text":"*Project:*\n\($proj)"},{"type":"mrkdwn","text":"*Environment:*\nProduction"},{"type":"mrkdwn","text":"*URL:*\n\($url)"}]}]}]}')

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

  PAYLOAD=$(jq -n --arg msg "$MESSAGE" --argjson color "$COLOR" \
    --arg proj "$(basename $(pwd))" --arg url "$PROD_URL" \
    '{"embeds":[{"title":$msg,"color":$color,"fields":[{"name":"Project","value":$proj,"inline":true},{"name":"Environment","value":"Production","inline":true},{"name":"URL","value":$url,"inline":false}],"footer":{"text":"Via /bs:verify"}}]}')

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
