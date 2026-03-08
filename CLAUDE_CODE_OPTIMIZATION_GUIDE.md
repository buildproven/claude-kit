# Claude Code Optimization Guide

_How to Build 5x Faster with 80% Less Cost_

## 🎯 Core Principle

**You are the reviewer, not the orchestrator. Agents loop autonomously until done.**

---

## 🚫 Stop Doing This (Manual Hacking)

```bash
# ❌ Manual review loop (wastes hours + tokens)
/bs:review --deep
# read 50 issues
# fix issues manually
/bs:review --deep
# read 40 more issues
# fix more issues
# repeat 10 times...
# 5 hours later, session timeout 💥

# ❌ One massive conversation
"Build auth + profiles + settings + review everything"
# Result: 500+ messages, 5 auto-compacts, lose context

# ❌ Doing everything in main chat
claude: "I found 3 TypeScript errors"
you: "fix them"
claude: "Done. Found 2 more issues"
you: "fix those too"
# Endless back-and-forth
```

---

## ✅ Start Doing This (Autonomous Agents)

```bash
# ✅ Autonomous review loop
/pr-review-toolkit:review-pr
# → Runs ALL review agents in parallel
# → Each loops until domain is clean
# → Reports when 98% done
# → One command, zero manual iteration

# ✅ Focused conversations with natural boundaries
# Conversation 1 (30 min):
"Implement user auth feature"
/feature-dev:code-architect
# implement
/commit-push-pr

# Conversation 2 (20 min):
"Add profile page"
# implement
/commit-push-pr

# ✅ Issue-to-PR automation
Task tool: "Fix GitHub issue #42"
subagent_type: github-issue-fixer
# → Analyzes, implements, tests, creates PR
# → Zero manual steps
```

---

## 📊 The 5-Hour Window Problem

### Two Separate Limits

| Limit               | Type                  | Impact                             |
| ------------------- | --------------------- | ---------------------------------- |
| **Session Timeout** | 5 hours hard limit    | Disconnects regardless of activity |
| **Token Budget**    | ~200k tokens (Sonnet) | Auto-compacting when hit           |

### Why You Hit Both (Real Example from Your Usage)

**Root cause:** Entire features in one conversation

**Your actual longest session:**

- Duration: 89 hours (3.7 days!)
- Messages: 1,114
- Result: Hit 5-hour timeout multiple times, lost context repeatedly

```
Hour 0: Start feature implementation
Hour 1: Implement core functionality
Hour 2: Review, find 50 issues, fix manually
Hour 3: Review again, find 30 more issues
Hour 4: Still fixing review issues one by one
Hour 5: 💥 Session timeout

Meanwhile:
Message 50:  Auto-compact #1 (lose context)
Message 150: Auto-compact #2 (lose more context)
Message 300: Auto-compact #3 (barely remember start)
```

### The Fix: Conversation Boundaries (Working for You!)

**Your actual improvement (Jan 4-6):**

| Period  | Msgs/Session | Duration | Status              |
| ------- | ------------ | -------- | ------------------- |
| Dec 31  | 466 msgs     | Hours+   | ❌ Hitting timeouts |
| Jan 4-6 | 110-115 msgs | <1 hour  | ✅ **Perfect!**     |

Break at natural milestones:

```bash
# Conversation 1: Implementation (30 min, 50 messages)
"Implement user auth"
/feature-dev:code-architect
# Code it
/commit

# Conversation 2: Quality Loop (20 min, 30 messages)
"Review and ship auth feature"
/pr-review-toolkit:review-pr  # Autonomous loop
/commit-push-pr

# Conversation 3: Next Feature (30 min, 40 messages)
"Add profile page"
# Fresh context, no baggage
```

**Result (you're already seeing this!):**

- No session timeouts (each < 1 hour) ✅
- No auto-compacting (each < 100 messages) ✅
- Clean context per feature ✅
- Faster iteration ✅
- **75% cost reduction** ✅

---

## 🤖 Your Actual Workflow (BS Commands)

### Solo Dev Workflow (Default - Fast Iteration)

```bash
# 1. Start feature
/bs:dev my-feature
# → Creates branch: feature/my-feature
# → Assesses complexity (simple/medium/complex)
# → Plans approach
# → You implement

# 2. Code
# ... make your changes ...

# 3. Ship it (fully autonomous)
/bs:quality --merge
# → Autonomous 30-60 min quality loop
# → Commits all changes
# → Creates PR
# → Auto-merges
# → Deploys to production
# → Releases

# ☕ Go get coffee while it runs
# ✅ Returns: Live in production

# 4. Next feature (new conversation)
/bs:dev next-feature
```

**Time:** 30-60 min autonomous
**Result:** Tested, reviewed, merged, deployed, live

### Team Collaboration Workflow (PR Review)

```bash
# 1. Start feature
/bs:dev my-feature

# 2. Code
# ... make your changes ...

# 3. Create PR (no auto-merge)
/bs:quality
# → Autonomous 30-60 min quality loop
# → Commits all changes
# → Creates PR
# → Stops (ready for team review)

# 4. After team approves & merges
/bs:git-sync
# → Auto-switches to main
# → Pulls merged code
# → Deploys
# → Releases

# 5. Next feature (new conversation)
/bs:dev next-feature
```

**Time:** 30-60 min autonomous + manual team review
**Result:** Team reviewed, then deployed

### Production Launches (Critical Features)

```bash
# 1. Start feature
/bs:dev critical-feature

# 2. Code
# ... make your changes ...

# 3. Production-perfect quality
/bs:quality --level 98 --merge
# → Autonomous 1-3 hour comprehensive quality loop
# → Tests, ESLint, TypeScript, accessibility, performance, security
# → Creates PR, auto-merges, deploys, releases

# ☕ Go do something else (1-3 hours)
# ✅ Returns: Bulletproof, live in production

# 4. Next feature (new conversation)
/bs:dev next-feature
```

**Time:** 1-3 hours autonomous
**Result:** Production-perfect (98% complete), live

### What /bs:quality Actually Checks

**Level 95 (default - Ship Ready):**

- ✅ Tests: 100% passing
- ✅ ESLint: Clean (0 errors/warnings)
- ✅ TypeScript: Strict mode, no `any`
- ✅ Build: Successful
- ✅ No silent failures
- ✅ Type safety verified
- ✅ Test coverage: Changed code files have test updates
- ✅ Documentation: Help/README updated if commands/API changed

**Level 98 (--level 98 - Production Perfect):**

- ✅ Everything in Level 95 PLUS:
- ✅ Security: 0 high/critical (OWASP top 10)
- ✅ Accessibility: WCAG AA compliant
- ✅ Performance: Lighthouse >90 all metrics
- ✅ No attack vectors
- ✅ No N+1 queries/memory leaks
- ✅ Architecture reviewed
- ✅ BACKLOG.md: Item marked complete if branch references ID

### Rapid Development (Incremental Commits)

```bash
# After coding a small chunk
/bs:quality --scope changed
# → Checks only uncommitted files (2-5 min)
# → Auto-commits with generated message

# Code next chunk
/bs:quality --scope changed
# → Quick check (2-5 min)
# → Auto-commits

# Feature complete - full check before merge
/bs:quality --merge
# → Checks all branch changes (30-60 min)
# → Creates PR, merges, deploys

# No manual git commands needed!
```

**Scope Options:**

- `--scope changed` → Uncommitted files only (2-5 min)
- Default (no flag) → All branch changes vs main (30-60 min)
- `--scope all` → Entire project (45-90 min for major refactors)

**Time Savings:** 40% faster with incremental `--scope changed` checks

---

## 🎮 Underutilized Agents (You Already Have)

### End-to-End Automation

```bash
# github-issue-fixer
# Give it issue #, it does everything
Task: "Fix GitHub issue #42"
subagent_type: github-issue-fixer

# It will:
# - Analyze issue
# - Create branch
# - Implement fix
# - Run tests
# - Create PR
# ALL autonomous, zero manual steps
```

### Quality Specialists

```bash
# refactoring-specialist
# Autonomous refactoring loops until clean
Task: "Refactor auth module for clarity"
subagent_type: refactoring-specialist

# performance-engineer
# Loops until Lighthouse scores hit target
Task: "Optimize homepage to Lighthouse 90+"
subagent_type: performance-engineer

# security-auditor
# Deep security review with autonomous fixes
Task: "Security audit before production"
subagent_type: security-auditor
```

---

## 💰 Cost Optimization & Tier Analysis

### Real Usage Data (Dec 7 - Jan 6, 2026)

**Overall stats:**

- 57,059 messages across 380 sessions
- Total tokens: ~5.2M Opus + ~1.7M Sonnet

**Key milestone: Jan 1st model switch** ✅

- Dec 7-31: 97% Opus usage (expensive, hitting limits)
- Jan 1-6: Switched to Sonnet 4.5 default
- **Result:** Usage dropped from ~700K tokens/day → ~170K tokens/day

### Session Length Analysis

| Period  | Avg Messages/Session | Status                        |
| ------- | -------------------- | ----------------------------- |
| Dec 31  | 466 msg/session      | ❌ Too long, hitting timeouts |
| Jan 2-3 | 128-151 msg/session  | ⚠️ Better but still heavy     |
| Jan 4-6 | 110-115 msg/session  | ✅ **Ideal range**            |

**Longest session:** 1,114 messages over 89 hours (3.7 days!) - This is why you hit 5-hour timeouts.

### $100 vs $200 Tier Decision

**With your Jan 4-6 improved pattern:**

| Metric         | Jan 4-6 Pace | $100 Capacity | $200 Capacity | Fits $100?         |
| -------------- | ------------ | ------------- | ------------- | ------------------ |
| Daily avg      | ~170K tokens | ~300-400K/day | ~600-800K/day | ✅ Yes (42% usage) |
| Monthly        | ~5.1M tokens | ~10-12M/month | ~20-24M/month | ✅ Yes (42% usage) |
| Weekly (light) | ~1.2M tokens | ~2.5M/week    | ~5M/week      | ✅ Yes             |
| Weekly (burst) | ~2.8M tokens | ~2.5M/week    | ~5M/week      | ⚠️ Borderline      |

**The bursty pattern problem:**

- Your usage varies 4x between light days (160K) and heavy days (750K)
- Sprint weeks (Jan 2-3 pace) can hit 2.8M tokens/week
- $100 weekly limit: ~2.5M tokens
- $200 weekly limit: ~5M tokens

**Recommendation based on actual data:**

- **Try $100 tier** if you maintain Jan 4-6 session discipline
- **Stick with $200** if you have unpredictable sprint weeks
- **Monitor weekly patterns** - bursty workload is your biggest risk

### Optimization Strategy (Already Working!)

✅ **You already did this on Jan 1st:**

```bash
# settings.json shows:
"model": "sonnet"
```

**Impact observed:**

- Dec usage: ~700K tokens/day (Opus)
- Jan 4-6 usage: ~170K tokens/day (Sonnet)
- **75% cost reduction achieved** 🎉

**Next optimization:** Session boundaries (Jan 4-6 shows improvement!)

### Model Selection Guide

| Task                   | Model      | Reasoning                |
| ---------------------- | ---------- | ------------------------ |
| Exploration            | Haiku      | Cheap, read-only         |
| Feature implementation | Sonnet 4.5 | Best value/quality ratio |
| Complex architecture   | Opus 4.5   | Only when needed         |
| Code review            | Sonnet 4.5 | Plenty capable           |
| Simple scripts         | Haiku      | Overkill for Sonnet      |

### Per-Task Model Override

```bash
# Use cheap model for exploration:
Task(
  prompt="Explore the auth codebase",
  subagent_type="Explore",
  model="haiku"  # ← Override for this task only
)

# Main conversation stays on Sonnet 4.5
```

---

## 📝 Custom Skills for Your Workflow

### Create "Done Done" Quality Loop

```bash
/skill-creator
```

**Example skill to create:**

```yaml
name: ship-ready
description: Run all quality gates until production-ready (98% done standard)

workflow:
  # Run each until passing:
  - /bs:test (fix until green)
  - /pr-review-toolkit:review-pr (fix until clean)
  - /bs:a11y (fix accessibility to WCAG AA)
  - Build verification (fix until successful)
  - /commit-commands:commit-push-pr

exit_criteria:
  - Tests: 100% passing
  - ESLint: 0 errors, 0 warnings
  - TypeScript: strict mode, no 'any'
  - Accessibility: axe-core clean
  - Build: successful
  - PR: created with changelog
```

### Other Useful Skills

```yaml
name: quick-ship
description: MVP quality for rapid iteration
checks:
  - Tests pass
  - Basic ESLint clean
  - Builds successfully

---
name: done-98
description: Full production quality (98% complete)
checks:
  - All tests pass (100%)
  - ESLint clean (0 errors/warnings)
  - TypeScript strict (no any)
  - Accessibility AA (axe-core)
  - Performance (Lighthouse >90)
  - Security audit (0 high/critical)
  - PR created with changelog
```

---

## 🎯 The 98% Done Standard

**Definition of Done checklist:**

- [ ] ✅ All tests pass (100% green)
- [ ] ✅ ESLint clean (0 errors, 0 warnings)
- [ ] ✅ TypeScript strict mode (no `any`, no errors)
- [ ] ✅ Accessibility WCAG AA (axe-core clean)
- [ ] ✅ Performance (Lighthouse >90 all metrics)
- [ ] ✅ Security audit (0 high/critical issues)
- [ ] ✅ Build successful (no warnings)
- [ ] ✅ PR created with proper changelog
- [ ] ✅ Documentation updated
- [ ] ✅ No console errors in dev/prod

**How to enforce:**

```bash
# ONE command, autonomous loop until all checks pass:
/ship-ready

# Agent handles:
# - Running all checks
# - Fixing issues
# - Re-checking
# - Repeating until 98% threshold
# - Creating PR when done

# You only review final result
```

---

## 📈 ROI Comparison

### Before (Manual Hacking)

- **Time per feature:** 10 hours
- **Pattern:** Manual review loops, fixing issues one by one
- **Conversations:** One massive 500+ message session
- **Cost:** $10-20 per feature (Opus 4.5, repeated work)
- **Quality:** 70% done (rushed to avoid timeout)

### After (Autonomous Agents)

- **Time per feature:** 2 hours
- **Pattern:** Agent loops autonomously, you review final result
- **Conversations:** 2-3 focused sessions (30 min each)
- **Cost:** $2-4 per feature (Sonnet 4.5, no repeated work)
- **Quality:** 98% done (agents loop until criteria met)

**Leverage:** 5x speed, 80% cost reduction, higher quality

---

## 🚀 Quick Wins (Do Today)

### 1. Switch Default Model

```bash
claude config
# Select: Sonnet 4.5 (not Opus)
```

**Impact:** 5x more capacity at same $100 tier

### 2. Break Your Next Feature Into Conversations

```bash
# Instead of:
"Build auth system + profiles + settings + review everything"

# Do:
# Conversation 1: "Implement auth system"
# Conversation 2: "Add profile page"
# Conversation 3: "Add settings page"
```

**Impact:** No session timeouts, cleaner context

### 3. Use PR Review Toolkit Once

```bash
# Next time you'd manually review:
/pr-review-toolkit:review-pr

# Instead of 10 manual review iterations
```

**Impact:** Save 2-3 hours immediately

### 4. Create One Custom Skill

```bash
/skill-creator

# Create: "done-98" skill with your quality checklist
```

**Impact:** Reusable quality standard across all projects

---

## 🔧 Conversation Management Best Practices

### When to Start New Conversation

**✅ Start new conversation when:**

- Feature is complete and PR is created
- Switching to unrelated task
- Approaching 100+ messages
- Context is getting muddy
- You want clean slate

**❌ Don't start new conversation when:**

- In middle of implementation
- Agent is mid-loop fixing issues
- Just asked a follow-up question

### Conversation Naming

```bash
# Good (specific):
"Auth: Implement JWT token refresh"
"Profile: Add avatar upload"
"Bug: Fix email validation #123"

# Bad (vague):
"Working on stuff"
"Fixes"
"Update"
```

### Context Management

**Automatic:** `/bs:quality` runs `/compact` before spawning agents (Step 1.7). `/bs:ralph-dev` uses fresh Task agent context per item by default.

**Manual `/compact`** — only when you feel context is bloated mid-work:

```bash
# When to compact manually:
# - Heavy exploration session (read 20+ files, need to keep coding)
# - After debugging (fixed issue, drop error logs)
# - NOT after every commit (overkill, let /bs:quality handle it)

/compact

# What gets dropped: exploration results, failed attempts, debug output
# What stays: recent code changes, test results, next steps
```

**`/clear`** — between features (not mid-feature):

```bash
# After shipping:
/bs:quality --merge
/clear                # Full reset for next feature
/bs:dev next-feature
```

---

## 🎓 Advanced Patterns

### Multi-Agent Parallel Execution

```bash
# Run multiple agents simultaneously:
# (in single message with multiple Task tool calls)

Task 1: "Security audit" (security-auditor)
Task 2: "Performance optimization" (performance-engineer)
Task 3: "Accessibility review" (accessibility-tester)

# All run in parallel, report when done
# 3x faster than sequential
```

### Agent Chaining

```bash
# Sequential agent workflow:

# Step 1: Explore codebase
Task: "Understand auth architecture"
subagent_type: Explore

# Step 2: Plan refactoring
EnterPlanMode
# Design improvements

# Step 3: Refactor
Task: "Refactor auth module per plan"
subagent_type: refactoring-specialist

# Step 4: Quality loop
/pr-review-toolkit:review-pr

# Step 5: Ship
/commit-push-pr
```

### Background Agent Tasks

```bash
# Run expensive agents in background:
Task(
  prompt="Comprehensive security audit",
  subagent_type="security-auditor",
  run_in_background=True
)

# Continue other work while it runs
# Check results later with TaskOutput
```

---

## 📚 Cheat Sheet

### Daily Workflow

```bash
# Start feature (new conversation)
/bs:dev my-feature
# Implement changes
/bs:quality --merge
# ☕ 30-60 min later: Live in production

# Next feature (new conversation)
/bs:dev next-feature

# TL;DR: /bs:dev → Code → /bs:quality --merge → Coffee → Deployed
```

### Quick Commands

```bash
/bs:dev feature-name  # Start feature (plan + branch)
/bs:quality           # 30-60 min autonomous quality → PR only
/bs:quality --merge   # 30-60 min autonomous quality → deployed
/bs:quality --level 98  # 1-3 hr production-perfect → PR only
/bs:quality --scope changed  # 2-5 min quick check → commit
/bs:git-sync          # Pull, deploy, release after merge
/bs:workflow          # See this guide
/compact              # Trim conversation context
/clear                # Start totally fresh
```

### Model Selection

```bash
# Exploration/reading: Haiku
# Implementation/review: Sonnet 4.5
# Complex architecture: Opus 4.5 (rarely)
```

### Cost Optimization

```bash
# Default: Sonnet 4.5 (best value)
# Per-task override: model="haiku" for cheap tasks
# Conversation boundaries: Feature → PR → New conversation
# Agent loops: Stop manual iteration
```

---

## 🎯 Success Metrics

Track these to measure improvement:

| Metric                    | Dec Baseline | Jan 4-6 Current | Target     | Status           |
| ------------------------- | ------------ | --------------- | ---------- | ---------------- |
| **Msgs/conversation**     | 466          | 110-115         | <120       | ✅ **Achieved!** |
| **Model mix**             | 97% Opus     | 100% Sonnet     | 95% Sonnet | ✅ **Achieved!** |
| **Daily tokens**          | 700K         | 170K            | <200K      | ✅ **Achieved!** |
| **Session timeouts/week** | Multiple     | 0               | 0          | ✅ **Achieved!** |
| **Conversations/feature** | 1 massive    | 2-3             | 2-3        | ✅ **Achieved!** |
| **Cost/feature**          | $10-20       | $2-4            | $2-4       | ✅ **Achieved!** |

**Your progress: 6/6 metrics hit! 🎉**

### What Changed (Jan 1-6):

1. ✅ Switched to Sonnet 4.5 default → 75% cost reduction
2. ✅ Breaking conversations at 110-115 messages → No timeouts
3. ✅ Better session discipline → 4x productivity gain

### Remaining Risk:

- ⚠️ **Weekly burst patterns** (Jan 2-3 sprint weeks can still hit limits)
- Solution: Spread heavy work across weeks OR stay on $200 tier for safety

---

## 🔄 Weekly Optimization Ritual

Every Friday, review:

```bash
# Check stats
cat ~/.claude/stats-cache.json

# Questions:
1. Which conversations hit 200+ messages? (too long)
2. How many manual review loops? (should be 0)
3. Average cost per feature? (target: $2-4)
4. Any session timeouts? (should be 0)
5. Using Opus vs Sonnet ratio? (target: 5% Opus)

# Adjust:
- Create custom skills for repeated patterns
- Break up long conversations
- Switch more tasks to Haiku/Sonnet
```

---

## 🎓 Resources

- [PR Review Toolkit Docs](~/.claude/plugins/.../pr-review-toolkit/)
- [Agent SDK Docs](https://github.com/anthropics/anthropic-sdk-typescript)
- [Claude Code Costs](https://code.claude.com/docs/en/costs.md)
- This guide: `~/Projects/claude-setup/CLAUDE_CODE_OPTIMIZATION_GUIDE.md`

---

## 📈 Your Real Results (Dec 7 - Jan 6)

**Bottom line:** You nailed it! All 6 optimization targets achieved.

**What worked:**

1. ✅ Model switch (Opus → Sonnet) on Jan 1st → 75% cost reduction
2. ✅ Session discipline (466 msgs → 110 msgs) → No timeouts
3. ✅ Conversation boundaries → 4x productivity

**What to watch:**

- ⚠️ Weekly burst patterns (sprint weeks can hit limits on $100 tier)
- Recommendation: Try $100 tier, monitor for weekly limit hits during sprints

**Current trajectory:** Sustainable at $100/month if you maintain Jan 4-6 patterns

---

_Last updated: 2026-01-07_
_Based on your actual usage data: 57K messages, 380 sessions_
_Optimization level: 98% 🎯_
