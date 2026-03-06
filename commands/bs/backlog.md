---
name: bs:backlog
description: 'Show/manage project backlog with value-based prioritization'
argument-hint: '[--create | --update | --add "item"] → view, create, or modify backlog'
category: project
model: haiku
---

# /bs:backlog Command

**Arguments received:** $ARGUMENTS

## Find Backlog File

Search for backlog file in this order:

1. `BACKLOG.md` (root)
2. `backlog.md` (root)
3. `docs/BACKLOG.md`
4. `docs/backlog.md`
5. `.github/BACKLOG.md`

## Argument Handling

### No arguments (default) → Display backlog

If backlog file exists, display it formatted nicely with:

- Summary stats: total items, by category, by status
- The full backlog content

If no backlog file found, suggest creating one with `--create`.

### --create → Create new backlog

Create `BACKLOG.md` in project root with this template:

```markdown
# [Project Name] Backlog

> Value-based prioritization: Score = (Revenue + Retention + Differentiation) ÷ Effort

## Scoring Guide

| Dimension           | 1                 | 3                       | 5                    |
| ------------------- | ----------------- | ----------------------- | -------------------- |
| **Revenue**         | No direct revenue | Indirect/enables        | Users will pay       |
| **Retention**       | One-time use      | Nice to have            | Must-have, daily use |
| **Differentiation** | Table stakes      | Better than competitors | Unique/novel         |

**Effort:** S (<4h) = ÷1, M (4-16h) = ÷2, L (16-40h) = ÷3, XL (40h+) = ÷4

---

## High Value (Score ≥ 3.0)

| ID  | Item                    | Type    | Value (R/R/D) | Effort | Score | Status  |
| --- | ----------------------- | ------- | ------------- | ------ | ----- | ------- |
| 001 | Example high-value item | Feature | 4/4/3         | M      | 5.5   | Pending |

## Medium Value (Score 2.0-2.9)

| ID  | Item | Type | Value (R/R/D) | Effort | Score | Status |
| --- | ---- | ---- | ------------- | ------ | ----- | ------ |

## Low Value (Score < 2.0)

| ID  | Item | Type | Value (R/R/D) | Effort | Score | Status |
| --- | ---- | ---- | ------------- | ------ | ----- | ------ |

## Completed

| ID  | Item | Type | Completed |
| --- | ---- | ---- | --------- |

---

## Checkpoints

Define milestones for `/bs:ralph-dev --until checkpoint:<name>`:

- [ ] mvp: (add item IDs when ready)
- [ ] v1.0: All High Value items
- [ ] launch: (add critical items)

---

## Notes

- **Types:** Feature | Bug | Security | Perf | Docs | Refactor | Tech Debt
- **Status:** Pending | Ready | In Progress | Blocked | Deferred
- **Checkpoints:** Used by `/bs:ralph-dev` for milestone-based stopping
- Re-evaluate quarterly as market changes
```

### --update → Re-score and reorganize

1. Read current backlog
2. Recalculate all scores: `(Rev + Ret + Diff) ÷ Effort`
3. Move items to correct category based on score
4. Sort within categories by score (highest first)
5. Report changes made

### --add "item description" → Add new item

Prompt for:

1. Item description (from argument)
2. Type (Feature/Bug/Security/Perf/Docs/Refactor/Tech Debt)
3. Revenue score (1-5)
4. Retention score (1-5)
5. Differentiation score (1-5)
6. Effort (S/M/L/XL)

Calculate score, assign next ID, add to appropriate category.

### --stats → Show statistics only

Display:

- Total items by status
- Total items by type
- Average score by category
- Oldest pending items

### --checkpoint "name: ID1, ID2, ID3" → Add checkpoint

Add a new checkpoint for `/bs:ralph-dev` milestone tracking:

```bash
/bs:backlog --checkpoint "mvp: CS-010, CS-011, CS-012"
/bs:backlog --checkpoint "v1.0: All High Value items"
```

This adds to the `## Checkpoints` section in BACKLOG.md.

### --checkpoints → List checkpoints

Display all defined checkpoints with completion status:

```markdown
## Checkpoints

- [ ] mvp: CS-010, CS-011, ✅CS-012 (1/3 complete)
- [ ] v1.0: 12 High Value items (5/12 complete)
- [x] cleanup: All bugs ✅ (complete)
```

## Output Format (REQUIRED)

**CRITICAL: You MUST format output EXACTLY like this. Do not summarize, paraphrase, or use any other format.**

```
📋 PROJECT BACKLOG
==================

📊 Stats: X total | Y pending | Z in progress | W completed

🔥 HIGH VALUE (≥3.0) - X items
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
| ID | Item | Type | Value (R/R/D) | Effort | Score | Status |
|----|------|------|---------------|--------|-------|--------|
| ... actual rows from backlog ... |

📊 MEDIUM VALUE (2.0-2.9) - X items
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
| ID | Item | Type | Value (R/R/D) | Effort | Score | Status |
|----|------|------|---------------|--------|-------|--------|
| ... actual rows from backlog ... |

📚 LOW VALUE (<2.0) - X items
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
| ID | Item | Type | Value (R/R/D) | Effort | Score | Status |
|----|------|------|---------------|--------|-------|--------|
| ... actual rows from backlog ... |

```

**Format rules:**

1. Use the EXACT emoji headers shown above
2. Use the ━━━ divider lines (not --- or ===)
3. Show actual markdown tables with proper alignment
4. Count items accurately for each section header
5. If a section is empty, show "None" instead of the table
6. Never truncate or summarize active items (High/Medium/Low)
7. **NEVER show the Completed section** — omit it entirely to save tokens. Completed count goes in Stats only.

## Important Notes

- **Follow the Output Format EXACTLY** - no deviations, no summaries
- Always show the scoring formula reminder at top
- Highlight items that may need re-scoring (old items, changed market)
- Suggest killing low-value high-effort items
- Group dependencies when displaying
- If backlog has detail file links (e.g., `[→](docs/backlog-items/B-XXX.md)`), preserve them in output
