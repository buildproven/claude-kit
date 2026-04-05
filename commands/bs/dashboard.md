---
name: bs:dashboard
description: Launch agent monitoring dashboard
argument-hint: '-> opens http://localhost:3847'
tags: [agents, monitoring, dashboard]
category: dev
model: haiku
---

# /bs:dashboard - Agent Monitoring Dashboard

Starts a lightweight local web UI for monitoring parallel agent status.

## Usage

```bash
/bs:dashboard          # Start dashboard server on port 3847
/bs:dashboard --stop   # Stop running dashboard server
```

## What it does

1. Starts `scripts/agent-dashboard-server.js` on port 3847
2. Opens `http://localhost:3847` in the browser
3. Dashboard auto-refreshes every 5 seconds

## What it shows

- **Active Agents** — name, current task, elapsed time, status (running/done/failed)
- **Git Worktrees** — active worktree branches and paths
- **Recent Completions** — recent task and agent outputs
- **Recent Task Output** — files from /tmp/claude-\*/tasks/

## Manual start

```bash
node ~/Projects/claude-power-kit/scripts/agent-dashboard-server.js &
open http://localhost:3847
```

## Instructions

When the user runs `/bs:dashboard`:

1. Check if port 3847 is already in use: `lsof -i :3847`
2. If not running, start the server:
   ```bash
   node ~/Projects/claude-power-kit/scripts/agent-dashboard-server.js &
   ```
3. Open in browser: `open http://localhost:3847`
4. Report: "Dashboard running at http://localhost:3847"

When `--stop` is passed:

1. Find the process: `lsof -ti :3847`
2. Kill it: `kill $(lsof -ti :3847)`
3. Report: "Dashboard stopped"
