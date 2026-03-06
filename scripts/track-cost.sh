#!/bin/bash
# Cost tracking utility - tracks API usage per command/agent
# Called by commands to log API costs

set -eo pipefail

# Cost tracking configuration
COST_FILE="${HOME}/.claude/cost-tracking.json"

# Claude API pricing (as of Feb 2026)
# https://www.anthropic.com/api#pricing
# Using functions instead of associative arrays for bash 3.2 compatibility

get_input_cost() {
  case "$1" in
    opus-4.6|opus-4.5) echo "5.00" ;;
    opus-4.1|opus-4) echo "15.00" ;;
    sonnet-4.5|sonnet-4|sonnet-3.5) echo "3.00" ;;
    haiku-4.5) echo "1.00" ;;
    haiku-3) echo "0.25" ;;
    *) echo "3.00" ;;  # Default to sonnet pricing
  esac
}

get_output_cost() {
  case "$1" in
    opus-4.6|opus-4.5) echo "25.00" ;;
    opus-4.1|opus-4) echo "75.00" ;;
    sonnet-4.5|sonnet-4|sonnet-3.5) echo "15.00" ;;
    haiku-4.5) echo "5.00" ;;
    haiku-3) echo "1.25" ;;
    *) echo "15.00" ;;  # Default to sonnet pricing
  esac
}

# Initialize cost tracking file if it doesn't exist
init_cost_tracking() {
  if [ ! -f "$COST_FILE" ]; then
    mkdir -p "$(dirname "$COST_FILE")"
    cat > "$COST_FILE" <<'EOF'
{
  "version": "1.1",
  "initialized": "TIMESTAMP",
  "branches": {},
  "commands": {},
  "agents": {},
  "weeklyAgentCosts": {},
  "total": {
    "calls": 0,
    "inputTokens": 0,
    "outputTokens": 0,
    "cost": 0
  }
}
EOF
    # Replace TIMESTAMP with actual timestamp
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s/TIMESTAMP/$timestamp/" "$COST_FILE"
    else
      sed -i "s/TIMESTAMP/$timestamp/" "$COST_FILE"
    fi
  fi
}

# Calculate cost for a given model and token counts
calculate_cost() {
  local model="$1"
  local input_tokens="$2"
  local output_tokens="$3"

  # Normalize model name (extract base model)
  local base_model=""
  if [[ "$model" =~ opus ]]; then
    if [[ "$model" =~ 4\.6 ]]; then
      base_model="opus-4.6"
    elif [[ "$model" =~ 4\.5 ]]; then
      base_model="opus-4.5"
    elif [[ "$model" =~ 4\.1 ]]; then
      base_model="opus-4.1"
    else
      base_model="opus-4"
    fi
  elif [[ "$model" =~ sonnet ]]; then
    if [[ "$model" =~ 4\.5 ]]; then
      base_model="sonnet-4.5"
    elif [[ "$model" =~ 4 ]]; then
      base_model="sonnet-4"
    else
      base_model="sonnet-3.5"
    fi
  elif [[ "$model" =~ haiku ]]; then
    if [[ "$model" =~ 4\.5 ]]; then
      base_model="haiku-4.5"
    else
      base_model="haiku-3"
    fi
  else
    # Default to sonnet-4.5 if unknown
    base_model="sonnet-4.5"
  fi

  local input_cost=$(get_input_cost "$base_model")
  local output_cost=$(get_output_cost "$base_model")

  # Calculate cost (tokens / 1M * cost_per_million)
  # Using bc for floating point math
  local cost=$(echo "scale=4; ($input_tokens / 1000000 * $input_cost) + ($output_tokens / 1000000 * $output_cost)" | bc)

  echo "$cost"
}

# Track a single API call
track_call() {
  local command="${1:-unknown}"
  local model="${2:-sonnet-4.5}"
  local input_tokens="${3:-0}"
  local output_tokens="${4:-0}"
  local agent="${5:-}"  # Optional agent name (CS-081)

  init_cost_tracking

  # Get current branch
  local branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

  # Calculate cost
  local cost=$(calculate_cost "$model" "$input_tokens" "$output_tokens")

  # Get timestamp and week number for weekly tracking
  local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local week=$(date -u +"%Y-W%V")

  # Update cost tracking file using jq
  # Note: jq is required - install with: brew install jq
  if ! command -v jq &> /dev/null; then
    echo "Warning: jq not installed. Install with 'brew install jq' for cost tracking." >&2
    return 0
  fi

  local tmp_file="${COST_FILE}.tmp"
  jq --arg cmd "$command" \
     --arg model "$model" \
     --arg branch "$branch" \
     --arg ts "$timestamp" \
     --arg agent "$agent" \
     --arg week "$week" \
     --argjson input "$input_tokens" \
     --argjson output "$output_tokens" \
     --argjson cost "$cost" \
     '
     # Update branch tracking
     .branches[$branch] //= {calls: 0, inputTokens: 0, outputTokens: 0, cost: 0, commands: {}} |
     .branches[$branch].calls += 1 |
     .branches[$branch].inputTokens += $input |
     .branches[$branch].outputTokens += $output |
     .branches[$branch].cost += $cost |
     .branches[$branch].commands[$cmd] //= {calls: 0, inputTokens: 0, outputTokens: 0, cost: 0} |
     .branches[$branch].commands[$cmd].calls += 1 |
     .branches[$branch].commands[$cmd].inputTokens += $input |
     .branches[$branch].commands[$cmd].outputTokens += $output |
     .branches[$branch].commands[$cmd].cost += $cost |

     # Update command tracking (across all branches)
     .commands[$cmd] //= {calls: 0, inputTokens: 0, outputTokens: 0, cost: 0, models: {}} |
     .commands[$cmd].calls += 1 |
     .commands[$cmd].inputTokens += $input |
     .commands[$cmd].outputTokens += $output |
     .commands[$cmd].cost += $cost |
     .commands[$cmd].models[$model] //= 0 |
     .commands[$cmd].models[$model] += 1 |

     # Update agent tracking (CS-081)
     (if $agent != "" then
       .agents //= {} |
       .agents[$agent] //= {calls: 0, inputTokens: 0, outputTokens: 0, cost: 0, models: {}} |
       .agents[$agent].calls += 1 |
       .agents[$agent].inputTokens += $input |
       .agents[$agent].outputTokens += $output |
       .agents[$agent].cost += $cost |
       .agents[$agent].models[$model] //= 0 |
       .agents[$agent].models[$model] += 1 |

       # Weekly agent costs for comparison (CS-081)
       .weeklyAgentCosts //= {} |
       .weeklyAgentCosts[$week] //= {} |
       .weeklyAgentCosts[$week][$agent] //= {calls: 0, cost: 0} |
       .weeklyAgentCosts[$week][$agent].calls += 1 |
       .weeklyAgentCosts[$week][$agent].cost += $cost
     else . end) |

     # Update totals
     .total.calls += 1 |
     .total.inputTokens += $input |
     .total.outputTokens += $output |
     .total.cost += $cost |

     # Add to history (keep last 1000 calls)
     .history //= [] |
     .history += [{timestamp: $ts, command: $cmd, model: $model, branch: $branch, inputTokens: $input, outputTokens: $output, cost: $cost, agent: (if $agent != "" then $agent else null end)}] |
     .history = .history[-1000:]
     ' "$COST_FILE" > "$tmp_file" && mv "$tmp_file" "$COST_FILE"
}

# Track an agent-specific API call (CS-081 helper)
track_agent_call() {
  local agent="${1:-unknown}"
  local model="${2:-sonnet-4.5}"
  local input_tokens="${3:-0}"
  local output_tokens="${4:-0}"
  local command="${5:-agent-call}"

  track_call "$command" "$model" "$input_tokens" "$output_tokens" "$agent"
}

# Get agent cost summary (CS-081)
get_agent_cost() {
  local agent="$1"

  if [ ! -f "$COST_FILE" ]; then
    echo "0"
    return
  fi

  jq -r --arg agent "$agent" '.agents[$agent].cost // 0' "$COST_FILE"
}

# Get all agents summary (CS-081)
get_agents_summary() {
  if [ ! -f "$COST_FILE" ]; then
    echo "{}"
    return
  fi

  jq -r '.agents // {}' "$COST_FILE"
}

# Get cost summary for a branch
get_branch_cost() {
  local branch="${1:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')}"

  if [ ! -f "$COST_FILE" ]; then
    echo "0"
    return
  fi

  jq -r --arg branch "$branch" '.branches[$branch].cost // 0' "$COST_FILE"
}

# Get cost summary for a command
get_command_cost() {
  local command="$1"

  if [ ! -f "$COST_FILE" ]; then
    echo "0"
    return
  fi

  jq -r --arg cmd "$command" '.commands[$cmd].cost // 0' "$COST_FILE"
}

# Get total cost
get_total_cost() {
  if [ ! -f "$COST_FILE" ]; then
    echo "0"
    return
  fi

  jq -r '.total.cost // 0' "$COST_FILE"
}

# Main command dispatcher
case "${1:-help}" in
  track)
    track_call "${2:-unknown}" "${3:-sonnet-4.5}" "${4:-0}" "${5:-0}" "${6:-}"
    ;;
  track-agent)
    track_agent_call "${2:-unknown}" "${3:-sonnet-4.5}" "${4:-0}" "${5:-0}" "${6:-agent-call}"
    ;;
  branch)
    get_branch_cost "${2:-}"
    ;;
  command)
    get_command_cost "${2}"
    ;;
  agent)
    get_agent_cost "${2}"
    ;;
  agents)
    get_agents_summary
    ;;
  total)
    get_total_cost
    ;;
  init)
    init_cost_tracking
    echo "Cost tracking initialized at $COST_FILE"
    ;;
  help|*)
    cat <<EOF
Cost Tracking Utility

Usage:
  track-cost.sh track <command> <model> <input_tokens> <output_tokens> [agent]
  track-cost.sh track-agent <agent> <model> <input_tokens> <output_tokens> [command]
  track-cost.sh branch [branch_name]
  track-cost.sh command <command_name>
  track-cost.sh agent <agent_name>
  track-cost.sh agents
  track-cost.sh total
  track-cost.sh init

Examples:
  # Track an API call
  track-cost.sh track "/bs:quality" "sonnet-4.5" 25000 5000

  # Track an API call with agent (CS-081)
  track-cost.sh track "/bs:quality" "sonnet-4.5" 25000 5000 "code-reviewer"

  # Track agent-specific call (CS-081)
  track-cost.sh track-agent "code-reviewer" "sonnet-4.5" 25000 5000 "/bs:quality"

  # Get cost for current branch
  track-cost.sh branch

  # Get cost for specific command
  track-cost.sh command "/bs:quality"

  # Get cost for specific agent (CS-081)
  track-cost.sh agent "code-reviewer"

  # Get all agents summary (CS-081)
  track-cost.sh agents

  # Get total cost
  track-cost.sh total

Data stored in: ~/.claude/cost-tracking.json
EOF
    ;;
esac
