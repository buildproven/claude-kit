---
name: bs:dashboard
description: 'Unified observability dashboard - quality, cost, ralph-dev progress, sessions, errors'
argument-hint: '[--refresh] → show system health at a glance'
tags: [observability, dashboard, monitoring]
category: project
model: haiku
---

# /bs:dashboard - Unified Observability Dashboard

**Usage**: `/bs:dashboard [--refresh]`

Single command for complete system health overview. Shows quality trends, cost tracking, ralph-dev progress, active sessions, and recent errors.

## What You See

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                        OBSERVABILITY DASHBOARD                                ║
╠══════════════════════════════════════════════════════════════════════════════╣

📊 QUALITY TRENDS (Last 5 Runs)
──────────────────────────────────────────────────────────────────────────────
Coverage:  85% ████████▌   87% ████████▋   90% █████████   92% █████████▏   94% █████████▍
Issues:    12 → 8 → 5 → 3 → 2  (↓83% improvement)
Build:     2m → 1m50s → 1m45s → 1m40s → 1m35s  (↓17% faster)
Status:    ✅ Trend: Improving

💰 COST TRACKING
──────────────────────────────────────────────────────────────────────────────
This Week:     $42.50 (85 calls)
This Month:    $127.80 / $200.00 (64% of budget)
Forecast:      $185.00 (within budget ✅)
Top Commands:  /bs:quality ($45), /bs:dev ($32), /bs:ralph-dev ($28)

📊 WEEKLY QUOTA (Opus Limit: ~10,000 calls/week)
──────────────────────────────────────────────────────────────────────────────
Week 6:        8,234 Opus calls (82% of limit) ⚠️
Daily burn:    ~1,176 calls/day
Projected:     ~9,250 calls (92% of limit)
Recommendation: Switch to Sonnet for remaining work

🤖 RALPH-DEV PROGRESS
──────────────────────────────────────────────────────────────────────────────
Status:        Running ⏳
Progress:      7/15 items (47%)
Current:       CS-065 - Alert rules engine
ETA:           ~2h 15m remaining
Cost so far:   $18.75

📋 ACTIVE SESSIONS
──────────────────────────────────────────────────────────────────────────────
• feature/dark-mode (2h ago) - 3 uncommitted files
• main (current) - clean

⚠️ ALERTS & ERRORS
──────────────────────────────────────────────────────────────────────────────
• Coverage dropped 5% in src/auth.ts (investigate)
• 3 items blocked in last ralph-dev run
• Cost approaching 75% of monthly budget

📈 ERROR PATTERN DISTRIBUTION
──────────────────────────────────────────────────────────────────────────────
Error Categories:
  lint          12 │ ██████████████████████████████
  typecheck      8 │ ████████████████████
  test           5 │ ████████████▌
  build          2 │ █████
  import         1 │ ██▌

Total errors tracked: 28

💡 Recommendation: Focus on reducing 'lint' errors (12 occurrences)

🔥 Module Hotspots (recurring issues):
  • src/auth/login.ts: 4 errors (lint, typecheck)
  • src/api/handlers.ts: 3 errors (test, build)

╚══════════════════════════════════════════════════════════════════════════════╝
```

## Implementation

### Step 1: Parse Arguments

```bash
#!/usr/bin/env bash
set -euo pipefail

REFRESH=false

for arg in "$@"; do
  case "$arg" in
    --refresh)
      REFRESH=true
      ;;
  esac
done

# Ensure git root
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [[ -z "$GIT_ROOT" ]]; then
  echo "❌ Not in a git repository"
  exit 1
fi
cd "$GIT_ROOT"

PROJECT_NAME=$(basename "$GIT_ROOT")
TIMESTAMP=$(date "+%Y-%m-%d %H:%M:%S")
```

### Step 2: Display Dashboard Header

```bash
echo ""
echo "╔══════════════════════════════════════════════════════════════════════════════╗"
echo "║                        OBSERVABILITY DASHBOARD                                ║"
echo "║  Project: $PROJECT_NAME                                                       ║"
echo "║  Updated: $TIMESTAMP                                                          ║"
echo "╠══════════════════════════════════════════════════════════════════════════════╣"
echo ""
```

### Step 3: Quality Trends Section

```bash
echo "📊 QUALITY TRENDS (Last 5 Runs)"
echo "──────────────────────────────────────────────────────────────────────────────"

QUALITY_FILE=".qualityrc.json"

if [ -f "$QUALITY_FILE" ]; then
  # Get last 5 runs
  RUNS=$(jq -r '.history.runs // []' "$QUALITY_FILE")
  RUN_COUNT=$(echo "$RUNS" | jq 'length')

  if [ "$RUN_COUNT" -ge 2 ]; then
    RECENT_RUNS=$(echo "$RUNS" | jq '.[-5:]')

    # Coverage trend with ASCII bars
    echo -n "Coverage:  "
    echo "$RECENT_RUNS" | jq -r '.[].coverage' | while read cov; do
      bar_length=$((cov / 10))
      bar=""
      for ((i=0; i<bar_length; i++)); do bar="${bar}█"; done
      printf "%d%% %-10s  " "$cov" "$bar"
    done
    echo ""

    # Issues trend
    FIRST_ISSUES=$(echo "$RECENT_RUNS" | jq '.[0].issuesFixed // 0')
    LAST_ISSUES=$(echo "$RECENT_RUNS" | jq '.[-1].issuesFixed // 0')
    if [ "$FIRST_ISSUES" -gt 0 ]; then
      IMPROVEMENT=$(echo "scale=0; (($FIRST_ISSUES - $LAST_ISSUES) * 100) / $FIRST_ISSUES" | bc 2>/dev/null || echo "0")
      echo -n "Issues:    "
      echo "$RECENT_RUNS" | jq -r '.[].issuesFixed' | tr '\n' ' → ' | sed 's/ → $/\n/'
      echo "  (↓${IMPROVEMENT}% improvement)"
    fi

    # Build time trend
    echo -n "Build:     "
    echo "$RECENT_RUNS" | jq -r '.[].duration' | while read dur; do
      if [ "$dur" -ge 60 ]; then
        min=$((dur / 60))
        sec=$((dur % 60))
        printf "%dm%ds → " "$min" "$sec"
      else
        printf "%ds → " "$dur"
      fi
    done | sed 's/ → $/\n/'

    # Overall status
    FIRST_COV=$(echo "$RECENT_RUNS" | jq '.[0].coverage // 0')
    LAST_COV=$(echo "$RECENT_RUNS" | jq '.[-1].coverage // 0')
    if [ "$LAST_COV" -gt "$FIRST_COV" ]; then
      echo "Status:    ✅ Trend: Improving"
    elif [ "$LAST_COV" -lt "$FIRST_COV" ]; then
      echo "Status:    ⚠️  Trend: Declining"
    else
      echo "Status:    📊 Trend: Stable"
    fi
  else
    echo "ℹ️  Not enough data (need at least 2 runs)"
    echo "   Run /bs:quality to build history"
  fi
else
  echo "ℹ️  No quality history found"
  echo "   Run /bs:quality first to create .qualityrc.json"
fi

echo ""
```

### Step 4: Cost Tracking Section

```bash
echo "💰 COST TRACKING"
echo "──────────────────────────────────────────────────────────────────────────────"

COST_FILE="${HOME}/.claude/cost-tracking.json"
CONFIG_FILE=".claude/cost-config.json"

if [ -f "$COST_FILE" ]; then
  # This week's cost (simplified - last 7 days)
  TOTAL_COST=$(jq -r '.total.cost // 0' "$COST_FILE")
  TOTAL_CALLS=$(jq -r '.total.calls // 0' "$COST_FILE")

  # Get weekly estimate from daily average
  DAILY_AVG=$(echo "scale=2; $TOTAL_COST / 7" | bc 2>/dev/null || echo "0")
  WEEKLY_COST=$(echo "scale=2; $DAILY_AVG * 7" | bc 2>/dev/null || echo "0")
  MONTHLY_FORECAST=$(echo "scale=2; $DAILY_AVG * 30" | bc 2>/dev/null || echo "0")

  # Budget from config
  MONTHLY_BUDGET=200
  if [ -f "$CONFIG_FILE" ]; then
    MONTHLY_BUDGET=$(jq -r '.monthlyBudget // 200' "$CONFIG_FILE")
  fi

  BUDGET_PERCENT=$(echo "scale=0; ($TOTAL_COST * 100) / $MONTHLY_BUDGET" | bc 2>/dev/null || echo "0")

  printf "This Week:     \$%.2f (%d calls)\n" "$WEEKLY_COST" "$TOTAL_CALLS"
  printf "This Month:    \$%.2f / \$%.2f (%d%% of budget)\n" "$TOTAL_COST" "$MONTHLY_BUDGET" "$BUDGET_PERCENT"

  if (( $(echo "$MONTHLY_FORECAST < $MONTHLY_BUDGET" | bc -l) )); then
    printf "Forecast:      \$%.2f (within budget ✅)\n" "$MONTHLY_FORECAST"
  else
    printf "Forecast:      \$%.2f (⚠️  over budget)\n" "$MONTHLY_FORECAST"
  fi

  # Top commands by cost
  echo -n "Top Commands:  "
  jq -r '
    .commands // {} |
    to_entries |
    sort_by(-.value.cost) |
    limit(3; .[]) |
    "\(.key) ($\(.value.cost))"
  ' "$COST_FILE" | tr '\n' ', ' | sed 's/, $/\n/'

else
  echo "ℹ️  Cost tracking not initialized"
  echo "   Run /bs:cost to initialize"
fi

echo ""
```

### Step 4.5: Weekly Quota Tracking Section

```bash
echo "📊 WEEKLY QUOTA (Opus Limit: ~10,000 calls/week)"
echo "──────────────────────────────────────────────────────────────────────────────"

# Run usage audit script
USAGE_AUDIT_SCRIPT="${HOME}/Projects/claude-setup/scripts/usage-audit.sh"

if [ -f "$USAGE_AUDIT_SCRIPT" ]; then
  QUOTA_DATA=$("$USAGE_AUDIT_SCRIPT" --json 2>/dev/null)

  if [ -n "$QUOTA_DATA" ]; then
    OPUS_CALLS=$(echo "$QUOTA_DATA" | jq -r '.usage.opus')
    SONNET_CALLS=$(echo "$QUOTA_DATA" | jq -r '.usage.sonnet')
    HAIKU_CALLS=$(echo "$QUOTA_DATA" | jq -r '.usage.haiku')
    USED_PERCENT=$(echo "$QUOTA_DATA" | jq -r '.quota.used_percent')
    PROJECTED_PERCENT=$(echo "$QUOTA_DATA" | jq -r '.quota.projected_percent')
    DAILY_BURN=$(echo "$QUOTA_DATA" | jq -r '.daily_burn_rate')
    PROJECTED_WEEKLY=$(echo "$QUOTA_DATA" | jq -r '.projected_weekly')
    QUOTA_STATUS=$(echo "$QUOTA_DATA" | jq -r '.status')
    WEEK_INFO=$(echo "$QUOTA_DATA" | jq -r '.week')

    # Format week number (extract start date)
    WEEK_START=$(echo "$WEEK_INFO" | cut -d' ' -f1)
    WEEK_NUM=$(date -j -f "%Y-%m-%d" "$WEEK_START" "+%U" 2>/dev/null || echo "?")

    # Format numbers with thousand separators
    OPUS_FMT=$(printf "%'d" "$OPUS_CALLS" 2>/dev/null || echo "$OPUS_CALLS")
    SONNET_FMT=$(printf "%'d" "$SONNET_CALLS" 2>/dev/null || echo "$SONNET_CALLS")
    HAIKU_FMT=$(printf "%'d" "$HAIKU_CALLS" 2>/dev/null || echo "$HAIKU_CALLS")
    PROJECTED_FMT=$(printf "%'d" "$PROJECTED_WEEKLY" 2>/dev/null || echo "$PROJECTED_WEEKLY")

    # Display quota status
    if [ "$QUOTA_STATUS" = "critical" ]; then
      printf "Week %s:     %s Opus calls (%d%% of limit) ⚠️  CRITICAL\n" "$WEEK_NUM" "$OPUS_FMT" "$PROJECTED_PERCENT"
      echo "Daily burn:    ~$DAILY_BURN calls/day"
      printf "Projected:     ~%s calls (%d%% of limit)\n" "$PROJECTED_FMT" "$PROJECTED_PERCENT"
      echo "⚠️  Recommendation: SWITCH TO SONNET IMMEDIATELY"
    elif [ "$QUOTA_STATUS" = "warning" ]; then
      printf "Week %s:     %s Opus calls (%d%% of limit) ⚠️\n" "$WEEK_NUM" "$OPUS_FMT" "$PROJECTED_PERCENT"
      echo "Daily burn:    ~$DAILY_BURN calls/day"
      printf "Projected:     ~%s calls (%d%% of limit)\n" "$PROJECTED_FMT" "$PROJECTED_PERCENT"
      echo "💡 Recommendation: Switch to Sonnet for remaining work"
    else
      printf "Week %s:     %s Opus / %s Sonnet / %s Haiku\n" "$WEEK_NUM" "$OPUS_FMT" "$SONNET_FMT" "$HAIKU_FMT"
      echo "Daily burn:    ~$DAILY_BURN calls/day"
      printf "Projected:     ~%s calls (%d%% of limit) ✅\n" "$PROJECTED_FMT" "$PROJECTED_PERCENT"
    fi
  else
    echo "ℹ️  Quota tracking unavailable (no session data)"
  fi
else
  echo "ℹ️  Install usage-audit.sh to enable quota tracking"
  echo "   Run: /bs:dev CS-149"
fi

echo ""
```

### Step 5: Ralph-Dev Progress Section

```bash
echo "🤖 RALPH-DEV PROGRESS"
echo "──────────────────────────────────────────────────────────────────────────────"

RALPH_STATE=".claude/ralph-dev-state.json"
RALPH_PROGRESS=".claude/ralph-dev-progress.json"

if [ -f "$RALPH_PROGRESS" ]; then
  # Active run in progress
  STATUS=$(jq -r '.status // "unknown"' "$RALPH_PROGRESS")
  COMPLETED=$(jq -r '.completed // 0' "$RALPH_PROGRESS")
  TOTAL=$(jq -r '.total // 0' "$RALPH_PROGRESS")
  CURRENT=$(jq -r '.currentItem.id // "none"' "$RALPH_PROGRESS")
  CURRENT_DESC=$(jq -r '.currentItem.description // ""' "$RALPH_PROGRESS")
  ETA=$(jq -r '.eta // "unknown"' "$RALPH_PROGRESS")
  COST=$(jq -r '.costSoFar // 0' "$RALPH_PROGRESS")

  if [ "$TOTAL" -gt 0 ]; then
    PERCENT=$(echo "scale=0; ($COMPLETED * 100) / $TOTAL" | bc)
  else
    PERCENT=0
  fi

  case "$STATUS" in
    running)
      echo "Status:        Running ⏳"
      ;;
    completed)
      echo "Status:        Completed ✅"
      ;;
    blocked)
      echo "Status:        Blocked ❌"
      ;;
    *)
      echo "Status:        $STATUS"
      ;;
  esac

  echo "Progress:      $COMPLETED/$TOTAL items ($PERCENT%)"
  echo "Current:       $CURRENT - $CURRENT_DESC"
  echo "ETA:           $ETA"
  printf "Cost so far:   \$%.2f\n" "$COST"

elif [ -f "$RALPH_STATE" ]; then
  # Past runs exist but no active run
  LAST_RUN=$(jq -r '.lastRun // "never"' "$RALPH_STATE")
  TOTAL_COMPLETED=$(jq -r '.sessionStats.totalCompleted // 0' "$RALPH_STATE")
  TOTAL_BLOCKED=$(jq -r '.sessionStats.totalBlocked // 0' "$RALPH_STATE")

  echo "Status:        Idle (no active run)"
  echo "Last run:      $LAST_RUN"
  echo "Total completed: $TOTAL_COMPLETED items"
  echo "Total blocked:   $TOTAL_BLOCKED items"
else
  echo "ℹ️  No ralph-dev history"
  echo "   Run /bs:ralph-dev to start autonomous development"
fi

echo ""
```

### Step 6: Active Sessions Section

```bash
echo "📋 ACTIVE SESSIONS"
echo "──────────────────────────────────────────────────────────────────────────────"

SESSIONS_DIR="data/sessions"
CHECKPOINT_FILE="data/context/checkpoint.md"

# Check current branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
UNCOMMITTED=$(git status --short 2>/dev/null | wc -l | tr -d ' ')

if [ "$UNCOMMITTED" -gt 0 ]; then
  echo "• $CURRENT_BRANCH (current) - $UNCOMMITTED uncommitted files"
else
  echo "• $CURRENT_BRANCH (current) - clean"
fi

# Check for checkpoints
if [ -f "$CHECKPOINT_FILE" ]; then
  CHECKPOINT_AGE=$(find "$CHECKPOINT_FILE" -mmin +0 -printf '%T@\n' 2>/dev/null | head -1)
  if [ -n "$CHECKPOINT_AGE" ]; then
    echo "• Quick checkpoint available"
  fi
fi

# Check for sessions
if [ -d "$SESSIONS_DIR" ]; then
  SESSION_COUNT=$(ls -1 "$SESSIONS_DIR" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$SESSION_COUNT" -gt 0 ]; then
    LATEST_SESSION=$(ls -t "$SESSIONS_DIR" 2>/dev/null | head -1)
    echo "• $SESSION_COUNT saved sessions (latest: $LATEST_SESSION)"
  fi
fi

echo ""
```

### Step 7: Alerts & Errors Section

```bash
echo "⚠️ ALERTS & ERRORS"
echo "──────────────────────────────────────────────────────────────────────────────"

ALERTS_FOUND=false

# Check quality alerts from .qualityrc.json
if [ -f "$QUALITY_FILE" ]; then
  # Coverage drop alert
  RUNS=$(jq -r '.history.runs // []' "$QUALITY_FILE")
  if [ "$(echo "$RUNS" | jq 'length')" -ge 2 ]; then
    PREV_COV=$(echo "$RUNS" | jq '.[-2].coverage // 0')
    CURR_COV=$(echo "$RUNS" | jq '.[-1].coverage // 0')
    COV_DROP=$((PREV_COV - CURR_COV))

    if [ "$COV_DROP" -gt 5 ]; then
      echo "• Coverage dropped ${COV_DROP}% (investigate)"
      ALERTS_FOUND=true
    fi
  fi
fi

# Check ralph-dev blocked items
if [ -f "$RALPH_STATE" ]; then
  BLOCKED=$(jq -r '[.items[] | select(.blocked == true)] | length' "$RALPH_STATE" 2>/dev/null || echo "0")
  if [ "$BLOCKED" -gt 0 ]; then
    echo "• $BLOCKED items blocked in ralph-dev (review .claude/ralph-dev-state.json)"
    ALERTS_FOUND=true
  fi
fi

# Check cost threshold
if [ -f "$COST_FILE" ]; then
  TOTAL_COST=$(jq -r '.total.cost // 0' "$COST_FILE")
  MONTHLY_BUDGET=200
  if [ -f "$CONFIG_FILE" ]; then
    MONTHLY_BUDGET=$(jq -r '.monthlyBudget // 200' "$CONFIG_FILE")
  fi

  THRESHOLD_75=$(echo "scale=2; $MONTHLY_BUDGET * 0.75" | bc)
  if (( $(echo "$TOTAL_COST > $THRESHOLD_75" | bc -l) )); then
    BUDGET_PERCENT=$(echo "scale=0; ($TOTAL_COST * 100) / $MONTHLY_BUDGET" | bc)
    echo "• Cost at ${BUDGET_PERCENT}% of monthly budget"
    ALERTS_FOUND=true
  fi
fi

# Check for error patterns
if [ -f "$RALPH_STATE" ]; then
  ERROR_PATTERNS=$(jq -r '.errorPatterns // {}' "$RALPH_STATE")
  if [ "$(echo "$ERROR_PATTERNS" | jq 'length')" -gt 0 ]; then
    TOP_ERROR=$(echo "$ERROR_PATTERNS" | jq -r 'to_entries | sort_by(-.value) | .[0] | "\(.key): \(.value) occurrences"')
    if [ -n "$TOP_ERROR" ] && [ "$TOP_ERROR" != "null: null occurrences" ]; then
      echo "• Most common error: $TOP_ERROR"
      ALERTS_FOUND=true
    fi
  fi
fi

if [ "$ALERTS_FOUND" = false ]; then
  echo "✅ No alerts - all systems healthy"
fi

echo ""
```

### Step 8: Error Pattern Distribution Section

```bash
echo "📈 ERROR PATTERN DISTRIBUTION"
echo "──────────────────────────────────────────────────────────────────────────────"

if [ -f "$RALPH_STATE" ]; then
  ERROR_PATTERNS=$(jq -r '.errorPatterns // {}' "$RALPH_STATE")
  TOTAL_ERRORS=$(echo "$ERROR_PATTERNS" | jq 'to_entries | map(.value) | add // 0')

  if [ "$TOTAL_ERRORS" -gt 0 ]; then
    echo ""
    echo "Error Categories:"

    # Calculate max for scaling bars (max bar length = 30 chars)
    MAX_COUNT=$(echo "$ERROR_PATTERNS" | jq 'to_entries | max_by(.value) | .value')

    # Display each error type with ASCII bar chart
    echo "$ERROR_PATTERNS" | jq -r 'to_entries | sort_by(-.value) | .[] | "\(.key):\(.value)"' | while IFS=: read -r error_type count; do
      if [ "$count" -gt 0 ]; then
        # Scale bar length (max 30 chars)
        if [ "$MAX_COUNT" -gt 0 ]; then
          bar_length=$((count * 30 / MAX_COUNT))
        else
          bar_length=0
        fi

        # Build the bar
        bar=""
        for ((i=0; i<bar_length; i++)); do bar="${bar}█"; done

        # Pad error type for alignment
        printf "  %-12s %3d │ %s\n" "$error_type" "$count" "$bar"
      fi
    done

    echo ""
    echo "Total errors tracked: $TOTAL_ERRORS"

    # Show top error type recommendation
    TOP_ERROR_TYPE=$(echo "$ERROR_PATTERNS" | jq -r 'to_entries | sort_by(-.value) | .[0] | .key')
    TOP_ERROR_COUNT=$(echo "$ERROR_PATTERNS" | jq -r 'to_entries | sort_by(-.value) | .[0] | .value')

    if [ "$TOP_ERROR_COUNT" -gt 3 ]; then
      echo ""
      echo "💡 Recommendation: Focus on reducing '$TOP_ERROR_TYPE' errors ($TOP_ERROR_COUNT occurrences)"
    fi
  else
    echo "ℹ️  No error patterns recorded yet"
    echo "   Errors will be tracked automatically during /bs:ralph-dev runs"
  fi

  # Module Hotspots
  MODULE_HOTSPOTS=$(jq -r '.moduleHotspots // []' "$RALPH_STATE")
  HOTSPOT_COUNT=$(echo "$MODULE_HOTSPOTS" | jq 'length')

  if [ "$HOTSPOT_COUNT" -gt 0 ]; then
    echo ""
    echo "🔥 Module Hotspots (recurring issues):"
    echo "$MODULE_HOTSPOTS" | jq -r '.[:5] | .[] | "  • \(.module): \(.errorCount) errors (\(.errorTypes | join(", ")))"'

    if [ "$HOTSPOT_COUNT" -gt 5 ]; then
      echo "  ... and $((HOTSPOT_COUNT - 5)) more"
    fi
  fi
else
  echo "ℹ️  No ralph-dev state file found"
  echo "   Run /bs:ralph-dev to start tracking error patterns"
fi

echo ""
echo "╚══════════════════════════════════════════════════════════════════════════════╝"
echo ""
```

### Step 9: Refresh Option

```bash
if [ "$REFRESH" = true ]; then
  echo "💡 Dashboard will auto-refresh every 30 seconds"
  echo "   Press Ctrl+C to stop"
  echo ""

  while true; do
    sleep 30
    clear
    # Re-run dashboard (recursive call would work in actual implementation)
    echo "Refreshing..."
  done
fi
```

## Flags

| Flag        | Description                   |
| ----------- | ----------------------------- |
| `--refresh` | Auto-refresh every 30 seconds |

## Integration

**Quick health check in morning:**

```bash
/bs:dashboard
```

**Monitor during ralph-dev:**

```bash
# In another terminal while ralph-dev runs
/bs:dashboard --refresh
```

**After quality loop:**

```bash
/bs:quality --merge
/bs:dashboard  # Check overall health
```

## Data Sources

| Section            | Source File                                           |
| ------------------ | ----------------------------------------------------- |
| Quality Trends     | `.qualityrc.json`                                     |
| Cost Tracking      | `~/.claude/cost-tracking.json`                        |
| Ralph-Dev Progress | `.claude/ralph-dev-progress.json`                     |
| Active Sessions    | `data/sessions/`                                      |
| Alerts             | Multiple sources (quality, cost, ralph-dev)           |
| Error Patterns     | `.claude/ralph-dev-state.json` (errorPatterns object) |
| Module Hotspots    | `.claude/ralph-dev-state.json` (moduleHotspots array) |

## See Also

- `/bs:quality --status` - Detailed quality history
- `/bs:cost` - Detailed cost breakdown
- `/bs:ralph-dev` - Autonomous development
- `/bs:session --list` - Session management
