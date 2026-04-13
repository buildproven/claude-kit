---
model: opus
name: debug
description: Systematic debugging with hypotheses, logging, and Rule of Three
tags: [debug, troubleshooting]
category: utility
---

model: opus

# Debug

You are stuck on a thorny issue. Take your time. Be comprehensive—thoroughness beats speed here.

## Your Approach

1. **Create hypotheses** - List all possible causes for what's wrong. Don't jump to conclusions. Number each hypothesis clearly (H1, H2, H3...).
2. **Gemini cross-check** - After listing your hypotheses, fire `acpx gemini exec` concurrently with step 3 (don't wait — start logging immediately):
   ```
   acpx gemini exec "Cross-check: Given error [paste exact error], Claude hypothesizes [paste numbered list]. What alternative root causes or blind spots do you see? Focus on what Claude may have missed." --no-wait
   ```
   When results arrive, merge any non-overlapping hypotheses into the list tagged `[Gemini]`. If `acpx` or Gemini is unavailable, skip with a note and continue.
3. **Read all related code** - Read ALL code that could be related. Take your time. Don't skim.
4. **Add strategic logging** - Add console.log statements to verify your assumptions about what's actually happening.
5. **Ultrathink** - Think step by step through the problem, including any `[Gemini]` hypotheses. Consider edge cases.

## If You're Still Stuck

Try these in order:

1. **Revert and retry** - Sometimes starting fresh works better than patching
2. **Different approach** - Step back and tackle it from a completely different angle
3. **Write a minimal reproducer** - Create the smallest possible example that exhibits the bug
4. **Multi-model ensemble** - Run `/bs:strategy --mode debate` to get Claude, Gemini, and ChatGPT perspectives

## Rules You Must Follow

- **Rule of Three**: If you've tried the same approach 3 times and it's still not working, stop and change something fundamental
- **Show don't tell**: Write a minimal working example, then apply that pattern to the rest
- **Starting over beats more patches**: The first attempt shapes everything. A clean start with better context often wins.

## Before Giving Up

Write a new high-level plan:

- No code, just sentences
- What you've learned
- What you think is actually wrong
- List files to look at next
