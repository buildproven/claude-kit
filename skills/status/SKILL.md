---
name: status
description: Project catch-up summary — recent commits, PRs, CI, next steps
triggers:
  - "catch.*up"
  - "what.*happened"
  - "what.*changed"
  - "what.*going on"
  - "project.*status"
  - "recent.*activity"
  - "what.*miss"
---

# Status Skill

Generate the project catch-up summary directly. Do not delegate to a slash
command.

## Inputs

Default to seven days. If the caller supplies `--recent <N>d`, use that exact
positive day count. Reject malformed arguments with one short usage message.

## Execution

Resolve the repository root with `git rev-parse --show-toplevel`. If it fails,
state that status needs a Git repository and stop. Run only read-only commands:

1. `git status --short --branch`
2. `git log --since=<window> --date=short --format=%h%x09%ad%x09%an%x09%s`
3. `git rev-list --left-right --count HEAD...@{upstream}` when an upstream exists
4. `gh pr list --state open --limit 20 --json number,title,url,headRefName,headRefOid,mergeStateStatus,statusCheckRollup`
5. `gh run list --limit 20 --json databaseId,workflowName,headSha,status,conclusion,url,createdAt`

Do not run an install, dependency update, fetch, checkout, mutation, or remote
write. If GitHub CLI or network evidence is unavailable, label PR and CI status
`UNVERIFIED` and include the command error in one line. Do not infer green CI
from local tests or a clean tree.

## Output

State the result first. Report:

- repository, branch, upstream, ahead/behind counts, and dirty-file count;
- recent commits in newest-first order;
- open PRs with exact head and current check state;
- recent CI grouped by exact head;
- concrete blockers and the next evidence-backed action.

Keep implementation, PR, CI, hosted, and release state separate. Do not call a
clean checkout, open PR, or passing local test a completed delivery.
