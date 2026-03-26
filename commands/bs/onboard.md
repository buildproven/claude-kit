---
name: bs:onboard
description: 'Interactive onboarding for new users of /bs:* commands'
argument-hint: '[--quick|--full]'
category: maintenance
model: haiku
---

# /bs:onboard - Interactive Onboarding

```bash
/bs:onboard           # Interactive guided tour (default)
/bs:onboard --quick   # 5-minute overview
/bs:onboard --full    # Complete walkthrough with exercises
```

---

## Quick Mode (--quick)

### Welcome Message

```markdown
👋 Welcome to claude-setup!

This toolkit automates your development workflow with 28 /bs:\* commands.

**The 5 commands you'll use daily:**

1. `/bs:dev` - Start any coding task with smart planning
2. `/bs:quality` - Autonomous quality checks (runs until all pass)
3. `/bs:test` - Run tests (watch mode, coverage, specific files)
4. `/bs:help` - Quick reference for all commands
5. `/bs:session --quick` - Save/restore work context

**The workflow:**
```

/bs:dev feature-name → (code) → /bs:quality --merge → /clear

```

**Next steps:**
- Run `/bs:help` to see all commands
- Run `/bs:onboard --full` for the complete tour
- Start coding with `/bs:dev your-first-feature`
```

---

## Full Mode (--full)

### Step 1: Philosophy

```markdown
## Philosophy: Autonomous Loops

Traditional: fix → test → fail → fix → test → fail → fix → test → pass (manual, 5-10 iterations)
Our workflow: /bs:quality → (autonomous agent loops until ALL checks pass, you walk away)
```

### Step 2: The Core Loop

```markdown
## The Development Loop

1. /bs:dev feature-name → analyzes complexity, creates plan
2. Implement (code, tests, docs)
3. /bs:quality --merge → loops until 95% quality
4. /clear → fresh context for next feature
```

### Step 3: Quality Levels

See `docs/ralph-patterns.md` Quality Level Mapping — that is the single source of truth.

```bash
/bs:quality                    # Level 95 (default)
/bs:quality --level 98         # Launch quality
/bs:quality --scope changed    # Only changed files (fastest)
```

````

### Step 4: Session Management

```markdown
## Managing Long Work

```bash
/bs:session save --quick          # Quick save for short breaks
/bs:session load --quick          # Restore
/bs:session save "auth-day-1"     # Named session
/bs:session resume auth-day-1     # Resume by name
````

Rule: single session < 4 hours. Use `/clear` after each merged PR.

````

### Step 5: Hands-On Exercise

```markdown
## Exercise: Your First Feature

1. /bs:dev add-note-to-readme
2. Edit README.md — add a note about /bs:onboard
3. /bs:quality --scope changed   → quality agent loops until passing
````

### Step 6: Command Reference

```markdown
## Essential Commands Cheat Sheet

**Development:**

- `/bs:dev [name]` - Start feature with planning
- `/bs:test` - Run tests
- `/bs:quality` - Autonomous quality loop

**Git & Deploy:**

- `/bs:git-sync` - Commit + push + deploy
- `/commit-commands:commit-push-pr` - Create PR

**Maintenance:**

- `/bs:maintain` - Health checks
- `/bs:deps` - Dependency updates
- `/bs:cleanup` - Clear caches

**Helpers:**

- `/bs:help` - Command reference
- `/bs:workflow` - Daily workflow guide
- `/bs:session --quick` - Save/restore context

**Run `/bs:help` anytime for the full list.**
```

### Step 7: Next Steps

```markdown
/bs:dev your-feature-name # Start first real feature
/bs:help # Quick reference
/bs:workflow # Detailed workflow guide

Pro tips: use --scope changed for fast iteration, /clear between features, let /bs:quality fix issues.
```
