# Claude Power Kit -- Agent Guidelines

## Project Structure & Module Organization

```
claude-power-kit/
  commands/                     # Slash commands (Markdown with YAML frontmatter)
    bs/                         # Primary prefix: 35+ commands (/bs:dev, /bs:quality, etc.)
    cc/                         # Claude Code commands (/cc:optimize, /cc:create-command)
    gh/                         # GitHub commands (/gh:review-pr, /gh:fix-issue)
    *.md                        # Root commands (/debug, /refactor, /update-claudemd, /open-source-prep)
  skills/                       # 19 skill directories, each with its own config
  agents/                       # 14 agent prompt templates (.md files)
  config/
    settings.json               # Claude Code settings (280+ permission rules)
    CLAUDE.md                   # Global instructions (symlinked to ~/.claude/CLAUDE.md)
  scripts/                      # Shell, JS, and Python utilities
    __tests__/                  # Script-level Vitest tests
  eslint-plugin-defensive/      # Custom ESLint plugin
    rules/                      # Individual rule implementations
    configs/                    # Plugin configurations
    index.js                    # Plugin entry point
  schemas/                      # JSON schemas
  templates/                    # Starter templates for new projects
  mcp-servers/                  # MCP server run scripts and configs
  tests/
    unit/                       # Fast, isolated tests
    integration/                # Cross-module tests
    e2e/                        # Smoke and browser tests
```

Package name: `claude-setup`. Node >= 20 (Volta-pinned to 20.11.1).

## Build, Test, and Development Commands

| Command               | What it does                                        |
| --------------------- | --------------------------------------------------- |
| `npm test`            | Run all Vitest tests (`vitest run`)                 |
| `npm run test:watch`  | Vitest in watch mode                                |
| `npm run lint`        | ESLint across the entire project                    |
| `npm run lint:fix`    | ESLint with auto-fix                                |
| `npm run format`      | Prettier -- write formatted output                  |
| `npm run format:check`| Prettier -- check only (used in CI)                 |
| `npm run test:patterns`| Run `scripts/pattern-check.sh --all`               |
| `npm run pattern-check`| Run `scripts/pattern-check.sh`                     |

### Pre-commit Pipeline

Husky triggers lint-staged on commit:
- `*.{js,jsx,mjs,cjs,html}` -- ESLint fix, then Prettier
- `*.{json,md,yml,yaml}` -- Prettier
- `*.sh` -- `bash -n` syntax check
- `package.json` -- Prettier

Commitlint enforces conventional commit types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. Subject max length: 100 characters.

## Coding Style & Naming Conventions

### JavaScript / TypeScript
- ESLint flat config (`eslint.config.cjs`) with `eslint-plugin-security`
- No `eslint-disable` -- fix the root cause instead
- No TypeScript `any` -- always use specific types
- `ecmaVersion: 2022`, `sourceType: module`
- Vitest globals (`describe`, `it`, `expect`, `vi`) are declared in ESLint config for test files

### Commands (Markdown)
- YAML frontmatter with `name:` field matching the filename
- Prefix convention: `bs:` default, configurable via `scripts/rename-prefix.sh`
- Cross-references between commands use `/prefix:name` format

### Shell Scripts
- `set -euo pipefail` at the top
- Must pass `bash -n` syntax check (enforced by lint-staged)
- Located in `scripts/`; tests in `scripts/__tests__/`

### File Naming
- Commands and agents: kebab-case `.md` files
- Skills: kebab-case directory names
- Scripts: kebab-case with appropriate extension (`.sh`, `.js`, `.py`)
- Tests: `*.test.js` or `*.spec.js`

### Git
- Feature branches only -- never commit directly to main
- Conventional commits enforced (see above)
- No `--no-verify` -- let pre-commit hooks run
- One concern per branch

## Testing Guidelines

### Framework
Vitest (`vitest run` / `vitest` for watch mode). Tests use explicit imports:

```js
import { describe, it, expect } from 'vitest'
```

### Test Organization
- `tests/unit/` -- fast isolated tests, no external dependencies
- `tests/integration/` -- cross-module interaction tests
- `tests/e2e/` -- smoke tests and browser automation (use `describe.skip` for stubs)
- `scripts/__tests__/` -- tests co-located with the scripts they cover

### Conventions
- One `describe` block per module or feature
- Use `it` (not `test`) for test cases
- No mocking unless necessary -- prefer testing real behavior
- Skip stubs with `describe.skip`, not empty test bodies
- Test file names mirror source: `risk-policy-gate.js` -> `risk-policy-gate.test.js`
