# claude-power-kit

A curated public Claude Code toolkit for planning, implementation, quality, debugging, review, and repo hygiene.

This repo is the public framework, not a mirror of a private operator setup.

## What's inside

| Dir | Contents |
|-----|----------|
| `commands/` | Public `/bs:*`, `/gh:*`, `/cc:*`, and utility commands |
| `skills/` | General-purpose skill packs for quality, testing, APIs, docs, design, and workflow |
| `agents/` | Reusable review and specialist agents |
| `scripts/` | Hooks, validation, setup, sync, and quality automation |
| `config/` | Generic `CLAUDE.md` and `settings.json` defaults |
| `.github/workflows/` | CI and maintenance automation |

## Quick start

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/claude-power-kit.git ~/Projects/claude-power-kit
cd ~/Projects/claude-power-kit
./install.sh
```

Then restart Claude Code.

## Core commands

```text
/bs:dev
/bs:quality
/bs:test
/bs:plan
/bs:ralph
/bs:help
```

## What this repo is for

- daily coding workflow
- quality automation
- repo setup and hygiene
- reusable technical skills
- reusable review agents

## What this repo is not for

- private operator workflows
- company-specific posting, product, or growth commands
- internal service maintenance
- premium workflow packs

Those belong in private or paid extensions, not in the public core.

## Automation included

- Pre-commit hooks for quality and safety
- Auto-branch protection against accidental work on `main`
- Post-edit linting and stop validation
- CI quality gates
- Trunk-based maintenance automation

## Extend

See [EXTENSION-ARCHITECTURE.md](EXTENSION-ARCHITECTURE.md) for how to add personal preferences, private commands, and project-specific workflows on top of the public core without forking it.

## Customize

1. Copy `config/CLAUDE.md` and tune it to your preferences.
2. Edit `config/settings.json` for permissions, hooks, and model routing.
3. Add your own commands, skills, or agents on top of the public baseline.
