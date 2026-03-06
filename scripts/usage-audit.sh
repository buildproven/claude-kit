#!/usr/bin/env bash
#
# usage-audit.sh - Track weekly API call usage for quota management
#
# Scans all sessions.jsonl files in ~/.claude/projects/ for current week
# Counts API calls by model (Opus/Sonnet/Haiku)
# Calculates daily burn rate and predicts if on track to hit limit
# Outputs JSON for dashboard consumption
#
# Usage:
#   ./scripts/usage-audit.sh               # Current week usage
#   ./scripts/usage-audit.sh --week 5      # Specific week number
#   ./scripts/usage-audit.sh --from-date 2026-02-03  # From specific date
#   ./scripts/usage-audit.sh --json        # JSON output only (for dashboard)

set -euo pipefail

# Configuration
WEEKLY_OPUS_LIMIT=10000  # Observed limit: ~10,561 calls hit in Feb 2026
WARNING_THRESHOLD=70     # Alert at 70% of limit
CRITICAL_THRESHOLD=90    # Critical warning at 90%

# Defaults
OUTPUT_JSON=false
WEEK_NUMBER=""
FROM_DATE=""

# Parse arguments
for arg in "$@"; do
  case "$arg" in
    --json)
      OUTPUT_JSON=true
      ;;
    --week)
      shift
      WEEK_NUMBER="$1"
      shift
      ;;
    --from-date)
      shift
      FROM_DATE="$1"
      shift
      ;;
    --help)
      echo "Usage: $0 [--json] [--week N] [--from-date YYYY-MM-DD]"
      exit 0
      ;;
  esac
done

# Calculate current week (Monday-Sunday, ISO 8601)
if [[ -n "$WEEK_NUMBER" ]]; then
  # Use specified week number
  CURRENT_YEAR=$(date +%Y)
  START_OF_WEEK=$(date -j -f "%Y-W%U-%u" "${CURRENT_YEAR}-W${WEEK_NUMBER}-1" "+%Y-%m-%d" 2>/dev/null || echo "")
  if [[ -z "$START_OF_WEEK" ]]; then
    echo "Error: Invalid week number $WEEK_NUMBER" >&2
    exit 1
  fi
elif [[ -n "$FROM_DATE" ]]; then
  # Use specified start date
  START_OF_WEEK="$FROM_DATE"
else
  # Current week (Monday = start)
  DOW=$(date +%u)  # 1=Monday, 7=Sunday
  DAYS_SINCE_MONDAY=$((DOW - 1))
  START_OF_WEEK=$(date -v-${DAYS_SINCE_MONDAY}d +%Y-%m-%d)
fi

END_OF_WEEK=$(date -j -v+6d -f "%Y-%m-%d" "$START_OF_WEEK" "+%Y-%m-%d")

# Convert to epoch for filtering
START_EPOCH=$(date -j -f "%Y-%m-%d" "$START_OF_WEEK" "+%s")
END_EPOCH=$(date -j -f "%Y-%m-%d %H:%M:%S" "$END_OF_WEEK 23:59:59" "+%s")

# Find all session JSONL files
PROJECT_DIRS=~/.claude/projects/*
TOTAL_OPUS=0
TOTAL_SONNET=0
TOTAL_HAIKU=0
DAILY_CALLS=()

# Initialize daily call array (7 days)
for i in {0..6}; do
  DAILY_CALLS[$i]=0
done

if [[ "$OUTPUT_JSON" != "true" ]]; then
  echo "📊 Weekly Usage Audit"
  echo "Week: $START_OF_WEEK to $END_OF_WEEK"
  echo ""
  echo "Scanning session logs..."
fi

# Process each project directory
for project_dir in $PROJECT_DIRS; do
  if [[ ! -d "$project_dir" ]]; then
    continue
  fi

  # Find all .jsonl session files in this project
  shopt -s nullglob
  for session_file in "$project_dir"/*.jsonl; do
    if [[ ! -f "$session_file" ]]; then
      continue
    fi

    # Process each line (API call) in the session file
    while IFS= read -r line; do
      # Extract timestamp and model
      timestamp=$(echo "$line" | jq -r '.timestamp // empty' 2>/dev/null)
      model=$(echo "$line" | jq -r '.data.message.message.model // empty' 2>/dev/null)

      if [[ -z "$timestamp" ]] || [[ -z "$model" ]]; then
        continue
      fi

      # Convert timestamp to epoch (handle ISO 8601 format)
      call_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${timestamp%.*}" "+%s" 2>/dev/null || echo "0")

      # Skip if outside current week
      if [[ "$call_epoch" -lt "$START_EPOCH" ]] || [[ "$call_epoch" -gt "$END_EPOCH" ]]; then
        continue
      fi

      # Calculate day of week (0 = Monday)
      day_offset=$(( (call_epoch - START_EPOCH) / 86400 ))
      if [[ "$day_offset" -ge 0 ]] && [[ "$day_offset" -lt 7 ]]; then
        DAILY_CALLS[$day_offset]=$((DAILY_CALLS[$day_offset] + 1))
      fi

      # Count by model
      case "$model" in
        *opus*)
          TOTAL_OPUS=$((TOTAL_OPUS + 1))
          ;;
        *sonnet*)
          TOTAL_SONNET=$((TOTAL_SONNET + 1))
          ;;
        *haiku*)
          TOTAL_HAIKU=$((TOTAL_HAIKU + 1))
          ;;
      esac

    done < "$session_file"
  done
  shopt -u nullglob
done

# Calculate metrics
TOTAL_CALLS=$((TOTAL_OPUS + TOTAL_SONNET + TOTAL_HAIKU))
OPUS_PERCENT=$((TOTAL_OPUS * 100 / WEEKLY_OPUS_LIMIT))

# Calculate daily burn rate (average calls per day so far)
DAYS_ELAPSED=0
CALLS_SO_FAR=0
for i in {0..6}; do
  if [[ "${DAILY_CALLS[$i]}" -gt 0 ]]; then
    DAYS_ELAPSED=$((i + 1))
    CALLS_SO_FAR=$((CALLS_SO_FAR + DAILY_CALLS[$i]))
  fi
done

if [[ "$DAYS_ELAPSED" -eq 0 ]]; then
  DAYS_ELAPSED=1  # Avoid division by zero
fi

DAILY_BURN_RATE=$((CALLS_SO_FAR / DAYS_ELAPSED))
PROJECTED_WEEKLY=$((DAILY_BURN_RATE * 7))
PROJECTED_PERCENT=$((PROJECTED_WEEKLY * 100 / WEEKLY_OPUS_LIMIT))

# Determine status
STATUS="ok"
if [[ "$PROJECTED_PERCENT" -ge "$CRITICAL_THRESHOLD" ]]; then
  STATUS="critical"
elif [[ "$PROJECTED_PERCENT" -ge "$WARNING_THRESHOLD" ]]; then
  STATUS="warning"
fi

# Output
if [[ "$OUTPUT_JSON" == "true" ]]; then
  # JSON output for dashboard
  cat <<EOF
{
  "week": "$START_OF_WEEK to $END_OF_WEEK",
  "usage": {
    "opus": $TOTAL_OPUS,
    "sonnet": $TOTAL_SONNET,
    "haiku": $TOTAL_HAIKU,
    "total": $TOTAL_CALLS
  },
  "quota": {
    "limit": $WEEKLY_OPUS_LIMIT,
    "used_percent": $OPUS_PERCENT,
    "projected_percent": $PROJECTED_PERCENT
  },
  "daily_burn_rate": $DAILY_BURN_RATE,
  "projected_weekly": $PROJECTED_WEEKLY,
  "status": "$STATUS",
  "days_elapsed": $DAYS_ELAPSED,
  "daily_calls": [${DAILY_CALLS[0]}, ${DAILY_CALLS[1]}, ${DAILY_CALLS[2]}, ${DAILY_CALLS[3]}, ${DAILY_CALLS[4]}, ${DAILY_CALLS[5]}, ${DAILY_CALLS[6]}]
}
EOF
else
  # Human-readable output
  echo "╔════════════════════════════════════════════════════╗"
  echo "║           WEEKLY USAGE SUMMARY                     ║"
  echo "╠════════════════════════════════════════════════════╣"
  echo ""
  echo "📅 Week: $START_OF_WEEK to $END_OF_WEEK (Day $DAYS_ELAPSED/7)"
  echo ""
  echo "📊 Model Usage:"
  echo "  Opus:   $TOTAL_OPUS calls"
  echo "  Sonnet: $TOTAL_SONNET calls"
  echo "  Haiku:  $TOTAL_HAIKU calls"
  echo "  Total:  $TOTAL_CALLS calls"
  echo ""
  echo "🎯 Quota Status (Opus limit: $WEEKLY_OPUS_LIMIT calls/week):"
  echo "  Current:   $TOTAL_OPUS / $WEEKLY_OPUS_LIMIT ($OPUS_PERCENT%)"
  echo "  Projected: $PROJECTED_WEEKLY / $WEEKLY_OPUS_LIMIT ($PROJECTED_PERCENT%)"
  echo ""
  echo "📈 Daily Burn Rate: ~$DAILY_BURN_RATE calls/day"
  echo ""

  # Daily breakdown
  echo "📆 Daily Breakdown:"
  for i in {0..6}; do
    day_date=$(date -j -v+${i}d -f "%Y-%m-%d" "$START_OF_WEEK" "+%a %m/%d")
    calls="${DAILY_CALLS[$i]}"
    if [[ "$calls" -gt 0 ]]; then
      bar_length=$((calls / 50))  # Scale: 1 block = 50 calls
      bar=""
      for ((j=0; j<bar_length; j++)); do
        bar="${bar}█"
      done
      printf "  %s: %5d %s\n" "$day_date" "$calls" "$bar"
    else
      printf "  %s: %5d\n" "$day_date" "$calls"
    fi
  done
  echo ""

  # Status and recommendations
  if [[ "$STATUS" == "critical" ]]; then
    echo "⚠️  CRITICAL: Projected to hit ${PROJECTED_PERCENT}% of weekly limit"
    echo ""
    echo "💡 Recommendations:"
    echo "  1. Switch to Sonnet for remaining work (see /bs:workflow)"
    echo "  2. Use Haiku for simple tasks (file search, grep, etc.)"
    echo "  3. Break large sessions into smaller chunks"
    echo "  4. Run /bs:cost --quota for detailed breakdown"
  elif [[ "$STATUS" == "warning" ]]; then
    echo "⚠️  WARNING: Projected to reach ${PROJECTED_PERCENT}% of weekly limit"
    echo ""
    echo "💡 Recommendations:"
    echo "  1. Monitor usage closely"
    echo "  2. Consider Sonnet for non-critical tasks"
    echo "  3. Check /bs:cost --quota for optimization tips"
  else
    echo "✅ HEALTHY: Projected usage ${PROJECTED_PERCENT}% of weekly limit"
  fi

  echo ""
  echo "╚════════════════════════════════════════════════════╝"
fi

exit 0
