# scripts/

Automation scripts for claude-kit. Most scripts are standalone — run directly or via GitHub Actions.

## symphony-dispatch.py

**GitHub issue → acpx agent → PR dispatch loop (Symphony-lite)**

Polls GitHub issues labeled `agent-ready`, spawns an isolated acpx Claude session per issue, creates a PR on completion, and moves the issue to `agent-in-review`.

### Prerequisites

- `gh` CLI authenticated (`gh auth login`)
- `acpx` CLI available in PATH
- `git` with worktree support (standard)
- Target repo has `WORKFLOW.md` in root (see `docs/WORKFLOW-TEMPLATE.md`)

### Usage

```bash
# Dry run — see what would happen without executing
python3 scripts/symphony-dispatch.py --repo your-org/your-repo --dry-run --once

# Poll once and exit
python3 scripts/symphony-dispatch.py --repo your-org/your-repo --once

# Continuous polling (every 5 min)
python3 scripts/symphony-dispatch.py --repo your-org/your-repo

# Custom label and interval
python3 scripts/symphony-dispatch.py --repo your-org/your-repo \
  --label ready-for-agent --interval 120
```

### Flags

| Flag                  | Default       | Description                           |
| --------------------- | ------------- | ------------------------------------- |
| `--repo OWNER/REPO`   | required      | Target GitHub repository              |
| `--label LABEL`       | `agent-ready` | Issue label to poll                   |
| `--dry-run`           | false         | Print actions without executing       |
| `--once`              | false         | Poll once then exit                   |
| `--interval SECONDS`  | 300           | Polling interval (continuous mode)    |
| `--worktree-root DIR` | `/tmp`        | Base directory for isolated worktrees |

### Issue lifecycle

```
agent-ready → (agent runs) → agent-in-review → (human merges/closes)
```

The script:

1. Detects issues labeled `agent-ready`
2. Creates isolated git worktree (`/tmp/symphony-{issue_number}`)
3. Builds a prompt from issue title + body + repo's `WORKFLOW.md`
4. Spawns `acpx claude -s symphony-{N} "{prompt}"`
5. Pushes the branch and opens a PR
6. Comments on the issue with the PR URL
7. Swaps labels: removes `agent-ready`, adds `agent-in-review`

### WORKFLOW.md

Each target repo should have a `WORKFLOW.md` in its root that defines stack constraints, quality gates, coding style, and forbidden patterns. Copy `docs/WORKFLOW-TEMPLATE.md` as a starting point.

---

## schedule-dispatcher.py

Posts scheduled social media content from `data/schedule-queue.json`. **Currently disabled** — queue file was never created. Workflow is manual-only (`workflow_dispatch`). Re-enable when scheduling is implemented.

## Other scripts

Most other scripts in this directory are utilities invoked by slash commands,
GitHub Actions workflows, or pre-commit hooks. See comments at the top of each file.
