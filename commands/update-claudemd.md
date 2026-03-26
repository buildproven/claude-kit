---
name: update-claudemd
description: Update CLAUDE.md with recent session learnings and discoveries
tags: [docs, config, claudemd]
category: utility
model: sonnet
---

# Update CLAUDE.md

You are updating the project's CLAUDE.md file with recent learnings and discoveries.

## Step 1: Gather Context

Review recent activity:

```bash
git diff HEAD~5 --stat
git log --oneline -10
```

Consider what you've learned in this session:

- New patterns or conventions established
- Architecture decisions made
- Commands or workflows discovered
- Non-obvious behaviors documented

## Step 2: Read Current CLAUDE.md

Read the existing file to understand current structure and content.

## Step 3: Identify Updates

Only add information that is:

- **Genuinely useful** for future sessions
- **Non-obvious** - don't document things Claude would figure out anyway
- **Stable** - not temporary workarounds or one-off fixes
- **Actionable** - helps Claude make better decisions

Do NOT add:

- Obvious project structure (Claude can read files)
- Standard conventions (follow existing patterns)
- Temporary debugging notes
- Verbose explanations of basic concepts

## Step 4: Update the File

Keep CLAUDE.md under 300 lines. Be concise.

Structure:

1. **Project summary** (1-2 sentences)
2. **Key commands** (only non-obvious ones)
3. **Architecture notes** (only unusual patterns)
4. **Conventions** (only project-specific deviations)
5. **Known issues** (active blockers only)

## Step 5: Commit

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with recent learnings"
```

## Guidelines

- Less is more - Claude reads the whole codebase anyway
- Focus on "what would confuse me next time?"
- Remove outdated information when adding new
- This is a living document, not comprehensive documentation
