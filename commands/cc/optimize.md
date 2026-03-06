---
name: cc:optimize
description: Show Claude Code optimization guide and cost-saving strategies
tags: [efficiency, cost, agents, best-practices]
category: claude-code
model: haiku
---

# Claude Code Optimization Guide

**Full guide:** `$SETUP_REPO/CLAUDE_CODE_OPTIMIZATION_GUIDE.md`

## Quick Reference

### 🎯 Core Principle

**You are the reviewer, not the orchestrator. Agents loop autonomously until done.**

### ❌ Stop Doing (Manual Hacking)

- Manual review loops (`/bs:review --deep` → fix → repeat 10x)
- One massive 500+ message conversation
- Using Opus 4.5 for everything (5x expensive)
- Doing everything in main chat

### ✅ Start Doing (Autonomous Agents)

- `/pr-review-toolkit:review-pr` - Autonomous quality loop
- Task tool with specialized agents
- Break conversations at PRs (Feature → PR → New conversation)
- Use Sonnet 4.5 default, Opus only when needed

### 💰 Your Current Stats (Updated Jan 7, 2026)

**Tier:** $200/month (10x capacity)
**Usage (Dec 7 - Jan 6):** 380 sessions, 57,059 messages
**Progress:** ✅ Switched to Sonnet on Jan 1st → 75% cost reduction
**Status:** All 6 optimization targets achieved! 🎉
**Next:** Consider trying $100 tier if you maintain Jan 4-6 session discipline

### 🎯 Your Actual Improvements (Jan 4-6)

| Metric       | Before (Dec)  | After (Jan 4-6) | Status            |
| ------------ | ------------- | --------------- | ----------------- |
| Msgs/session | 466           | 110-115         | ✅ Perfect!       |
| Daily tokens | 700K          | 170K            | ✅ 75% reduction! |
| Model mix    | 97% Opus      | 100% Sonnet     | ✅ Optimized!     |
| Timeouts     | Multiple/week | 0               | ✅ Fixed!         |

**Keep doing what you're doing!** Just watch for weekly burst patterns (Jan 2-3 sprint weeks).

### 🚀 Quick Wins (Already Done!)

```bash
# ✅ 1. Switched default model to Sonnet (Jan 1st)
# Your settings.json shows: "model": "sonnet"
# Result: 75% cost reduction

# ✅ 2. Better session discipline (Jan 4-6)
# You're now at 110-115 msgs/session (perfect!)
# Result: No more 5-hour timeouts

# 🎯 3. Next: Maintain this pattern
# Keep sessions under 120 messages
# Break at feature/PR boundaries
# Watch for weekly burst patterns
```

### 📊 The 5-Hour Window Problem

Two separate limits:

1. **Session timeout:** 5 hours (hard limit, time-based)
2. **Token budget:** ~200k (Sonnet), ~100k (Haiku)

**Fix:** Break conversations at feature boundaries (< 100 messages each)

### 🤖 Agent Workflow

1. **Explore:** `Task(Explore)` - Understand codebase
2. **Plan:** `EnterPlanMode` - Design approach
3. **Build:** Implement with TodoWrite
4. **Quality:** `/pr-review-toolkit:review-pr` - Autonomous loop
5. **Ship:** `/commit-push-pr` - Create PR, start fresh

### 📈 ROI

- **Before:** 10 hours/feature, $10-20 cost, 70% quality
- **After:** 2 hours/feature, $2-4 cost, 98% quality
- **Leverage:** 5x speed, 80% cost reduction

### 🎓 Read Full Guide

```bash
cat $SETUP_REPO/CLAUDE_CODE_OPTIMIZATION_GUIDE.md
```

---

**Remember:** Agent loops > Manual iteration. Conversation boundaries > One massive chat.
