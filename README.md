# claude-kit

**A Claude Code toolkit whose quality gate reads your diff, scores its risk, and
scales its own review depth to match.**

A doc typo gets a light pass. A change to `.github/workflows/` pins a security floor
and escalates review to maximum effort — however innocuous the diff looks. One logic
file taints a mixed changeset.

That is not a prompt saying "please be thorough". It is
[`risk-score.js`](scripts/risk-score.js) (537 lines), a
[run governor](scripts/quality-run-governor.js) that caps runaway review loops and
fails _closed_, and a target resolver — **312 tests, 88% coverage**.

Plus autonomous backlog execution, multi-LLM strategy panels, fleet auditing, and 14
specialist agents.

**Everything is here.** One repo, MIT, no paid tier, nothing held back.

## What's inside

| Dir         | Contents                                                           |
| ----------- | ------------------------------------------------------------------ |
| `commands/` | 33 `/bs:*` + `/gh:*` + `/cc:*` commands                            |
| `skills/`   | 36 skills — quality, autonomous workflow, strategy, domain         |
| `agents/`   | 14 specialist agents                                               |
| `scripts/`  | Hooks, lint, branch-protection, quality governor, review companion |
| `config/`   | Generic `CLAUDE.md` and `settings.json` templates                  |

## What this is (and isn't)

Between January and July 2026 Anthropic shipped, natively and for free, a large
chunk of the orchestration layer toolkits like this used to hand-roll: background
subagents that auto-commit, push and open a draft PR (2.1.198); agent teams; the
Workflow tool; worktree isolation; automatic memory; `/loop` + cron + Routines;
`/code-review ultra`; and `/usage`.

So this kit doesn't reimplement any of it — the redundant parts were deleted (see
[the table below](#removed--claude-code-now-does-these-natively)). What remains is
the part the platform doesn't ship: opinionated workflow, and domain judgment
(`legal`, `monetize`, `seo`, `review-content`, and the
strategy panels).

## Prerequisites

|                        | Needed for                                                  |
| ---------------------- | ----------------------------------------------------------- |
| **git**                | everything                                                  |
| **Node ≥ 20**          | the quality gate's scoring scripts (`package.json` engines) |
| **python3**            | `csc_lint.py` (the command/skill linter)                    |
| **jq** _(recommended)_ | the hooks; they degrade to `grep` without it, less reliably |
| **gh** _(optional)_    | PR-aware features in `/bs:quality`, `/bs:status`            |
| **acpx** _(optional)_  | `/bs:strategy` only — every provider is invoked through it  |

Some skills also need an MCP server and will tell you so rather than failing
quietly: `/bs:backlog` and `/bs:dev --next` need **Linear**; `/bs:triage` needs
**Sentry**.

**macOS-only:** the desktop-notification hooks use `osascript`. On Linux/WSL they
are skipped — everything else works.

## Quick start

Install as a Claude Code plugin:

```
/plugin marketplace add buildproven/claude-kit
/plugin install bs@buildproven
```

That's it. No symlinks, no `curl | bash`, no clobbering your `~/.claude`.

### Everything is namespaced `/bs:*`

Because the plugin is named `bs`, every skill it ships is addressed with a `bs:`
prefix — `/bs:quality`, `/bs:ralph`, `/bs:strategy`. This is real namespacing
enforced by Claude Code, not a naming convention:

- **Nothing collides with a built-in.** Before this, the kit shipped bare skills
  called `cost`, `review`, `status`, `resume`, `context` and `tasks` — all of
  which _shadowed_ Anthropic's own `/cost`, `/review`, `/status`, `/resume`,
  `/context` and `/tasks`. Personal skills beat bundled ones, so typing `/cost`
  silently ran the kit's version instead of Claude Code's.
- **You can always tell what's yours.** If it has a `bs:` prefix, it came from
  this kit.

<details>
<summary>Legacy install (symlinks) — still works, not recommended</summary>

```bash
git clone https://github.com/buildproven/claude-kit.git ~/Projects/claude-kit
cd ~/Projects/claude-kit
./install.sh
```

This symlinks `commands/`, `skills/`, `agents/` and `scripts/` into `~/.claude/`.
`scripts/` is load-bearing — `config/settings.json` wires 14 hooks to
`$HOME/.claude/scripts/*.sh`, so without it every hook silently no-ops. It works,
but skills land unprefixed, so they can shadow Claude Code built-ins. Prefer the
plugin.

</details>

## Core commands

```text
/bs:dev         Start a feature with complexity-appropriate planning
/bs:quality     Autonomous quality loop (tier-aware, Codex cross-review, break-glass)
/bs:test        Run tests with auto-detected framework
/bs:hotfix      Emergency production fix workflow
/bs:plan        Structured spec before complex work
/bs:new         Bootstrap a new project
/bs:init-project Bootstrap agent infrastructure in any project
/bs:investigate Root-cause debugging — find the cause before touching code
/bs:help        Full command reference
/bs:workflow    Daily workflow guide
/bs:status      Project catch-up summary
/bs:deps        Dependency health (outdated, audit, upgrade)
/bs:cleanup     Clean AI CLI caches and temp files
/bs:sync        Verify and repair config symlinks
/bs:scrub       Prep a project for public release
/gh:fix-issue   Full issue workflow: analyze → branch → fix → test → PR
/cc:create-command  Scaffold a new slash command
```

### Autonomous workflow & strategy

```text
/bs:ralph       Autonomous backlog execution — pick, implement, test, reflect, repeat
/bs:strategy    Multi-LLM strategy panel (Claude + Codex + Gemini, via API keys)
/bs:review      Collaborative artifact review (PDFs, landing pages, emails, docs)
/bs:prd         PRD discipline — clarifying questions, task list, pause gates
/bs:backlog     Value-prioritized backlog
/bs:sota        Score your setup against the state-of-the-art rubric, self-heal
/bs:steward     Fleet-wide hygiene, currency and quality across all repos
/bs:sentry      Fleet quality audit — 8 gates across every project
/bs:triage      Sentry errors → cluster → Linear tickets → fix PR
/bs:patterns    Search CLAUDE.md conventions across projects
/bs:recover-quality  Audit + fix quality regression, integrate learnings
/bs:verify-claim Extract claims, verify against primary sources
/bs:legal       Legal review for software founders
```

### Domain intelligence

Skills, invoked in conversation: `monetize`, `seo`,
`review-content`, `agent-browser`.

Agents: `business-panel-experts`, `competitive-analyst`, `critic`,
`github-issue-fixer`, `command-creator`, `seo-specialist`.

### Removed — Claude Code now does these natively

Don't reimplement what the platform ships. As of 2.1.207:

| Was                                        | Use instead                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| `/bs:cost`                                 | `/usage` — per-category cost (skills, subagents, plugins, per-MCP)     |
| `/gh:review-pr`                            | `/code-review ultra` — cloud multi-agent review, `--comment`/`--fix`   |
| `/cc:optimize`                             | `/usage` + `fallbackModel` + `/effort`                                 |
| `/bs:session`, `/bs:resume`, `/bs:context` | Automatic memory + `/rewind` (resumes from before `/clear`) + `/recap` |
| `/bs:agent-new`, `/bs:agent-run`           | Edit `.claude/agents/` directly; `claude agents` to view               |
| `/bs:dashboard`                            | `claude agents` + Monitor + `agent_completed` hooks + mobile push      |

## Skills

Skills auto-invoke from natural language — you don't have to type a command.

**Engineering** — `quality` (tier-aware review + Codex cross-review),
`test-strategy`, `error-handling`, `api-conventions`, `recover`, `cleanup`,
`scrub`, `deps`, `status`, `workflow`, `healthcheck`

**Build quality** — `frontend-design` (Apache 2.0), `ui-reviewer`,
`webapp-testing` (Apache 2.0), `visualise`

**Autonomous & strategy** — `ralph`, `strategy`, `review`, `prd`, `backlog`,
`sota`, `steward`, `triage`, `patterns`, `recover-quality`, `verify-claim`

**Domain** — `legal`, `monetize`, `seo`, `review-content`,
`agent-browser`

Just ask: `"Run the quality skill"`, `"Use the visualise skill to diagram this"`.

## Agents

14 specialists. Claude picks the right one, or name it directly.

**Engineering** — `code-reviewer`, `security-auditor`, `accessibility-tester`,
`architect-reviewer`, `performance-engineer`, `postgres-pro`, `prompt-engineer`,
`refactoring-specialist`

**Strategy & domain** — `business-panel-experts` (Christensen, Porter, Drucker,
Godin, Kim & Mauborgne, Collins, Taleb, Meadows), `competitive-analyst`,
`critic`, `seo-specialist`, `github-issue-fixer`, `command-creator`

## Extend

See [EXTENSION-ARCHITECTURE.md](EXTENSION-ARCHITECTURE.md) for how to layer
private commands and preferences on top without forking.

## Customize

1. Copy `config/CLAUDE.md` and tune it to your workflow.
2. Edit `config/settings.json` for permissions, hooks, and model routing.
3. Add your own commands, skills, or agents in a private overlay repo that submodules this one.

### Optional: status line

`config/settings.json` ships without a `statusLine` so nothing breaks out of the box. For a status line showing model, git, context, cost, and usage timer, install [claude-hud](https://www.npmjs.com/package/claude-hud) — it writes its own `statusLine` config:

```bash
npx claude-hud@latest
```

## License

MIT
