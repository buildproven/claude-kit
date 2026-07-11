# claude-kit

Free, open-source Claude Code toolkit. A complete dev toolkit — quality automation, code review, build-quality skills, dev hygiene. Most devs won't need anything more.

This repo is the public core. It is designed to be extended, not forked.

## Tiers

|                               | claude-kit (this repo)                                                                                                                                    | [claude-kit-pro](https://github.com/buildproven/claude-kit-pro)                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Price**                     | Free (MIT)                                                                                                                                                | Paid                                                                                                        |
| **Quality automation**        | ✅ tier-aware, Codex cross-review, break-glass                                                                                                            | (uses kit's)                                                                                                |
| **Dev workflow**              | ✅ `/bs:dev`, `/bs:plan`, `/bs:test`, `/bs:new`                                                                                                           | (uses kit's)                                                                                                |
| **Dev hygiene**               | ✅ deps, status, workflow, cleanup                                                                                                                        | (uses kit's)                                                                                                |
| **Build-quality skills**      | ✅ frontend-design, ui-reviewer, webapp-testing, visualise                                                                                                | (uses kit's)                                                                                                |
| **SWE specialist agents**     | ✅ code-reviewer, security-auditor, accessibility-tester, architect-reviewer, performance-engineer, postgres-pro, prompt-engineer, refactoring-specialist | (uses kit's)                                                                                                |
| **Investigate + bootstrap**   | ✅ `/bs:investigate`, `/bs:init-project`                                                                                                                  | (uses kit's)                                                                                                |
| **GitHub workflow**           | ✅ `/gh:fix-issue`                                                                                                                                        | (uses kit's)                                                                                                |
| **Autonomous backlog**        | —                                                                                                                                                         | ✅ `/bs:ralph`                                                                                              |
| **Multi-LLM strategy panels** | —                                                                                                                                                         | ✅ `/bs:strategy` (Claude + Codex + Gemini parallel)                                                        |
| **Session save/resume**       | —                                                                                                                                                         | ✅ `/bs:session`, `/bs:resume`, `/bs:context`                                                               |
| **Fleet-wide auto-audit**     | —                                                                                                                                                         | ✅ `/bs:sentry`, `/bs:steward`, `/bs:sota`                                                                  |
| **Agent infra**               | —                                                                                                                                                         | ✅ `/bs:agent-new`, `/bs:agent-run`, `/bs:dashboard`, agent-browser skill                                   |
| **Commercial-intelligence**   | —                                                                                                                                                         | ✅ legal, market-validation, seo, monetize, review-content skills                                           |
| **Pro-only agents**           | —                                                                                                                                                         | ✅ business-panel-experts, competitive-analyst, critic, github-issue-fixer, command-creator, seo-specialist |
| **License-enforcement MCP**   | —                                                                                                                                                         | ✅ claude-kit-license (signed-registry validator)                                                           |

## What's inside

| Dir         | Contents                                                       |
| ----------- | -------------------------------------------------------------- |
| `commands/` | `/bs:*`, `/gh:*`, `/cc:*` core commands                        |
| `skills/`   | Quality, testing, dev hygiene, build-quality, recovery, scrub  |
| `agents/`   | 8 SWE specialist agents (see table above)                      |
| `scripts/`  | Hooks, lint, branch-protection, quality-target-resolver, setup |
| `config/`   | Generic `CLAUDE.md` and `settings.json` templates              |

## Quick start

```bash
git clone https://github.com/buildproven/claude-kit.git ~/Projects/claude-kit
cd ~/Projects/claude-kit
./install.sh
```

Then restart Claude Code.

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

### Removed — Claude Code now does these natively

Don't reimplement what the platform ships. As of 2.1.207:

| Was             | Use instead                                                          |
| --------------- | -------------------------------------------------------------------- |
| `/bs:cost`      | `/usage` — per-category cost (skills, subagents, plugins, per-MCP)   |
| `/gh:review-pr` | `/code-review ultra` — cloud multi-agent review, `--comment`/`--fix` |
| `/cc:optimize`  | `/usage` + `fallbackModel` + `/effort`                               |

## Skills

Auto-invoke skills triggered by natural-language requests:

- `quality` — autonomous quality loop with tier classification + Codex cross-review
- `healthcheck` — session-start health (MCP servers, repo sync, gateway)
- `recover` — crash and state recovery
- `cleanup` — system resource cleanup
- `scrub` — prep for open source / giveaway / commercial sale
- `test-strategy` — test coverage planning
- `error-handling` — consistent error patterns
- `api-conventions` — API design standards
- `cost`, `deps`, `status`, `workflow` — dev hygiene
- `frontend-design` — distinctive frontend interfaces (Apache 2.0)
- `ui-reviewer` — UI/UX design review
- `webapp-testing` — Playwright-based webapp testing (Apache 2.0)
- `visualise` — inline SVG/HTML/chart visualizations

Just ask: `"Run the quality skill"`, `"Use the visualise skill to diagram this"`, etc.

## Agents

8 specialist SWE agents (invoked via the Task tool or directly):

- `code-reviewer` — full PR review for bugs, security, design
- `security-auditor` — OWASP, vulnerabilities, dependency audit
- `accessibility-tester` — WCAG 2.1 AA, screen reader, color contrast
- `architect-reviewer` — system design review
- `performance-engineer` — Lighthouse, bundle analysis, Core Web Vitals
- `postgres-pro` — query optimization, index design, Prisma
- `prompt-engineer` — AI-feature prompt optimization
- `refactoring-specialist` — safe test-driven refactoring

## Extend

See [EXTENSION-ARCHITECTURE.md](EXTENSION-ARCHITECTURE.md) for how to layer private commands and preferences on top without forking.

[claude-kit-pro](https://github.com/buildproven/claude-kit-pro) submodules this repo — upgrading is a one-line submodule swap, no manual copying.

## When you might want pro

If kit covers your workflow, you don't need pro. But pro adds two distinct categories of value:

1. **Autonomous workflow** — `/bs:ralph` runs your backlog unattended for hours. `/bs:strategy` fans questions across Claude+Codex+Gemini. `/bs:session` saves/resumes work across days. `/bs:sentry` auto-audits all your projects.
2. **Commercial intelligence** — `legal`, `market-validation`, `seo` (via DataForSEO), `monetize`, `review-content` skills. `business-panel-experts` agent synthesizes Christensen/Porter/Drucker/Hormozi/Kim & Mauborgne/Collins/Taleb/Meadows.

If you're a solo founder shipping multiple products, that's the value. Otherwise stick with kit.

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
