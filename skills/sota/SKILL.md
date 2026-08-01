---
name: sota
description: SOTA system assessment skill. Auto-invokes when user asks "how's my setup?", "rate my system", "am I SOTA?", "score my config", "audit my Claude setup", or similar assessment questions. Provides consistent, repeatable scoring against defined benchmarks.
user-invocable: false
---

# SOTA — System Assessment + Self-Heal

**Arguments received:** $ARGUMENTS

Repeatable scorecard that rates your Claude Code setup against state-of-the-art benchmarks. **Self-heal runs by default** — any category below 9/10 gets fixed automatically until the floor is met.

## Flags

| Flag           | Description                                                    |
| -------------- | -------------------------------------------------------------- |
| `--score-only` | Score only — skip self-heal, just show the scorecard           |
| `--gaps`       | Show detailed improvement suggestions per category (then heal) |
| `--history`    | Show score trend over time from sota-history.json              |
| (default)      | Score + self-heal all categories below 9/10 + commit fixes     |

## Target Floor

**Every category must reach 9/10.** After scoring, implement fixes for all categories below 9. Re-score after fixes. Repeat until all categories are ≥9 or no further auto-fixes are possible (propose blockers to user).

## Assessment Process

### Step 0: Rubric Refresh + Fetch Latest CC Features

**Rubric version: 3.0 | Last reviewed: 2026-07-15 | Baseline: Claude Code 2.1.210**

> **Why 3.0 is a rewrite, not a bump.** Rubric 2.1 claimed to be fresh (its own
> staleness check only fires at >30 days) while scoring people against a Q1 2026
> world. Its 13 categories contained **zero** of: agent teams, automatic memory,
> the Workflow tool, auto mode, `/loop`, cron/Routines, plugin packaging,
> `Tool(param:value)` permissions, sandbox hardening, `agent_completed` hooks,
> `/usage`, `fallbackModel`, `requiredMinimumVersion`, or custom themes.
>
> **A stale state-of-the-art scorer is worse than none** — it certifies a
> superseded setup as excellent. This is the one skill whose entire value is
> currency, so treat rubric staleness as a P0 bug, not a chore.

**0a) Rubric staleness check** — if `last_reviewed` is >30 days ago, **STOP and
refresh the rubric before scoring anything.** Do not score against a stale rubric
and caveat it; the score would be actively misleading.

1. Fetch the changelog: `https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md`
   (note: **no dates, only version numbers** — reconstruct dates from
   `npm view @anthropic-ai/claude-code time` if you need them)
2. Fetch `https://code.claude.com/docs/en/whats-new`
3. Fetch the live settings schema — it is the ground truth for which keys exist:
   `https://json.schemastore.org/claude-code-settings.json`.
   **Validate the user's settings.json against it.** This is how we found
   `autoApproveEdits` and top-level `defaultMode` were inert.
4. For each new capability, ask: does this **obsolete** a category (something we
   reward that the platform now does for free), or **create** one?
5. Bump `rubric_version` and `last_reviewed`.

If <30 days, just do 0b.

**0b) Feature scan** — always run:

Search for recent Claude Code updates:

- `Claude Code new features changelog site:github.com/anthropics/claude-code`
- `Claude Code slash commands reference 2026`

Output a brief "What's New in CC" section (3-5 items, flag any that affect scoring).

### Step 1: Scan Configuration

Gather data from these sources (read files, count entries):

```
settings.json       → hooks, permissions, plugins, env vars
skills/             → count, auto-invoke count, context:fork usage
commands/            → count, frontmatter completeness
scripts/             → count, categories
config/CLAUDE.md     → line count, section coverage
.husky/              → hook types configured
```

### Step 2: Rate 15 Categories

Score each 1-10 against the benchmarks below. Be objective — deduct for missing
items. **Categories 1-5 are the ones that changed most in 2026; check them first.**

#### The platform-currency categories (new in rubric 3.0)

| #   | Category                | What SOTA Looks Like (10/10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | How to Check                                                                                                                                                                     |
| --- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Settings validity**   | `settings.json` **validates against the live schema**. No invented keys. Watch for: top-level `defaultMode` and `autoApproveEdits` (**neither exists** — `defaultMode` only lives under `permissions`); stale tool names in `permissions.allow` (`Task` is now `Agent`; `SlashCommand`/`EnterPlanMode`/`AskUserQuestion`/`BashOutput` are gone). An invented key is not a no-op you can ignore — it is a setting you _believe_ is on and isn't.                                                                                                                                                                                          | Validate against `https://json.schemastore.org/claude-code-settings.json` (e.g. `npx ajv-cli validate -s <schema> -d settings.json`)                                             |
| 2   | **Permission posture**  | `permissions.defaultMode: "auto"`. Auto mode is the **only** mode that hard-blocks `git reset --hard`, `git clean -fd`, `git stash drop`, and terraform/pulumi/cdk `destroy`. Granular allow/deny. No blanket `Bash` in allow. `Tool(param:value)` rules used where they buy something (e.g. `Agent(model:opus)` as a cost lever). Sandbox hardening: `sandbox.credentials`, `deniedDomains`.                                                                                                                                                                                                                                            | `permissions` block                                                                                                                                                              |
| 3   | **Native-first**        | **Nothing reimplements a built-in.** Deduct hard for a custom cost tracker (`/usage` does it), a local multi-agent PR reviewer (`/code-review ultra`), a bespoke session/checkpoint system (automatic memory + `/rewind`), a hand-rolled cron/poller (`/loop`, cron tools, Routines), a custom agent dashboard (`claude agents` + Monitor + notifications), or hand-rolled worktree isolation (`worktree.bgIsolation` defaults to it). **Exempt when portability requires it** — see "Tool-agnostic exemption" below.                                                                                                                    | Inventory every custom script/skill; for each, ask "did the platform ship this?" then "would using the native one strand the other runtime?"                                     |
| 4   | **Distribution**        | Shipped as a **plugin** (`.claude-plugin/plugin.json` + a marketplace), so components are namespaced `plugin:skill` and cannot shadow built-ins. Deduct heavily for `curl \| bash` + symlinks into `~/.claude`: it clobbers, it can't version, and **it lands skills unprefixed where they silently override Anthropic's own** `/cost`, `/review`, `/status`, `/resume`, `/context`, `/tasks`. **Scope this to repos actually meant for distribution** (a public/OSS kit). A private, single-user, continuously-edited overlay is not a distribution target: score it **N/A** and exclude it from the average rather than penalising it. | `.claude-plugin/`, `claude plugin validate .` — but first ask whether this repo is distributed at all                                                                            |
| 5   | **Agent orchestration** | Deterministic fan-out, bounded loops (see #7), and **completion/blocked signalling that actually fires** — without it a background agent can finish or stall with no signal. Under Claude Code that means background subagents, agent teams, the Workflow tool, and `agent_completed`/`agent_needs_input` hooks. **Do not score on Workflow-tool usage alone** — it is Claude-only, so in a dual-runtime setup a portable script-based orchestrator scores _higher_, not lower. What matters is that caps are mechanically enforced and signals fire in every runtime in use.                                                            | `hooks` Notification matchers; **and** the portable equivalents — provider dispatch config, governor/cap scripts runnable from a plain shell, notifier callable by both runtimes |

#### Tool-agnostic exemption (read before scoring 3, 4, 5, 9, 10)

**A setup that must run under more than one agent runtime is scored on
portability, not on Claude-native feature adoption.** If Claude Code is one of
two or more runtimes in real use (e.g. Codex CLI as primary driver), then
declining a Claude-only primitive is a _correct engineering decision_, and
scoring it as a gap inverts the truth.

Claude-only primitives that must NOT be treated as required in a dual-runtime
setup: the `Workflow` tool, `context: fork`, `fallbackModel`, `agent_completed` /
`agent_needs_input` Notification hooks, `sandbox.*`, agent teams, `/loop`, cron
tools, `.claude-plugin` packaging.

For each, score the **portable equivalent** instead:

| Claude-only primitive | Portable equivalent that scores full marks                                      |
| --------------------- | ------------------------------------------------------------------------------- |
| `Workflow` tool       | Script-based orchestrator runnable from a plain shell (verify: run it headless) |
| `fallbackModel`       | Provider dispatch config with primary/fallback (e.g. `provider-config.sh`)      |
| Notification hooks    | One notifier script both runtimes call (Claude hook cmd + Codex `notify`)       |
| `context: fork`       | Separate non-interactive invocation (`codex exec`)                              |
| `.claude-plugin`      | Installer that reproduces state on a clean machine — prove with an e2e test     |

**Do not award the exemption on assertion.** Verify the portable path actually
works: run the orchestrator from a plain shell, run the installer into an
isolated root, invoke the notifier with each runtime's argv shape. A portable
design that has never been executed outside its home runtime is not portable;
score it as the gap it is.

#### The durable categories

| #   | Category             | What SOTA Looks Like (10/10)                                                                                                                                                                                                                                                                                                                            | How to Check                                       |
| --- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 6   | **CLAUDE.md**        | <100 lines. Action defaults, code style, quality bar, communication, tools, safety. No bloat — every line is read on every turn, so length is a tax.                                                                                                                                                                                                    | `config/CLAUDE.md`                                 |
| 7   | **Bounded autonomy** | **Every autonomous loop has a MECHANICALLY ENFORCED cap** — a non-zero exit code, not a sentence of prose. A cap written in English that the model is asked to honour is not a cap; the model orchestrates the loop and will run past it. Round caps, wall-clock caps, budget governors. Human checkpoints on one-way doors.                            | Any fix→re-review or retry loop                    |
| 8   | **Hooks**            | PreToolUse (block push to main, block destructive paths), PostToolUse (lint), SessionStart, plus the agent lifecycle matchers from #5. Use native automatic memory instead of custom PreCompact checkpointing. No monotonic-threshold bugs (a `-gt N` check with no reset re-fires on every subsequent tool call for the rest of the session).          | `hooks` block                                      |
| 9   | **Skill design**     | Skills are focused and discoverable. Heavy AUTONOMOUS skills use `context: fork`; interactive ones correctly don't. Progressive disclosure — long reference material split into `reference.md`, not inlined into SKILL.md. **No inert frontmatter** (`invokes:` and `auto_invoke:` do not exist — verify against the binary before relying on a field). | `skills/*/SKILL.md`                                |
| 10  | **Model config**     | `fallbackModel` set to a real chain (not just the default model, which is a no-op). Effort levels used deliberately (`xhigh` for the hardest verification, not everywhere). No retired model IDs anywhere — and a deprecation scanner that would catch them.                                                                                            | `fallbackModel`, `effortLevel`, grep for model IDs |
| 11  | **Quality gates**    | Autonomous quality loop: lint + typecheck + test + build + security scan. Second-opinion review. Auto-merge flow that actually completes.                                                                                                                                                                                                               | `skills/quality/`                                  |
| 12  | **Security**         | Secret scanning in hooks, semgrep rules, deny-list for destructive commands, secrets in env vars only. **No private paths or personal data in anything distributed.**                                                                                                                                                                                   | `.semgrep/`, hooks, leak grep                      |
| 13  | **Git workflow**     | Pre-commit (lint-staged), pre-push, conventional commits, feature branches, never commit to main.                                                                                                                                                                                                                                                       | `.husky/`, `commitlint.config.*`                   |
| 14  | **Observability**    | `/usage` for per-category cost (skills, subagents, plugins, per-MCP). OpenTelemetry configured if running a fleet. No hand-rolled cost tracking that has never actually run.                                                                                                                                                                            | `/usage`, OTel env                                 |
| 15  | **Currency**         | `requiredMinimumVersion` pinned so you can _depend_ on new behaviour. CC and plugins at latest. Global tools current. **Rubric itself <30 days old** (see 0a).                                                                                                                                                                                          | `requiredMinimumVersion`, `npm outdated -g`        |

### Step 3: Output Format

```
🎯 CLAUDE CODE SOTA SCORECARD
==============================
Date: YYYY-MM-DD | Project: [name]
Rubric 3.0 | Claude Code <version detected>

PLATFORM CURRENCY (the 2026 categories)
| # | Category            | Score | Verdict              | Top Gap                          |
|---|---------------------|-------|----------------------|----------------------------------|
| 1 | Settings validity   | 4/10  | 🔶 Fair              | 2 invented keys; 5 dead tool names|
| 2 | Permission posture  | 3/10  | ❌ Needs Work        | Not in auto mode — destructive git unblocked |
| 3 | Native-first        | 5/10  | 🔶 Fair              | Custom cost tracker; /usage does this |
| 4 | Distribution        | 2/10  | ❌ Needs Work        | curl|bash symlinks; 6 skills shadow built-ins |
| 5 | Agent orchestration | 6/10  | ⚠️ Good              | No agent_completed hook — silent stalls |

DURABLE
| # | Category            | Score | Verdict              | Top Gap                          |
|---|---------------------|-------|----------------------|----------------------------------|
| 6 | CLAUDE.md           | 9/10  | ✅ Excellent         | —                                |
| 7 | Bounded autonomy    | 3/10  | ❌ Needs Work        | Review loop cap is PROSE, not code |
| ...
| 15| Currency            | 7/10  | ⚠️ Good              | No requiredMinimumVersion        |

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OVERALL: 5.4/10 — Setup is stale against the platform

Legend: ✅ 8+ Excellent | ⚠️ 6-7 Good | 🔶 4-5 Fair | ❌ <4 Needs Work
```

**Scoring honesty.** A setup that was 9/10 in Q1 can be 5/10 today without a
single file changing — the platform moved. Say so plainly. Do not grade on a
curve, and do not soften a low score on categories 1-5 because the setup "used to
be good." The whole point of this skill is to catch drift the user can't see.

### Step 4: Save History (always)

Append result to `.claude/sota-history.json` in the current project (created on first run):

```json
{
  "version": "1.0",
  "lastUpdated": "2026-02-08",
  "entries": [
    {
      "date": "2026-02-08",
      "overall": 8.2,
      "scores": { "claude_md": 9, "settings": 8 },
      "topGaps": ["No env block", "Cross-platform testing"]
    }
  ]
}
```

Read the existing file, append the new entry to `entries[]`, update `lastUpdated` to today's date, and write back. Keep all historical entries (no rolling limit — the file is small).

### Step 4.5: Write Report File (always)

Write the full rendered scorecard (everything shown to the user in Steps 3/5/6) to `data/sota-report.md`.

**Rolling file format — keep last 3 assessments:**

```markdown
# SOTA Reports

<!-- Last 3 assessments, newest first -->

## YYYY-MM-DD

[Full scorecard output from Step 3]
[Gap suggestions if --gaps was used]

---

## YYYY-MM-DD (previous)

[Previous scorecard]

---

## YYYY-MM-DD (oldest)

[Oldest kept scorecard]
```

**Rules:**

- Read existing `data/sota-report.md` if it exists
- Parse sections by `## YYYY-MM-DD` headers
- Prepend the new assessment
- Keep only the 3 most recent sections, delete older ones
- Create `data/` directory if it doesn't exist

### Step 5: If `--gaps` — Detailed Suggestions

For each category scoring <9, show before healing:

```
📋 IMPROVEMENT SUGGESTIONS
===========================

## Settings & Permissions (8/10 → 10/10)
- Add `env` block to settings.json for AGENT_TEAMS and other feature flags
- Add ask rule for `Bash(npm publish:*)`

## Portability (7/10 → 10/10)
- Add Linux compatibility test in setup smoke test
- Document Windows/WSL setup path
```

### Step 6: If `--history` — Show Trend

```
📈 SOTA SCORE HISTORY
=====================
2026-01-24: 6.5/10 ████████████░░░░░░░░
2026-02-03: 7.5/10 ███████████████░░░░░
2026-02-07: 8.0/10 ████████████████░░░░
2026-02-08: 8.2/10 ████████████████░░░░

Trend: +1.7 over 15 days (+0.11/day)
Best category: Quality Gates (10/10 since 2026-02-03)
Most improved: Hooks (5 → 9, +4 points)
```

---

### Step 7: Self-Heal to 9/10 Floor (ALWAYS runs unless `--score-only`)

**Target: every category must reach ≥9/10. Implement fixes until all categories are healed or no further auto-fixes are possible.**

#### 7.1 Identify All Categories Below 9

List every category scoring <9 with:

- Current score
- Gap to 9/10
- Specific fixable items (be concrete — file paths, config keys, exact changes)

#### 7.2 Risk-Tiered Auto-Fix (all tiers now auto-apply)

**Tier 1 — Low-risk (file/config edits):**

- Add `context: fork` to skills > 200 lines ONLY if the skill body describes autonomous/unattended execution (multi-phase pipeline with no human checkpoints, e.g. "detect → snapshot → pull → rebuild → restart → verify" style loops). Skills that are interactive/guided (clarifying questions, review gates, "ask user to confirm" steps) should stay unforked regardless of length — read the skill body, don't just check line count.
- Update frontmatter on commands missing description/tags
- Add missing hook types to settings.json
- CLAUDE.md: trim to <100 lines, add missing sections
- Commit frontmatter, add missing patterns to pattern-check.sh
- Add missing auto-invoke triggers to skills that have natural activation signals
- Fix hook scripts with monotonic `-gt N`/`> N` threshold checks that would re-fire on every call past threshold — convert to a periodic check (e.g. `[ "$COUNT" -ge N ] && [ $((COUNT % N)) -eq 0 ]`) or a once-only marker file.

**Tier 2 — Medium-risk (behavioral changes, model routing):**

- Edit CLAUDE.md behavioral rules based on gaps
- Add/update command logic to close scoring gaps
- Add MCP server entries to settings.json for servers that are actively used but not configured
- Add portability scripts (install.sh, setup-claude-sync.sh) if missing

**Tier 3 — High-risk (propose only, don't auto-apply):**

- Merging or deleting commands (destructive, needs human review)
- Removing permission rules from settings.json
- Changing cron model assignments

For Tier 1 and 2: implement immediately, no confirmation needed. Show what you changed.
For Tier 3: list proposals with rationale. Don't apply.

#### 7.3 Heal Loop

After applying Tier 1+2 fixes, re-score the affected categories mentally. If any are still <9, identify remaining blockers:

- If fixable with another auto-action → do it
- If blocked by Tier 3 (needs human) → note it and move on
- If score is already ≥9 → mark healed

Continue until all healable categories are ≥9 or only Tier 3 blockers remain.

#### 7.4 Output Self-Heal Summary

```
🔧 SELF-HEAL ACTIONS (targeting 9/10 floor)
=============================================
Categories below 9 before heal: [list]

Applied automatically:
  ✅ [Category] (N/10 → 9/10): [what was changed, file:line]
  ✅ [Category] (N/10 → 9/10): [what was changed]

Proposals (Tier 3 — needs human approval):
  📋 [Category] still at N/10: [why blocked] → [proposed action]

Floor status after heal:
  ✅ All auto-healable categories now ≥9/10
  ⚠️ N categories still below 9 — blocked on Tier 3 proposals above
```

#### 7.5 Commit the Changes

After applying all auto-fixes, stage only the specific files this heal loop edited — not `git add -A`, which would sweep in any unrelated dirty state (build artifacts, in-progress edits, scratch files) under a `chore(sota):` message:

```bash
git add <file1> <file2> ...  # exactly the files touched by Tier 1+2 fixes above
git commit -m "chore(sota): self-heal to 9/10 floor $(date +%Y-%m-%d)

Categories healed: [list with before→after scores]
Tier 3 proposals pending: [count]

Score before: X.X | After: Y.Y"
```

Then show the final re-scored table (Steps 1-4 output) with updated scores.
