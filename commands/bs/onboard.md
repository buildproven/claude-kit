---
name: bs:onboard
description: 'Interactive onboarding for new users of /bs:* commands'
argument-hint: '[--quick|--full]'
category: maintenance
model: haiku
---

# /bs:onboard - Interactive Onboarding

**Purpose**: Guide new users through the /bs:\* command system with hands-on examples.

## Usage

```bash
/bs:onboard           # Interactive guided tour (default)
/bs:onboard --quick   # 5-minute overview
/bs:onboard --full    # Complete walkthrough with exercises
```

---

## Quick Mode (--quick)

**5-minute overview of essential commands**

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

**Complete interactive walkthrough**

### Step 1: Understand the Philosophy

```markdown
## Philosophy: Autonomous Loops

Traditional workflow:
fix → test → fail → fix → test → fail → fix → test → pass
(You manually iterate 5-10 times)

Our workflow:
/bs:quality → (autonomous agent loops until ALL checks pass)
(You walk away, come back to passing code)

**Key insight**: Commands don't just RUN checks, they FIX issues autonomously.
```

### Step 2: The Core Loop

```markdown
## The Development Loop

Every feature follows this pattern:

┌─────────────────────────────────────────────────┐
│ 1. /bs:dev feature-name │
│ ↓ (analyzes complexity, creates plan) │
│ │
│ 2. Implement (code, tests, docs) │
│ ↓ │
│ │
│ 3. /bs:quality --merge │
│ ↓ (loops until 95% quality) │
│ │
│ 4. /clear (fresh context for next feature) │
└─────────────────────────────────────────────────┘

**Why this works:**

- `/bs:dev` ensures you plan before coding
- `/bs:quality` ensures you ship quality code
- `/clear` prevents context bloat (500+ message sessions)
```

### Step 3: Quality Levels

````markdown
## Quality Levels: 95 vs 98

**Level 95 (Default)** - For regular features

- Tests pass
- TypeScript compiles
- ESLint clean
- No silent failures
- ~30-60 minutes

**Level 98 (Launch)** - For production releases

- Everything in 95, plus:
- Security audit
- Accessibility check
- Performance (Lighthouse >90)
- Architecture review
- ~1-3 hours

**Usage:**

```bash
/bs:quality                    # Level 95 (default)
/bs:quality --level 98         # Launch quality
/bs:quality --scope changed    # Only changed files (fastest)
```
````

````

### Step 4: Session Management

```markdown
## Managing Long Work

**Problem**: Multi-day features lose context

**Solution**: Checkpoints and sessions

```bash
# Save your current state (quick save for short breaks)
/bs:session save --quick

# Later, restore it
/bs:session load --quick

# Or use full session management
/bs:session save "auth-feature-day-1"
/bs:session list
/bs:session resume auth-feature-day-1
````

**Rule of thumb:**

- Single session: < 4 hours of work
- Multi-session: Use checkpoints between days
- Context bloat: Use `/clear` after each merged PR

````

### Step 5: Hands-On Exercise

```markdown
## Exercise: Your First Feature

Let's practice with a real (tiny) feature:

**Step 1**: Start the feature
```bash
/bs:dev add-console-log-to-readme
````

**Step 2**: Make the change

- Open README.md
- Add a note about the /bs:onboard command

**Step 3**: Run quality checks

```bash
/bs:quality --scope changed
```

**Step 4**: See the result

- Quality agent will check your changes
- If issues found, it will fix them
- Loops until passing

**Congratulations!** You've completed the workflow.

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
````

### Step 7: Next Steps

````markdown
## You're Ready!

**Start your first real feature:**

```bash
/bs:dev your-feature-name
```
````

**If you get stuck:**

- `/bs:help` - Quick reference
- `/bs:workflow` - Detailed workflow guide
- Check CLAUDE.md for project-specific notes

**Pro tips:**

1. Use `--scope changed` for fast iteration
2. Use `/clear` between features
3. Let `/bs:quality` fix issues (don't manually iterate)
4. Save checkpoints before long breaks

Happy coding! 🚀

````

---

## Implementation Notes

- **Interactive**: Pause between steps, let user absorb
- **Practical**: Include real exercises, not just theory
- **Progressive**: Quick mode for impatient users, full mode for thorough learning
- **Memorable**: Use the core loop diagram repeatedly

---

## Health Check Integration

After onboarding, suggest running:

```bash
/bs:maintain
````

This verifies the setup is healthy and all commands are working.
