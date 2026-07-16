---
name: verify-claim
title: "Verify Claim"
description: Enforce research rigor — extract factual claims from drafts, verify each against primary sources, mark unverifiable as [unverified] before output. Use before writing any research, strategy, or competitive-analysis memo.
context: fork
user-invocable: false
# Runs unattended (forked, no user in the loop). AskUserQuestion here would
# block forever with nobody to answer it — remove the tool, don't just ask it
# nicely not to. https://code.claude.com/docs/en/skills
disallowed-tools: AskUserQuestion
---

# /verify-claim — Research Rigor Enforcement

**Purpose**: Stop unverified factual claims (counts, names, versions, dates, quotes) from reaching the reader. Verify or mark `[unverified]` — never guess, never interpolate.

## When to Run

- Before publishing any research memo, strategy doc, or competitive analysis
- After drafting a section that contains numbers, names, or versions
- When asked to "fact-check" or "verify" any output
- Proactively during long-form analysis sessions, every ~500 words

## Inputs

- A draft (file path, pasted text, or current conversation output)
- Optional: list of primary sources to check against (repo paths, URLs, docs)

## Process

### 1. Extract Claims

Parse the draft and produce a numbered list of every **factual assertion**. A factual assertion is anything where wrong = wrong, not opinion. Includes:

- Counts (e.g., "9 agents", "3 repos", "187 commits")
- Named entities (people, products, repos, commands, files, libraries)
- Versions (model IDs, package versions, dates)
- Direct or indirect quotes
- Causal claims about specific events ("this broke because X")

Skip: opinions, recommendations, hypotheticals.

### 2. Verify Each Claim

For each claim, attempt verification in this order:

1. **Repo evidence** — `grep`, file `Read`, `git log` for claims about code/commits/configs
2. **Live source** — `WebFetch` for claims about external URLs/APIs/docs
3. **Authoritative reference** — official docs (use `context7` MCP for library/SDK claims)
4. **Cross-reference** — at least 2 independent sources for high-stakes external facts

For each claim, record:

```
[N] CLAIM: "<exact claim>"
    SOURCE: <file path / URL / query that verified it>
    STATUS: VERIFIED | UNVERIFIED | CONTRADICTED
    NOTES: <correction if contradicted>
```

### 3. Rewrite the Draft

- **VERIFIED** → keep as-is, optionally add citation
- **UNVERIFIED** → either remove the claim, soften to a question, or prefix with `[unverified]`
- **CONTRADICTED** → replace with the verified value and note the correction

### 4. Append a Citations Section

End the document with:

```
## Citations & Confidence

| Claim | Source | Status |
|-------|--------|--------|
| ...   | ...    | ✓      |
```

## Output Contract

The skill must return:

1. The corrected draft (claims either verified, marked, or removed)
2. A claims log (extracted claims + verification status)
3. A confidence summary: `X verified, Y unverified, Z contradicted`

**Hard rule**: Never produce final output containing an unverified factual claim that isn't explicitly marked `[unverified]`. If you cannot verify and cannot mark, escalate to the user instead of guessing.

## Examples

### Good

> "The project runs **6** CI workers [verified: .github/workflows/ci.yml lines 12-17]."

### Bad (would be caught)

> "The project runs 9 CI workers." → fails: actual count is 6 per .github/workflows/ci.yml

### Acceptable when verification fails

> "The project runs **[unverified — could not access .github/workflows/ci.yml from this session]** CI workers."

## Anti-Patterns to Reject

- "Approximately N" when the exact value is grep-able
- "Industry standard is X" without a cited source
- Round numbers that suggest estimation in domains where exact counts exist
- Quotes from memory rather than from the original source
- Drift mid-research: revising the thesis without stopping to confirm with the user
