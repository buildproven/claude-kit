# Claude Power Kit

Professional Claude Code configuration kit. Package name: `claude-setup`. 35+ commands, 15+ skills, 18 agent prompts, custom ESLint plugin. 2-minute install via symlinks.

## Key Commands

```bash
npm test              # Vitest (unit + e2e)
npm run test:watch    # Vitest in watch mode
npm run lint          # ESLint (flat config, eslint.config.cjs)
npm run lint:fix      # ESLint with auto-fix
npm run format        # Prettier -- format all files
npm run format:check  # Prettier -- check only (CI)
npm run test:patterns # Run pattern-check.sh --all
npm run pattern-check # Run pattern-check.sh
```

Pre-commit: Husky + lint-staged runs ESLint, Prettier, and `bash -n` on `.sh` files.
Commits: commitlint enforces conventional commits (feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert). Subject max 100 chars.

## Architecture

```
claude-power-kit/
  commands/           # Slash commands (bs/, cc/, gh/, root-level .md)
    bs/               # Primary command prefix (35+ commands)
    cc/               # Claude Code meta-commands
    gh/               # GitHub workflow commands
    *.md              # Root commands (/debug, /refactor, etc.)
  skills/             # Auto-invoke and manual skills (19 directories)
  agents/             # Agent prompt templates (14 .md files)
  config/
    settings.json     # Claude Code settings (280+ permission rules)
    CLAUDE.md         # Global Claude instructions (symlinked to ~/.claude/)
  scripts/            # Shell/JS/Python utilities and hooks
    __tests__/        # Script-level tests (Vitest)
  eslint-plugin-defensive/  # Custom ESLint plugin (5 rules)
  schemas/            # JSON schemas (defensive-patterns)
  templates/          # Project templates (CLAUDE.md, strategy, ralph-dev)
  mcp-servers/        # MCP server configurations
  tests/
    unit/             # Unit tests
    integration/      # Integration tests
    e2e/              # End-to-end / smoke tests
```

## Install Mechanism

`install.sh` calls `scripts/setup-claude-sync.sh` which creates symlinks:

```
config/settings.json  ->  ~/.claude/settings.json
config/CLAUDE.md      ->  ~/.claude/CLAUDE.md
commands/             ->  ~/.claude/commands/
scripts/              ->  ~/.claude/scripts/
agents/               ->  ~/.claude/agents/
```

Always edit files in this repo, never in `~/.claude/` directly. Run `scripts/setup-claude-sync.sh --check` to verify health, `--repair` to fix broken symlinks.

## Conventions

- Node >= 20 (Volta pinned: 20.11.1, npm 10.2.4)
- ESLint flat config (CommonJS, `eslint.config.cjs`) with security plugin
- No `eslint-disable` comments -- fix at root cause
- No TypeScript `any` -- use specific types
- No `--no-verify` on commits -- let hooks run
- Conventional commits enforced by commitlint
- Tests use Vitest with `describe`/`it`/`expect` imports
- Commands use `bs:` prefix by default (configurable via `scripts/rename-prefix.sh`)
- One concern per branch, feature branches only (never commit to main)
- Update docs in the same commit as code changes
