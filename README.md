# claude-power-kit

A battle-tested Claude Code setup — 45+ commands, 20+ skills, quality automation, hooks, and CI gates.

Born from daily production use. Updated automatically from the private source repo.

## What's inside

| Dir | Contents |
|-----|----------|
| `commands/` | `/bs:*`, `/gh:*`, `/cc:*` slash commands |
| `skills/` | Auto-injected skill context files |
| `agents/` | Reusable agent prompt templates |
| `scripts/` | Automation scripts (hooks, lint, CI) |
| `config/` | `settings.json` with hooks, permissions, model routing |
| `.github/workflows/` | Quality gates, auto-release, stale cleanup |
| `eslint-plugin-defensive/` | Custom ESLint rules for safe code patterns |

## Quick start

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/claude-power-kit.git ~/Projects/claude-power-kit
cd ~/Projects/claude-power-kit
./install.sh
```

Then restart Claude Code.

## Key commands

```
/bs:dev        Start feature development
/bs:quality    Run full quality loop before merge
/bs:ralph      Autonomous backlog execution
/bs:strategy   Multi-model strategy panel
/bs:help       All commands with descriptions
```

## Automation included

- **Pre-commit hooks** — lint, conventional commits, secret scan
- **Stop hook** — validates output quality (no `console.log`, `TODO`, `any`, `debugger`)
- **Auto-branch hook** — never accidentally commit to main
- **CI quality gate** — risk-tiered checks on every PR
- **Stale branch/PR cleanup** — enforces trunk-based development

## Customise

1. Copy `config/CLAUDE.md` and fill in your preferences
2. Edit `config/settings.json` to adjust permissions and hooks
3. Add your own commands in `commands/`

## Updates

This repo is auto-synced from source. Star it to get notified of improvements.
