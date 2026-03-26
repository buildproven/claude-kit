---
name: bs:office-hours
description: 'YC-style forcing questions for product/feature evaluation'
argument-hint: '<idea or feature> [--project <name>] [--linear] → structured evaluation'
tags: [strategy, product, evaluation, yc]
category: strategy
model: opus
---

# /bs:office-hours - YC Forcing Function Evaluation

**Usage**: `/bs:office-hours <idea or feature> [--project <name>] [--linear]`

Evaluate any product idea, feature, or pivot through 6 YC-style forcing questions. Inspired by Y Combinator's office hours methodology — forces specificity and cuts through wishful thinking.

**Time:** 5-15 minutes

## Context Gathering

Before asking the questions, gather context:

1. If `--project` specified, read that project's README, CLAUDE.md, and recent git log
2. If in a git repo, read the current project context
3. If the idea references an existing product, check the site/repo first (**research before opinions**)

## The 6 Forcing Questions

Work through each question sequentially. For each, provide your honest assessment based on available evidence. Don't softball — the value is in the rigor.

### 1. Demand Reality

> "What's the strongest evidence someone actually wants this?"

- Waitlist signups ≠ demand. Revenue, usage data, or desperate emails = demand.
- If no evidence exists, say so. "We think people want it" is not evidence.
- Rate evidence strength: **Strong** (paying/using) / **Moderate** (asked for it) / **Weak** (assumed)

### 2. Status Quo

> "What workaround are they using today?"

- Every problem has a current solution, even if it's manual/painful.
- You're competing against the workaround, not a competitor.
- If no workaround exists, question whether the problem is real.

### 3. Desperate Specificity

> "Name the actual human. What gets them stuck/fired/frustrated if this doesn't exist?"

- "Enterprises" → who at the enterprise? What's their title? What's their daily pain?
- "Developers" → which developers? What stack? What are they building?
- If you can't name a person, you don't understand the problem yet.

### 4. Narrowest Wedge

> "What's the smallest version someone pays for (or obsessively uses) this week?"

- Not "MVP" — the **narrowest wedge** that proves the value proposition.
- If you can't ship something valuable in a week, the scope is wrong.
- Strip features until one thing remains. That's your wedge.

### 5. Observation

> "What surprised you watching someone use it (or the workaround)?"

- Interviews lie. Observation reveals.
- What did they do that you didn't expect?
- What step took 10x longer than you assumed?
- If you haven't watched anyone, this is your next action item.

### 6. Future-Fit

> "Does this become MORE essential in 3 years, or can everyone copy it?"

- Trend-riding ≠ defensibility. "AI is hot" is not a moat.
- What structural advantage compounds over time? (Data, network effects, integrations, expertise)
- If a well-funded competitor could replicate it in 3 months, what's your real edge?

## Verdict

After all 6 questions, provide a structured verdict:

```
## Verdict: [GO | HOLD | KILL]

**Confidence**: [High | Medium | Low]

**Summary**: [1-2 sentences]

**Strongest signal**: [Which question revealed the most insight]

**Biggest risk**: [Which question had the weakest answer]

**Next action**: [One specific thing to do this week]
```

### Verdict criteria:

- **GO**: Strong demand evidence + named user + shippable wedge this week
- **HOLD**: Promising but missing evidence on 2+ questions. Next action = gather evidence.
- **KILL**: No demand evidence + no specific user + no clear wedge. Redirect energy.

## Optional: Create Linear Issue

If `--linear` flag is passed and the verdict is GO or HOLD:

```bash
# Create Linear issue with the evaluation
# Use the team from the current project context
```

Create a Linear issue with:

- Title: `[Office Hours] <idea summary>`
- Description: Full evaluation output
- Priority: GO = Urgent, HOLD = Medium
- Label: `office-hours`
