---
name: bs:cost
description: 'Show real-time cost tracking per feature/branch/command with budget alerts'
argument-hint: '[--branch <name>] [--command <name>] [--agents] [--forecast] [--expensive] [--budget] [--reset]'
category: project
model: haiku
---

# /bs:cost - Real-Time Cost Tracking

**Arguments received:** $ARGUMENTS

## Usage

```bash
/bs:cost                          # Cost for current branch + top commands
/bs:cost --branch feature/login   # Cost for specific branch
/bs:cost --command /bs:quality    # Cost for specific command (all branches)
/bs:cost --quota                  # Weekly quota usage and projections (CS-149)
/bs:cost --agents                 # Per-agent cost breakdown (CS-081)
/bs:cost --forecast               # Monthly spend forecast
/bs:cost --expensive              # Most expensive operations
/bs:cost --budget                 # Budget status and alerts (CS-063)
/bs:cost --reset                  # Reset all cost tracking (confirm first)
```

## Implementation

### Step 1: Parse Arguments

```bash
COST_FILE="${HOME}/.claude/cost-tracking.json"
SCRIPT_PATH="${HOME}/Projects/claude-setup/scripts/track-cost.sh"
CONFIG_FILE=".claude/cost-config.json"
DEFAULT_MONTHLY_BUDGET=200

MODE="summary"  # summary, branch, command, quota, agents, forecast, expensive, budget, reset
TARGET_BRANCH=""
TARGET_COMMAND=""

# Parse: --branch NAME, --command NAME, --quota, --agents, --forecast, --expensive, --budget, --reset
# Default branch to current if --branch with no name
```

### Step 2: Check for Cost Tracking Data

```bash
# Initialize if cost file missing: "$SCRIPT_PATH" init
# Verify jq is installed (required)
```

### Step 2.5: Budget Alert Helper Functions (CS-063)

```bash
get_budget_config() {
  # Read from $CONFIG_FILE or use defaults: $200 budget, [0.75, 0.90, 1.0] thresholds
}

check_budget_alerts() {
  # Calculate BUDGET_PERCENT = TOTAL_COST / MONTHLY_BUDGET * 100
  # >=100%: BUDGET ALERT (optional blocking if blockAtLimit=true), return 3
  # >=90%: WARNING (suggest Sonnet over Opus), return 2
  # >=75%: Notice, return 1
  # else: OK, return 0
}

display_inline_cost() {
  # Called by other commands after API calls. Shows cost + triggers budget alert if >=90%
}
```

### Step 3: Display Based on Mode

#### Mode: Summary (Default)

```bash
if [ "$MODE" = "summary" ]; then
  # Format helper: tokens >1M show as "X.YM", else "XK"

  # == Overall Usage ==
  # Total Cost, API Calls, Tokens (input + output)

  # == Current Branch: $CURRENT_BRANCH ==
  # Cost, API Calls, Tokens
  # Top 5 Commands table: | Command | Calls | Cost |

  # == Most Expensive Branches (top 5) ==
  # | Branch | Cost | Calls |

  # == Most Expensive Commands (top 5) ==
  # | Command | Total Cost | Calls | Avg per Call |

  # Tips: --branch, --command, --forecast, --expensive
fi
```

#### Mode: Branch Detail

```bash
if [ "$MODE" = "branch" ]; then
  # Total Cost, API Calls, Input/Output Tokens
  # Command Breakdown: | Command | Calls | Input | Output | Cost |
fi
```

#### Mode: Command Detail

```bash
if [ "$MODE" = "command" ]; then
  # Total Cost, API Calls, Avg Cost per Call, Tokens
  # Model Usage: | Model | Calls |
  # Branches Using This Command (top 10): | Branch | Calls | Cost |
fi
```

#### Mode: Forecast

```bash
if [ "$MODE" = "forecast" ]; then
  # Calculate daily average from history date range
  # Project 30-day spend
  # Status: <$100 "Well under budget", <$200 "Within budget", else "Approaching limit"
  # Weekly Breakdown: | Week | Calls | Cost |
fi
```

#### Mode: Expensive Operations

```bash
if [ "$MODE" = "expensive" ]; then
  # Highest Individual Calls (top 10): | Timestamp | Command | Branch | Model | Cost |
  # Commands with Highest Avg Cost (top 10): | Command | Avg Cost | Calls | Total |
  # Branches with High Cost/Call Ratio (top 10): | Branch | Cost/Call | Calls | Total Cost |
fi
```

#### Mode: Reset

```bash
if [ "$MODE" = "reset" ]; then
  # Show warning with current total cost and calls
  # Provide rm command to confirm, with backup option
fi
```

#### Mode: Per-Agent Cost Breakdown (CS-081)

```bash
if [ "$MODE" = "agents" ]; then
  # Agent Cost Ranking: | Rank | Agent Type | Calls | Tokens | Total Cost | % of Budget |
  # Model Usage by Agent: | Agent | Haiku | Sonnet | Opus | Recommended |
  #   Recommended: Explore/grep-search=Haiku, architect-reviewer=Opus, others=Sonnet

  # Weekly Comparison (this week vs last): | Agent | This Week | Last Week | Change |

  # Optimization Opportunities:
  #   - Flag agents using >40% of budget with specific advice
  #   - Flag Opus used for simple tasks (Explore/grep) -> switch to Haiku
  #   - Flag Haiku used for complex tasks (architect-reviewer) -> switch to Opus

  # Daily Agent Costs (last 7 days): | Day | Top Agent | Cost | Calls |

  # Model Cost Reference:
  #   Haiku 3.5: $0.80/$4.00 per 1M (simple search, file listing)
  #   Sonnet 4.5: $3.00/$15.00 per 1M (code review, most analysis)
  #   Opus 4.5: $15.00/$75.00 per 1M (architecture, complex reasoning)
fi
```

#### Mode: Weekly Quota Usage (CS-149)

```bash
if [ "$MODE" = "quota" ]; then
  # Run usage-audit.sh script
  USAGE_AUDIT_SCRIPT="${HOME}/Projects/claude-setup/scripts/usage-audit.sh"

  if [ -f "$USAGE_AUDIT_SCRIPT" ]; then
    "$USAGE_AUDIT_SCRIPT"
  else
    echo "❌ Usage audit script not found"
    echo "   Expected: $USAGE_AUDIT_SCRIPT"
    echo "   Run: /bs:dev CS-149 to install"
    exit 1
  fi
fi
```

#### Mode: Budget Status (CS-063)

```bash
if [ "$MODE" = "budget" ]; then
  # Current Configuration: Monthly Budget, Alert Thresholds, Block at Limit, Config Source
  # Current Spending: Spent, Budget, Remaining, Used %
  # Visual budget bar (40 chars): [░░░▓▓▓███] XX.X%
  # Status: OVER BUDGET / Critical (90%+) / Warning (75%+) / Healthy

  # Month-End Forecast: Daily Average, Projected Total, Days Remaining
  #   If over: projected overage + recommendations
  #   If under: projected headroom

  # Configure Budget: show .claude/cost-config.json schema
fi
```

## Flags

| Flag               | Description                                               |
| ------------------ | --------------------------------------------------------- |
| `--branch <name>`  | Cost breakdown for specific branch                        |
| `--command <name>` | Cost breakdown for specific command                       |
| `--quota`          | Weekly quota usage and projections (CS-149)               |
| `--agents`         | Per-agent cost breakdown with model optimization tips     |
| `--forecast`       | Monthly spend prediction based on usage patterns          |
| `--expensive`      | Find optimization opportunities (highest cost operations) |
| `--budget`         | Budget status, alerts, and configuration                  |
| `--reset`          | Reset all cost tracking data (with confirmation)          |

## Budget Configuration

`.claude/cost-config.json`: `{ "monthlyBudget": 200, "alertThresholds": [0.75, 0.9, 1.0], "blockAtLimit": false }`

## Model Cost Optimization

| Model  | Cost (approx) | Best For                            |
| ------ | ------------- | ----------------------------------- |
| Haiku  | $0.25/1M      | Simple searches, file listing, grep |
| Sonnet | $3/1M         | Code review, analysis, most tasks   |
| Opus   | $15/1M        | Architecture, complex reasoning     |

**Agent-specific recommendations:**

- **Explore agents**: Use Haiku (5-10x cheaper)
- **code-reviewer**: Use Sonnet (good balance)
- **architect-reviewer**: Use Opus (needs depth)
- **security-auditor**: Use Sonnet (pattern matching)

## See Also

- `/bs:quality` - Quality loop with cost tracking
- `/bs:dev` - Development workflow with cost tracking
- `/bs:ralph` - Autonomous development (cost-efficient)
