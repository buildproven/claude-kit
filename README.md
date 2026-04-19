# claude-kit

Free, open-source Claude Code toolkit. The baseline layer for planning, implementation, quality, debugging, and repo hygiene.

This repo is the public core. It is designed to be extended, not forked.

## Tiers

|                        | claude-kit (this repo) | [claude-kit-pro](https://github.com/buildproven/claude-kit-pro) |
| ---------------------- | ---------------------- | --------------------------------------------------------------- |
| **Price**              | Free                   | Paid                                                            |
| **Core commands**      | ✅                     | ✅ (superset)                                                   |
| **Autonomous agents**  | —                      | ✅ `/bs:ralph`, `/bs:strategy`                                  |
| **Session management** | —                      | ✅ `/bs:session`, `/bs:resume`                                  |
| **Backlog + planning** | —                      | ✅ `/bs:backlog`, `/bs:sota`, `/bs:sentry`                      |
| **Premium skills**     | —                      | ✅ frontend-design, seo, pdf, docx, xlsx, and more              |
| **All agents**         | 2                      | 15                                                              |

## What's inside

| Dir         | Contents                                          |
| ----------- | ------------------------------------------------- |
| `commands/` | `/bs:*`, `/gh:*`, `/cc:*` core commands           |
| `skills/`   | Quality, testing, error-handling, API conventions |
| `agents/`   | code-reviewer, security-auditor                   |
| `scripts/`  | Hooks, lint, branch-protection, setup automation  |
| `config/`   | Generic `CLAUDE.md` and `settings.json` templates |

## Quick start

```bash
git clone https://github.com/buildproven/claude-kit.git ~/Projects/claude-kit
cd ~/Projects/claude-kit
./install.sh
```

Then restart Claude Code.

## Core commands

```text
/bs:dev       Start a feature with complexity-appropriate planning
/bs:quality   Autonomous quality loop (tests, security, review)
/bs:test      Run tests with auto-detected framework
/bs:hotfix    Emergency production fix workflow
/bs:plan      Structured spec before complex work
/bs:new       Bootstrap a new project
/bs:help      Full command reference
/bs:workflow  Daily workflow guide
/bs:sync      Verify and repair config symlinks
/bs:read      Extract insights from any article or doc
/bs:status    Branch and recent commit summary
/bs:cleanup   Clean AI CLI caches and temp files
```

## Skills (7 included)

Ask Claude naturally — `"Run the quality skill"`, `"Use error-handling skill"`

- `quality` — autonomous quality loop
- `test-strategy` — test coverage planning
- `error-handling` — consistent error patterns
- `api-conventions` — API design standards
- `recover` — crash and state recovery
- `cleanup` — cache and temp file cleanup
- `healthcheck` — MCP and session health

## Extend

See [EXTENSION-ARCHITECTURE.md](EXTENSION-ARCHITECTURE.md) for how to layer private commands and preferences on top without forking.

claude-kit-pro submodules this repo — upgrading is a one-line submodule swap, no manual copying.

## Customize

1. Copy `config/CLAUDE.md` and tune it to your workflow.
2. Edit `config/settings.json` for permissions, hooks, and model routing.
3. Add your own commands, skills, or agents in a private overlay repo.

## License

MIT
