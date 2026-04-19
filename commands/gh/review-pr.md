---
description: "Deep PR code review: multi-agent local analysis with inline GH comments"
name: gh:review-pr
category: github
argument-hint: "/gh:review-pr 456 → fetches PR #456, runs 6 specialized review agents locally, posts findings as inline comments"
allowed-tools: Write, Read, LS, Glob, Grep, Bash(gh:*), Bash(git:*)
model: opus
---

# Review PR — Local Multi-Agent Review

You are a code review orchestrator. You run a comprehensive local review and post findings as inline GitHub comments. This saves CI minutes by doing all AI review locally.

## Step 1: Get PR Context

```bash
# If no PR number provided, show open PRs
gh pr list

# With PR number:
gh pr view $ARGUMENTS
gh pr diff $ARGUMENTS
```

## Step 2: Run Multi-Agent Review

Launch these review agents **in parallel** using the Agent tool. Pass the actual diff content to each agent — do NOT let them re-fetch it.

| Agent                 | subagent_type                             | Focus                                             |
| --------------------- | ----------------------------------------- | ------------------------------------------------- |
| code-reviewer         | `pr-review-toolkit:code-reviewer`         | Bugs, logic errors, code quality                  |
| silent-failure-hunter | `pr-review-toolkit:silent-failure-hunter` | Empty catches, swallowed errors, silent fallbacks |
| pr-test-analyzer      | `pr-review-toolkit:pr-test-analyzer`      | Test coverage gaps, missing edge cases            |
| type-design-analyzer  | `pr-review-toolkit:type-design-analyzer`  | Type safety, weak generics, `any` abuse           |
| comment-analyzer      | `pr-review-toolkit:comment-analyzer`      | Stale/misleading comments                         |
| code-simplifier       | `pr-review-toolkit:code-simplifier`       | Unnecessary complexity                            |

For each agent, include in the prompt:

- The PR description
- The full diff
- The project's CLAUDE.md conventions
- Instruction to return findings as `{file, line, severity, message, suggestion}` objects

## Step 3: Synthesize & Post

1. Collect all agent findings
2. Deduplicate (same file:line from multiple agents)
3. Sort by severity: BLOCKING > WARNING > NITPICK
4. **Post BLOCKING and WARNING findings as inline PR comments:**

```bash
# Get commit SHA
COMMIT_SHA=$(gh api repos/OWNER/REPO/pulls/PR_NUMBER --jq '.head.sha')

# Post inline comment
gh api repos/OWNER/REPO/pulls/PR_NUMBER/comments \
    --method POST \
    --field body="**[severity]** message\n\nSuggestion: ..." \
    --field commit_id="$COMMIT_SHA" \
    --field path="path/to/file" \
    --field line=lineNumber \
    --field side="RIGHT"
```

5. Post a summary comment with verdict:

```bash
gh pr comment $PR_NUMBER --body "## Local Code Review — 6 Agents

**Verdict: PASS/FAIL**

| Agent | Findings |
|-------|----------|
| ... | ... |

_Reviewed locally with Claude Code — no CI minutes used._"
```

## Rules

- ONLY post findings, not summaries of what the PR does
- Every finding must have a file:line reference
- Suggestions must be specific code, not generic advice
- If all agents return clean: post a single "PASS — no issues found across 6 agents" comment
