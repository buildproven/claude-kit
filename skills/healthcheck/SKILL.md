---
name: healthcheck
description: Session start health check — verify MCP servers, repo sync status, and local agent gateway. Use when starting a session that involves social media, multi-repo work, or Docker operations.
---

# Health Check

Run a quick preflight before starting work. Check only what's relevant to the upcoming task.

## 1. MCP Servers (for social media / integration sessions)

For each configured MCP server (Twitter, LinkedIn, Facebook):

1. Check it's registered and responding
2. Verify `.env` file exists and keys are non-empty — print key **names** only, never values
3. Report: ✅ connected / ❌ failing + root cause

Common failures to diagnose:

- Stale project-level config overriding global
- Wrong `.env` path
- Server not started / crashed

## 2. Repo Sync Status (for multi-repo sessions)

For each repo under `~/Projects/`:

1. Check for uncommitted changes
2. Check if ahead/behind remote
3. Report as a table: repo | branch | status

Skip archived repos. Flag any with push failures.

## 3. Local Agent Gateway (for bot/Docker sessions)

1. Check container is running: `docker ps | grep agent-gateway`
2. Verify gateway token env var is set — print **name** only, never value
3. Check for pending device approvals

## Output Format

Print a compact status table. Only show failures in detail. End with:

> ✅ All clear — ready to work
> or
> ⚠️ Issues found: [list] — fix before proceeding?
