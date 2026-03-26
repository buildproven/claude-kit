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
- `/bs:ralph` - Work through backlog items autonomously (graph loop with reflect/decide routing)
- `/bs:help` - See all commands

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

---

## What Runs Automatically (You Don't Touch These)

**On every push (local git hooks):**

- Format check, ESLint, pattern analysis, security scan (Semgrep/pattern fallback), gitleaks secret scan, doc staleness

**On every file edit (Claude Code hooks):**

- Post-edit lint, session health monitoring

**On every Claude response (Claude Code hooks):**

- Output validation (no console.log, TODO, `any`, debugger left in)

**On every PR (GitHub Actions — minimal minutes):**

- Harness Gate: risk-tiered CI (lint-only for docs, full checks for critical files)

**Weekly (GitHub Actions):**

- Stale branch cleanup (Mondays: warns 7d, deletes 14d if no PR)
- Submodule update check (Mondays)
- SOTA assessment scorecard (Sundays)

**On every session start (Claude Code hooks):**

- Context injection, multi-session guard, macOS notification when idle

**Code review runs locally via `/bs:quality` (6 agents, full codebase context).** No external review service — your $200/mo CC subscription covers everything.

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
                    ↓ ← post-edit lint runs automatically (CC hook)
            /bs:quality → 6 agents review locally → PR created
                    ↓ ← pre-push: format, lint, semgrep, gitleaks (git hook)
          GitHub CI: Harness Gate (risk-tiered, minimal minutes)
                    ↓
          (if --merge: auto-merge after CI passes)
                    ↓
            back to main → deploy
```

> **Harness:** every PR to main runs `scripts/risk-policy-gate.js` to classify changed files by risk tier (critical/high/medium/low) and run the appropriate checks. See `docs/harness-engineering.md`.

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

**Scope Options:**

- `--scope changed` → Uncommitted files only (2-5 min)
- Default (no flag) → All branch changes vs main (30-60 min)
- `--scope all` → Entire project (45-90 min, for major refactors)

---

## Newsletter & Social Media

```bash
/bs:post "Just shipped a new feature!"           # Post to all platforms
/bs:post --newsletter buildproven                # Auto-post from newsletter library
/bs:post --newsletter buildproven --dry-run      # Preview before posting
/bs:image newsletters/2026/01/my-post.md --preset beehiiv   # Featured image (1200x630)
/bs:image newsletters/2026/01/my-post.md --preset twitter   # Twitter card (1200x628)
/bs:image newsletters/2026/01/my-post.md --preset carousel  # LinkedIn carousel
```

---

## Command Quick Reference

### Core Workflow

| Command                          | Time      | Quality   | Auto-Deploy | Use For                                 |
| -------------------------------- | --------- | --------- | ----------- | --------------------------------------- |
| `/bs:dev <name>`                 | Variable  | N/A       | ❌ No       | Start any dev work                      |
| `/bs:dev --next`                 | Variable  | N/A       | ❌ No       | Auto-pick from Linear                   |
| `/bs:quality --merge`            | 30-60 min | 95%       | ✅ Yes      | Daily shipping (solo)                   |
| `/bs:quality`                    | 30-60 min | 95%       | ❌ PR only  | Team review                             |
| `/bs:quality --level 98 --merge` | 1-3 hours | 98%       | ✅ Yes      | Production launches (solo)              |
| `/bs:quality --level 98`         | 1-3 hours | 98%       | ❌ PR only  | Production + team review                |
| `/bs:ralph`                      | 1-5 hours | auto+eval | ✅ Yes      | Autonomous multi-item work (graph loop) |

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

## Model Routing (Cost Optimization)

| Tier       | Count | Use Case                                  | Examples                                                                   |
| ---------- | ----- | ----------------------------------------- | -------------------------------------------------------------------------- |
| **Haiku**  | 17    | Display, search, read-only, status        | help, workflow, cost, dashboard, status, patterns                          |
| **Sonnet** | 19    | Code work, quality, refactoring, agents   | dev, quality, ralph, agent-run, read, test, deps, hotfix, verify, refactor |
| **Opus**   | 5     | Architecture, creative, complex reasoning | strategy, new, agent-new, debug, image                                     |

**Override:** Complex debugging or architecture decisions → manually switch to Opus. Target <3,000 Opus calls/week.

---

## Conversation Management (CLI)

- After shipping: `/clear` — wipes session, start fresh immediately
- Mid-feature bloat: `/compact` — drops exploration/debug output, keeps code changes
- Auto-compact triggers at ~150-200 messages

**Recommended pattern:**

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

**For `/bs:ralph` (autonomous backlog batches):**

```bash
/bs:ralph --until "3 items"
# Each item runs PICK→IMPLEMENT→QUALITY→REFLECT→DECIDE graph loop
# Evidence files written to .claude/ralph/
# Use --wt for worktree isolation, --classic for simplified loop
```

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

## Session Management

```bash
/bs:session save complex-feature    # Save session checkpoint
/bs:resume complex-feature          # Resume where you left off
/bs:resume                          # Auto-load last checkpoint

# Parallel features (worktree isolation — no file conflicts)
/bs:dev --parallel --tasks "login page,header fix,API docs"
# → Each agent gets isolated git worktree, creates independent PRs

# Custom agents for recurring tasks
/bs:agent-new security-scanner --type security
/bs:agent-run security-scanner "Scan payment integration"
/bs:agent-run doc-writer "Document payment API endpoints"
```

---

## Autonomous Backlog Iteration

```bash
/bs:ralph                              # 10 items, walk away (graph mode default)
/bs:ralph --until "3 items"            # Stop after 3
/bs:ralph --until "2 hours"            # Time limit
/bs:ralph --scope bug                  # Bugs only
/bs:ralph --scope effort:S             # Small items only
/bs:ralph --dry-run                    # Preview plan
/bs:ralph --wt                         # Worktree isolation per item
/bs:ralph --classic                    # Simplified loop (no reflect/decide)
```

---

## Project & Maintenance Commands

**Project management:**

```bash
/bs:new my-project             # Scaffold new project with quality infra
/bs:backlog                    # View Linear backlog
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

## Quick Status & Orientation

```bash
/bs:status                    # Recent commits, PRs, CI status, suggested next steps
/bs:patterns "authentication" # Search global + project CLAUDE.md for patterns
/bs:quality --preflight       # Fast checks (<10 sec): ready to merge?
/bs:quality --status --verbose # ASCII quality trends, coverage, alerts
/bs:cost                      # Cost per feature/branch, monthly forecast
```
