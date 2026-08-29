---
name: backlog
description: Project backlog — what's next, priorities, Linear integration
triggers:
  - "backlog"
  - "what.*next"
  - "priorit"
  - "what.*work.*on"
  - "next.*task"
  - "show.*todo"
---

# Backlog Skill

Read or update the project backlog directly. Do not delegate to a slash command.
Linear is the source of truth.

## Dependency check

Confirm that Linear tools are available before any action. If they are not,
state that the Linear connector is unavailable. Do not invent issues or replace
missing Linear data with a local TODO list.

## Scope

Resolve the current repository name and use the matching Linear project unless
the caller names another project. Exclude archived issues by default. Preserve
unknown project identity as `UNVERIFIED`; ask for the project only when search
cannot resolve it safely.

## Actions

- No arguments: list open issues in the project. Group by Urgent, High, Medium,
  Low, then No priority. Within each group, put started work before backlog work
  and older items first. Show ID, status, title, assignee, estimate, and blocker.
- `--next`: return the highest-priority unblocked open issue. Prefer active work,
  then Urgent through No priority, then oldest. State why it is next.
- `--stats`: count open issues by state and priority. List the three oldest
  Backlog issues with created dates.
- `--add "<description>"`: ask only for material missing fields, then create one
  issue in the resolved project. Include evidence and acceptance criteria when
  the request describes a defect.

Use the available Linear list, search, get, and save tools. Read before writing.
Never mark an issue Done without exact delivery evidence. For a material defect,
include root cause, file and line evidence, failure scenario, fix direction,
priority, and relevant links.

## Output

State the result first. Keep unresolved data `UNVERIFIED`. Return concise counts,
ordered issues, blockers, and one next action. Do not claim that an empty query
means an empty backlog unless the project filter and pagination are complete.
