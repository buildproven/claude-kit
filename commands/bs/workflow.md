---
name: bs:workflow
description: Quick reference for daily feature development workflow
argument-hint: '→ daily dev workflow reference'
tags: [workflow, getting-started, guide]
category: development
model: haiku
---

# Daily Development Workflow

**Quick reference for your feature development flow**

## ⚡ Quick Start (< 5 min)

**Never used these commands? Start here:**

```bash
# 1. First time? Run onboarding
/bs:onboard --quick                  # 5-min overview

# 2. Ship your first feature (most common workflow)
/bs:dev my-feature                   # Start work (creates branch)
# ... code your feature ...
/bs:quality --merge                  # Ship it (30-60 min autonomous)
# ✅ Returns: Tests passing → PR merged → deployed → released

# 3. Start next feature
/clear                               # Wipe conversation, start fresh
/bs:dev next-feature

# That's it! You're using the system.
```

**Quick wins:**

- `/bs:dev --next` - Auto-pick highest-priority backlog item
- `/bs:quality --audit` - Quick project health check (1-2 min)
- `/bs:ralph-dev` - Work through 10 backlog items autonomously (walk away, come back to 10 PRs)
- `/bs:ralph-next` - Graph loop with reflect/decide routing and evidence logs
- `/bs:help` - See all commands

**Quick reference:**

- 📄 [Cheat Sheet](~/Projects/claude-setup/docs/WORKFLOW-CHEATSHEET.md) - One-page printable reference

**Core principle:** Autonomous loops. Commands run until ALL checks pass. You don't manually iterate—agents do.

---

## Solo Dev (Default - Fast Iteration)

```bash
# 1. Start work
/bs:dev my-feature
# Fast iteration, no test overhead (tests auto-generated in step 3)

# 2. Code
# ... make changes ...

# 3. Ship it (one command, fully automated)
/bs:quality --merge
# ☕ Go get coffee (30-60 min)
# ✅ Auto-generates missing tests
# ✅ Returns: PR created → merged → deployed → released

# 4. Next feature (start fresh)
/clear
/bs:dev next-thing
```

**Time:** 30-60 min autonomous
**Result:** Live in production

---

## Team Collaboration (PR Review)

```bash
# 1. Start work
/bs:dev my-feature

# 2. Code
# ... make changes ...

# 3. Create PR for review
/bs:quality
# ✅ Returns: PR created, ready for team review

# 4. After team approves & merges
/bs:git-sync
# ✅ Auto-switches to main, pulls merged code, deploys, releases

# 5. Next feature (start fresh)
/clear
/bs:dev next-thing
```

**Time:** 30-60 min autonomous + manual review
**Result:** Team reviewed, then live

---

## Production Launches (Critical Features)

```bash
# 1. Start work
/bs:dev critical-feature

# 2. Code
# ... make changes ...

# 3. Production-perfect quality
/bs:quality --level 98 --merge
# ☕ Go do something else (1-3 hours)
# ✅ Returns: All checks passed → PR → merged → deployed → released

# 4. Next feature (start fresh)
/clear
/bs:dev next-thing
```

**Time:** 1-3 hours autonomous
**Result:** Bulletproof, live in production

---

## Production Emergencies (Hotfix)

```bash
# Production is DOWN - need fix in 5 minutes
/bs:hotfix payment-processor-timeout

# What's broken? "Stripe API timing out"
# Which files? "src/lib/stripe.ts - increase timeout"

# ... implement fix (2 min) ...
# ... minimal quality checks (7 min) ...
# ✅ Deployed in 9 minutes
# ✅ Verified automatically
# ✅ Production restored

# Within 24 hours - clean up technical debt
/bs:quality --level 98 --scope all
```

**Time:** 5-10 min (vs 30-60 min normal)
**Quality:** Minimal (tests, lint, build only)
**Result:** Production fixed, follow-up cleanup required

---

## Git Flow (Branch → PR → Deploy)

**Understanding what each command does:**

```bash
/bs:dev feature-name
# → Creates branch: feature/feature-name
# → Assesses complexity and plans
# → You code here

/bs:quality
# → Commits all changes
# → Creates PR
# → Stops (ready for team review)

/bs:quality --merge
# → Commits all changes
# → Creates PR
# → Auto-merges PR
# → Deploys to production
```

**Visual Flow:**

```
main
  └─ /bs:dev → feature/feature-name (new branch)
                    ↓
                  (you code)
                    ↓
            /bs:quality → PR created
                    ↓
          (if --merge: auto-merge)
                    ↓
            back to main → deploy
```

---

## Rapid Development (Quick Iterations)

**Check before each commit (2-5 min):**

```bash
# After coding a small chunk
/bs:quality --scope changed
# → Checks only uncommitted files (2-5 min)
# → Auto-commits: "feat(dark-mode): add toggle component"

# Code next chunk
/bs:quality --scope changed
# → Checks (2-5 min)
# → Auto-commits: "feat(dark-mode): update theme configuration"

# Feature complete - full check
/bs:quality --merge
# → Checks all branch changes (30-60 min)
# → Creates PR, merges, ships to production
```

**No manual git commands needed!** Commit messages are generated from:

- Branch name (feature/dark-mode → scope: "dark-mode")
- File changes (analyzes diff to determine action)

**Scope Options:**

- `--scope changed` → Uncommitted files only (2-5 min)
- Default (no flag) → All branch changes vs main (30-60 min)
- `--scope all` → Entire project (45-90 min, for major refactors)

**Time Savings:** 40% faster with incremental `--scope changed` checks

---

## Newsletter & Social Media

**Article creation is handled by your newsletter tool.** Claude Code handles posting and image generation.

```bash
# Post to social media
/bs:post "Just shipped a new feature!"
# → Optimizes for each platform
# → Posts to all platforms

# Auto-post from newsletter library
/bs:post --newsletter yourbrand

# Preview before posting
/bs:post --newsletter yourbrand --dry-run
```

**Image Generation:**

```bash
# Featured image for Beehiiv (1200x630)
/bs:image newsletters/2026/01/my-post.md --preset beehiiv

# Twitter card (1200x628)
/bs:image newsletters/2026/01/my-post.md --preset twitter

# LinkedIn carousel
/bs:image newsletters/2026/01/my-post.md --preset carousel
```

**Cost:** ~$0.05/image (Gemini), ~$0.08/image (OpenAI)

---

## Command Quick Reference

### Core Workflow

| Command                          | Time      | Quality   | Auto-Deploy | Use For                      |
| -------------------------------- | --------- | --------- | ----------- | ---------------------------- |
| `/bs:dev <name>`                 | Variable  | N/A       | ❌ No       | Start any dev work           |
| `/bs:dev --next`                 | Variable  | N/A       | ❌ No       | Auto-pick from backlog       |
| `/bs:quality --merge`            | 30-60 min | 95%       | ✅ Yes      | Daily shipping (solo)        |
| `/bs:quality`                    | 30-60 min | 95%       | ❌ PR only  | Team review                  |
| `/bs:quality --level 98 --merge` | 1-3 hours | 98%       | ✅ Yes      | Production launches (solo)   |
| `/bs:quality --level 98`         | 1-3 hours | 98%       | ❌ PR only  | Production + team review     |
| `/bs:ralph-dev`                  | 1-5 hours | auto      | ✅ Yes      | Autonomous multi-item work   |
| `/bs:ralph-next`                 | 1-5 hours | auto+eval | ✅ Yes      | Graph-routed multi-item work |

### Quick Checks & Audits

| Command                       | Time     | Quality | Auto-Deploy   | Use For                  |
| ----------------------------- | -------- | ------- | ------------- | ------------------------ |
| `/bs:quality --audit`         | 1-2 min  | N/A     | ❌ No         | Read-only score + report |
| `/bs:quality --audit --deep`  | 5-15 min | N/A     | ❌ No         | Deep review → backlog    |
| `/bs:quality --scope changed` | 2-5 min  | 95%     | ❌ No         | Quick commit checks      |
| `/bs:verify`                  | 1-3 min  | N/A     | ❌ Check only | Post-deploy smoke tests  |

### Emergency & Maintenance

| Command       | Time     | Quality | Auto-Deploy | Use For                 |
| ------------- | -------- | ------- | ----------- | ----------------------- |
| `/bs:hotfix`  | 5-10 min | Minimal | ✅ Yes      | Production emergencies  |
| `/bs:deps`    | 2-5 min  | N/A     | ❌ No       | Dependency health check |
| `/bs:cleanup` | 1-2 min  | N/A     | ❌ No       | Clean temp files/caches |
| `/bs:sync`    | < 1 min  | N/A     | ❌ No       | Verify config symlinks  |

### Agent & Session Management

| Command                       | Time     | Quality | Auto-Deploy | Use For                   |
| ----------------------------- | -------- | ------- | ----------- | ------------------------- |
| `/bs:agent-new <name>`        | 2-5 min  | N/A     | ❌ No       | Create custom agent       |
| `/bs:agent-run <name> "task"` | Variable | N/A     | ❌ No       | Run custom/built-in agent |
| `/bs:session save <id>`       | < 1 min  | N/A     | ❌ No       | Save context checkpoint   |
| `/bs:resume [id]`             | < 1 min  | N/A     | ❌ No       | Resume saved session      |

---

## What Gets Checked

### /bs:quality (95% - Ship Ready — 6 agents)

- ✅ Tests: Auto-generated for untested code + test:changed passing (CI runs full suite)
- ✅ Test quality: Validated for meaningful coverage (not trivial)
- ✅ ESLint: Clean
- ✅ TypeScript: No `any`, strict mode
- ✅ Build: Successful
- ✅ No silent failures
- ✅ Type safety: Good
- ✅ Security basics: No secrets, no critical OWASP issues, dependency audit

### /bs:quality --level 98 (98% - Production Perfect — 10 agents)

**Everything in /bs:quality PLUS:**

- ✅ Accessibility: WCAG AA
- ✅ Performance: Lighthouse >90
- ✅ Architecture reviewed
- ✅ Code simplified (no unnecessary complexity)

---

## Key Principles

1. **Autonomous loops** - Commands run until ALL checks pass, you don't do manual iteration
2. **Break at PRs** - New conversation for each feature (avoid 500-message marathons)
3. **Trust the agents** - Go get coffee, review when done
4. **Use --merge for solo** - One command, fully automated
5. **Skip --merge for teams** - PR review workflow

---

## Model Routing (Cost Optimization)

**Commands are pre-configured to use the right model tier. No manual switching needed.**

| Tier       | Count | Use Case                                  | Examples                                                                                   |
| ---------- | ----- | ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Haiku**  | 17    | Display, search, read-only, status        | help, workflow, cost, dashboard, status, patterns                                          |
| **Sonnet** | 19    | Code work, quality, refactoring, agents   | dev, quality, ralph-dev, ralph-next, agent-run, read, test, deps, hotfix, verify, refactor |
| **Opus**   | 5     | Architecture, creative, complex reasoning | strategy, new, agent-new, debug, image                                                     |

**When to override:**

- Complex debugging that Sonnet struggles with: manually switch to Opus
- Architecture decisions during `/bs:dev`: the command uses Sonnet, but you're using Opus in the main conversation
- `/bs:quality --level 98`: uses Sonnet for mechanical checks (sufficient for lint/test/build)

**Target:** <3,000 Opus calls/week (down from 10,000+). Sonnet/Haiku handle >80% of command invocations.

---

## Conversation Management (CLI)

**After shipping a feature:**

**Option A: `/clear` (easiest in CLI)**

- Wipes current session, start fresh immediately
- No need to quit Claude
- Same window, clean slate

**Option B: Quit and restart Claude**

- Close terminal and restart: `claude`
- New terminal tab and start: `claude`
- Fully new session

**Practical:** Use `/clear` after `/bs:quality --merge` completes. It's faster than quitting/restarting.

---

**Mid-feature cleanup:**

**`/compact` - When conversation is bloated but work not done**

- Use after heavy exploration (searched 20 files, found what you need)
- Use after debugging (fixed issue, drop debug logs)
- Drops: exploration results, failed attempts, debug output
- Keeps: recent code changes, key decisions, next steps

**When to use:**

- ✅ Mid-feature, explored heavily → `/compact` then continue
- ✅ Approaching 100+ messages, not done → `/compact` to trim
- ❌ Feature shipped → Use `/clear` instead
- ❌ Only 30-40 messages → No need, plenty of room

---

**Let it auto-compact:**

- Happens automatically at ~150-200 messages
- Not ideal but fine if you hit it
- Better to break at PR boundaries (you're doing this right at 110 msgs/session)

---

**Recommended pattern (with context management):**

```bash
/bs:dev feature-name
# ... explore + code 30-60 min ...
# /compact runs at milestones (after commits, after exploration, before quality)

/bs:quality --merge
# /compact runs before agents spawn (Step 1.7)
# Quality agents have full context headroom
# ✅ Shipped

/clear  # ← Start fresh for next feature
/bs:dev next-feature
```

**For `/bs:ralph-dev` (multi-item batches):**

```bash
/bs:ralph-dev --until "3 items"
# Each item runs in fresh Task agent context (default --fresh)
# No context blowout across items
# Use --no-fresh to share context (with /compact between items)
```

**For `/bs:ralph-next` (graph mode):**

```bash
/bs:ralph-next --until "3 items"
# Same autonomous batch behavior, but each item runs REFLECT -> DECIDE routing
# Evidence files written to .claude/ralph-next/
```

**When to use `/compact` vs `/clear`:**

| Situation                      | Use        | Why                                      |
| ------------------------------ | ---------- | ---------------------------------------- |
| Mid-feature, explored heavily  | `/compact` | Drop exploration, keep code changes      |
| After a commit during dev      | `/compact` | Code saved to git, free up context       |
| Before `/bs:quality` agents    | `/compact` | Give agents room (automatic in Step 1.7) |
| Feature shipped, starting next | `/clear`   | Full reset, no stale context             |
| Switching projects             | `/clear`   | Different codebase entirely              |

---

## Troubleshooting

**Stuck on a bug? Use systematic debugging:**

```bash
/debug
# → Create hypotheses
# → Read ALL related code
# → Add strategic logging
# → Rule of Three: if same approach fails 3x, change something
# → Multi-model: /bs:strategy --mode debate "problem description"
```

**Command stops before fixing all issues:**

- Say: "Keep looping until ALL exit criteria pass. Do not stop."

**Session timeout (>3 hours):**

- Project is too messy
- Run `/bs:quality` first to get to 95%
- Then run `/bs:quality --level 98` for final 3%

**Deploy succeeded but production is broken:**

- Run `/bs:verify` to check health and auto-rollback if needed
- Set up .verifyrc.json with critical endpoints
- Add health endpoints to your API

**Production emergency:**

- Use `/bs:hotfix` for 5-10 min fast-track (vs 30-60 min normal)
- Minimal quality checks only (tests, lint, build)
- Auto-verifies and deploys immediately
- Run full `/bs:quality --level 98 --scope all` within 24 hours

**Want to see what would happen:**

- Add `--dry-run` flag to preview without executing

**Code getting messy? Refactor session:**

```bash
/refactor
# → Run jscpd (find duplicates)
# → Run knip (find dead code)
# → Run code-simplifier plugin
# → Commit cleanup
```

**Update CLAUDE.md with learnings:**

```bash
/update-claudemd
# → Capture non-obvious patterns from this session
# → Only stable, useful info (not temporary fixes)
```

**Need help:**

- `/bs:help` - All commands
- `/bs:help --full` - Full reference with flags
- `/bs:workflow` - This guide
- `/debug` - Systematic debugging when stuck
- `/bs:strategy --mode debate` - Multi-model advisory panel

---

## Examples

**Scenario 1: Quick bug fix (solo)**

```bash
/bs:dev fix-login-bug
# Fix bug
/bs:quality --merge
# ☕ 30 min later: Bug fixed, tested, deployed ✅
```

**Scenario 2: New feature (team)**

```bash
/bs:dev dark-mode
# Implement dark mode
/bs:quality
# ✅ PR created, team reviews
# After team merges:
/bs:git-sync
# ✅ Auto-switches to main, pulls, deploys
```

**Scenario 3: Production launch**

```bash
/bs:dev payments
# Implement Stripe payments
/bs:quality --level 98 --merge
# ☕ 2 hours later: Security audited, accessible, performant, deployed ✅
```

---

---

## Session Management (New - From Agent-Native Research)

### Multi-Day Features

```bash
# Day 1: Start feature
/bs:dev complex-feature
# ... work for 2 hours ...
/bs:session save complex-feature
# End day

# Day 2: Resume
/bs:resume complex-feature
# Continue where you left off
# ... work ...
/bs:quality --merge
```

### Parallel Development

```bash
# Multiple independent features
/bs:dev --parallel --tasks "login page,header fix,API docs"

# Agents work autonomously (2-3 hours):
#   - Create branches (feature/login-page, fix/header-fix, docs/api-docs)
#   - Implement features
#   - Run quality loops
#   - Create PRs

# You get: 3 PRs ready for review
# Total time: ~2.5 hours (vs 5-6 hours sequential)
```

### Quick Breaks

```bash
# Before lunch
/bs:session save --quick

# After lunch
/bs:resume
# Continue immediately
```

### Interrupted Work

```bash
# Working on feature
# ... system crash ...

# When back
/bs:resume
# Auto-loads last checkpoint or session
```

### Parallel Features

```bash
# Feature A
/bs:dev feature-a
# ... work ...
/bs:session save feature-a

# Urgent bug
/bs:dev fix-urgent
# ... fix ...
/bs:quality --merge

# Back to Feature A
/bs:resume feature-a
# Continue where you left off
```

### Benefits of Session Management

**From agent-native research:**

- ✅ Checkpoint/resume for reliable automation
- ✅ File-first architecture for inspectability
- ✅ Context preserved across interruptions
- ✅ Multi-day workflows without context loss
- ✅ Parallel work on multiple features

**Commands:**

- `/bs:session` - Full session management (multi-day)
- `/bs:session --quick` - Quick context save (< 24h)
- `/bs:resume` - Auto-detect and resume
- `/bs:agent-new` - Create specialized agents
- `/bs:agent-run` - Run agents with sessions

### Using Custom Agents in Workflow

**Create specialized agents for recurring tasks:**

```bash
# 1. Create agent once
/bs:agent-new security-scanner --type security
/bs:agent-new api-tester --type testing
/bs:agent-new doc-writer --type documentation

# 2. Use during development
/bs:dev payment-integration
# ... implement feature ...

# Run security scan mid-feature
/bs:agent-run security-scanner "Scan payment integration"
# Fix any issues found

# Generate API docs
/bs:agent-run doc-writer "Document payment API endpoints"

# Continue to quality
/bs:quality --merge
```

**Agent workflow patterns:**

```bash
# Pattern 1: Security-first development
/bs:dev feature-name
/bs:agent-run security-scanner "Scan changes" --session feature-security
# ... fix issues ...
/bs:quality --merge

# Pattern 2: Test-driven with agent
/bs:dev api-endpoint
/bs:agent-run api-tester "Generate integration tests" --session endpoint-tests
# ... implement endpoint ...
/bs:agent-run api-tester --session endpoint-tests --resume  # Continue testing
/bs:quality --merge

# Pattern 3: Documentation-as-you-go
/bs:dev complex-algorithm
# ... implement ...
/bs:agent-run doc-writer "Explain algorithm with examples"
/bs:quality --merge
```

**Benefits:**

- Consistent quality checks (same agent, same standards)
- Session continuity (agents remember context)
- Specialized expertise (security, testing, docs)
- Parallel execution (run multiple agents simultaneously)

---

## Autonomous Backlog Iteration

**Let Claude work through your backlog without intervention:**

```bash
# Graph mode (recommended for richer routing + evidence)
/bs:ralph-next
/bs:ralph-next --until "3 items"
/bs:ralph-next --score-threshold 0.75
/bs:ralph-next --speculate never

# Complete 10 items (default) - NO INTERVENTION NEEDED
/bs:ralph-dev

# Complete 3 items
/bs:ralph-dev --until "3 items"

# Work for 2 hours
/bs:ralph-dev --until "2 hours"

# Complete until MVP checkpoint
/bs:ralph-dev --until "checkpoint:mvp"

# Only bugs (fast wins)
/bs:ralph-dev --scope bug

# Only small items
/bs:ralph-dev --scope effort:S

# Fresh context per item (isolation)
/bs:ralph-dev --fresh

# Preview what would happen
/bs:ralph-dev --dry-run
```

**How it works (Ralph-style loop):**

1. Parses BACKLOG.md → syncs to `.claude/ralph-dev-state.json`
2. Picks highest-scoring item (passes: false, not blocked)
3. Creates branch → implements → `/bs:quality --merge --level auto` **autonomously**
4. If local quality fails → retries with targeted fixes (up to `--max-retries`, default 3)
5. PR created → CI runs
6. **CI Failure Recovery** (up to `--max-ci-retries`, default 2):
   - Auto-fixable (lint/types/imports) → fix → push → CI re-runs
   - Complex (tests/docs) → create backlog item → merge with "known-issue" label
7. PR merged → back on main → captures learnings → `.claude/session-learnings.md`
8. Marks item complete (passes: true) or blocked (after max retries)
9. **Loops back to step 2** until stop condition
10. **End of run:** Auto-promotes learnings to CLAUDE.md (no prompt)

**Multiple items without intervention:**
Just run `/bs:ralph-dev` and walk away. It loops autonomously:

- Default: 10 items
- Or set: `--until "20 items"`, `--until "4 hours"`, `--until empty`
- CI failures handled automatically (no manual intervention needed)

**Learning capture:**

- Session learnings cleared each run (temporary)
- Significant patterns promoted to CLAUDE.md (permanent)
- State file tracks passes:true/false per item

**Safety:** 5-hour limit, retry loop per item (blocked after max retries), CI recovery loop, `/compact` or `--fresh` between items

**Ralph-next difference:** swaps blind retries for state routing (`PICK -> IMPLEMENT -> QUALITY -> REFLECT -> DECIDE`) with failure-class budgets and per-item evidence logs.

---

## Project & Maintenance Commands

**Project management:**

```bash
/bs:new my-project             # Scaffold new project with quality infra
/bs:backlog                    # View/manage backlog (value-based prioritization)
/bs:test                       # Run tests (watch, coverage, specific files)
/bs:test --watch               # Watch mode
/bs:test --coverage            # Coverage report
/bs:deps                       # Dependency health: outdated, security audit, upgrades
```

**Setup & maintenance:**

```bash
/bs:onboard                    # Interactive onboarding for new users
/bs:sync                       # Check/repair Claude config symlinks
/bs:sync-ai                    # Sync commands to other AI CLIs (Codex, Gemini)
/bs:cleanup                    # Clean caches, temp files, zombie processes
/bs:maintain                   # Self-maintaining: health checks, auto-fixes
```

---

**TL;DR:** `/bs:dev` → Code → `/bs:quality --merge` → Coffee → Deployed → Next

---

## Quick Status & Orientation

**Check project status after time away:**

```bash
/bs:status
# → Recent commits (7 days)
# → Open PRs
# → CI status
# → Outdated dependencies
# → Suggested next steps
```

**Search accumulated knowledge:**

```bash
/bs:patterns "authentication"
# → Searches global + project CLAUDE.md
# → Shows matching sections with context
# → Prevents re-solving solved problems
```

**Check if ready to merge:**

```bash
/bs:quality --preflight
# → Fast checks (<10 sec)
# → Uncommitted changes? Tests? Lint? Build? Secrets?
# → Returns "Ready" or lists blockers
```

**View quality trends:**

```bash
/bs:quality --status --verbose
# → ASCII charts: coverage, issues, duration
# → Quality level distribution (95% vs 98%)
# → Alerts for degradation
```

**Track API costs:**

```bash
/bs:cost
# → Cost per feature/branch
# → Monthly spend forecast
# → Most expensive operations
```
