---
name: bs:backlog
description: 'Show/manage project backlog with value-based prioritization'
argument-hint: '[--add "item" | --stats | --next]'
category: project
model: haiku
---

# /bs:backlog — $ARGUMENTS

Score = (Revenue + Retention + Differentiation) ÷ Effort (S=÷1, M=÷2, L=÷3, XL=÷4)

Backlog is managed in **Linear** (https://linear.app/buildproven). Use the Linear MCP tools:

## Linear MCP Tools

- **List:** `mcp__linear__list_issues(filter: { state: { name: { eq: "Backlog" } } }, first: 50)`
- **Next:** `mcp__linear__list_issues(filter: { state: { name: { eq: "Backlog" } } }, first: 1)` — returns highest-priority
- **Add:** `mcp__linear__create_issue(title, description, teamId, priority, estimate, labelIds)`
- **Complete:** `mcp__linear__update_issue(id, stateId)` — set state to "Done"
- **Get:** `mcp__linear__get_issue(id)` — by Linear ID (e.g. BUI-5)
- **Search:** `mcp__linear__search_issues(query)`

Priority: ≥6→Urgent(1), ≥3→High(2), ≥1.5→Medium(3), else Low(4). Effort→points: XS=1, S=2, M=3, L=5, XL=8.
Labels: `type:feature`, `type:bug`, `type:tech-debt`, `effort:XS`…`effort:XL`

## Actions

**No args (default):** Fetch all open issues from Linear and display grouped by priority:

```
📋 PROJECT BACKLOG (Linear)
============================
📊 Stats: X open | Y urgent | Z high | W medium | N low

🔴 URGENT — X items
━━━━━━━━━━━━━━━━━━━
BUI-N  [effort:M]  Title truncated to 70 chars

🟠 HIGH — X items
...
```

**--next:** Show the single highest-priority open issue — same as `mcp__linear__list_issues(first: 1)`.

**--add "desc":** Create a new Linear issue interactively. Prompt for type, effort, then call `mcp__linear__create_issue`.

**--stats:** Show counts by state and priority. List the 3 oldest Backlog issues by creation date.
