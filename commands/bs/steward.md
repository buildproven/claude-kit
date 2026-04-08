---
name: bs:steward
description: 'Autonomous dev environment steward: hygiene, currency, quality across all projects'
argument-hint: '[--daily|--weekly|--module <name>|--dry-run|--fix|--fix-prs|--status]'
category: maintenance
model: sonnet
---

# /bs:steward - Development Environment Steward

Autonomous agent that maintains quality, hygiene, and currency across ~/Projects (~34 projects, 31+ GitHub repos).

## Usage

```bash
/bs:steward                    # Full run (auto-detects daily vs weekly cadence)
/bs:steward --daily            # Daily modules only
/bs:steward --weekly           # Weekly modules (includes daily)
/bs:steward --module <name>    # Single module
/bs:steward --dry-run          # Detect only, no fixes
/bs:steward --fix              # Enable Tier 1+2 auto-fixes
/bs:steward --fix-prs          # Create PRs for Tier 2 findings
/bs:steward --status           # Show current state + pending findings
```

## Execution

### Status Mode (--status)

```bash
STATE_FILE="$HOME/Projects/claude-setup/data/steward-state.json"
if [ -f "$STATE_FILE" ]; then
  python3 -c "
import json, datetime
with open('$STATE_FILE') as f:
    s = json.load(f)
print(f\"Last daily:  {s.get('last_daily', 'never')}\")
print(f\"Last weekly: {s.get('last_weekly', 'never')}\")
print(f\"Quota mode:  {s.get('quota_mode', 'unknown')}\")
findings = s.get('findings', [])
print(f\"Findings:    {len(findings)}\")
for f in findings:
    sev = f.get('severity','?')
    icon = {'critical':'🔴','error':'🟠','warning':'🟡','info':'🔵'}.get(sev,'⚪')
    print(f\"  {icon} [{f.get('module','')}] {f.get('message','')}\")
"
else
  echo "No steward state found. Run /bs:steward first."
fi
```

If `--status` was passed, show the output above and stop.

### Standard Run

Run the orchestrator:

```bash
SETUP_REPO="$HOME/Projects/claude-setup"
cd "$SETUP_REPO"

# Build flags from user args
FLAGS=""
# Parse the argument hint for flags:
# --daily   → FLAGS="--daily"
# --weekly  → FLAGS="--weekly"
# --module X → FLAGS="--module X"
# --dry-run → append "--dry-run"
# --fix     → append "--fix"

bash scripts/steward/orchestrate.sh $FLAGS
```

### Fix PRs Mode (--fix-prs)

When `--fix-prs` is passed, read findings from state and create PRs:

```bash
STATE_FILE="$HOME/Projects/claude-setup/data/steward-state.json"
```

1. Read `findings` from state file
2. For each Tier 2 finding (doc-drift, test-coverage-churn with severity=warning):
   a. Create a feature branch: `steward/fix-<module>-<date>`
   b. Apply the fix (generate missing docs, add test stubs)
   c. Commit with conventional format: `docs: update stale README for <repo>` or `test: add coverage for <file>`
   d. Open PR with body explaining the finding
3. Max 3 PRs per run. One concern per branch.
4. Update state: increment `pr_count_today`, set `last_pr_date`

## Modules

| Module                | What                                                             | Cadence   | Cost |
| --------------------- | ---------------------------------------------------------------- | --------- | ---- |
| `quota-guard`         | Claude usage quota → budget mode                                 | Every run | Zero |
| `github-hygiene`      | Stale branches (remote+local), orphan PRs, settings              | Daily     | Zero |
| `config-freshness`    | Tool versions, symlinks, MCP                                     | Daily     | Zero |
| `gateway-health`      | Docker, tokens, cron, versions                                   | Daily     | Zero |
| `doc-drift`           | Code churn vs doc freshness                                      | Daily     | Zero |
| `ci-governance`       | CI minutes, cron schedules, dormant repos                        | Daily     | Zero |
| `test-coverage-churn` | High-churn files without tests                                   | Weekly    | Zero |
| `refactor-hotspots`   | Churn + dead code + large files                                  | Weekly    | Zero |
| `repo-hygiene`        | Repo bloat, dead scripts, empty/stale ~/Projects dirs, disk hogs | Weekly    | Zero |
| `retro`               | Git patterns, fix chains, hotspots, burnout signals              | Weekly    | Zero |
| `auto-fix`            | Apply Tier 1 fixes from findings                                 | On --fix  | Zero |

## Quota Governor

| 7-day % | Mode         | Effect                        |
| ------- | ------------ | ----------------------------- |
| 0-30%   | normal       | All modules, auto-fix enabled |
| 31-50%  | conservative | Skip refactor + coverage      |
| 51-70%  | minimal      | Zero-cost modules only        |
| 71%+    | paused       | Log warning, skip everything  |

## Auto-Fix Tiers

| Tier        | Auto?                | Examples                                                                                                                              |
| ----------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Safe    | Yes (with --fix)     | Delete merged/gone local branches, switch repos to main, enable delete_branch_on_merge, fix symlinks, `npm update -g`, `brew upgrade` |
| 2 — Via PR  | Yes (with --fix-prs) | Update stale docs, add test stubs                                                                                                     |
| 3 — Propose | No                   | Refactor hotspots — manual review only                                                                                                |

## After Run

Summarize findings concisely:

- Critical/error items first
- Count of findings by module
- Actions taken (Tier 1 fixes applied, PRs created)
- Next recommended action if any
