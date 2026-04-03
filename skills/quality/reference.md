# Quality Reference — Flags, Scopes, Levels, and Modes

## Flags

| Flag              | Default | Description                             |
| ----------------- | ------- | --------------------------------------- |
| `--level N`       | 95      | Quality level (95 or 98)                |
| `--scope S`       | branch  | Scope: changed, branch, all             |
| `--merge`         | false   | Auto-merge PR after quality             |
| `--skip-ci`       | false   | Bypass CI checks                        |
| `--skip-rebase`   | false   | Skip auto-rebase                        |
| `--status`        | false   | Show quality history and exit           |
| `--verbose`       | false   | Show trends with `--status`             |
| `--audit`         | false   | Read-only assessment                    |
| `--deep`          | false   | 6-agent deep review (with `--audit`)    |
| `--dry-run`       | false   | Preview without modifying               |
| `--fix`           | false   | Auto-fix common issues (with `--audit`) |
| `--json`          | false   | Machine-readable output                 |
| `--coverage-diff` | false   | Show per-file coverage changes          |
| `--skip-docs`     | false   | Skip doc sync check                     |
| `--teams`         | false   | Use agent teams (tmux visibility)       |
| `--no-teams`      | -       | Force Task subagents (default)          |
| `--no-codex`      | false   | Skip Codex cross-review                 |
| `--skip-tests`    | false   | Skip hard test gate (config-only repos) |
| `--preflight`     | false   | Quick readiness check (<10 sec)         |

### Environment Variables

| Variable        | Default | Description                                     |
| --------------- | ------- | ----------------------------------------------- |
| `CODEX_TIMEOUT` | 120     | Seconds to wait for Codex cross-review (0=skip) |

## Scope Options

### `--scope changed` (Quick)

- Time: 2-5 min
- Checks uncommitted changes only
- Runs lint, type-check, tests on changed files
- Skips quality agents — automated checks sufficient
- Auto-commits with smart message

### `--scope branch` (Default)

- Time: 30-60 min
- All files changed in branch vs main
- Full quality agents on changed files
- Creates PR after quality passes

### `--scope all` (Full Project)

- Time: 45-90 min
- Every file in the project
- Full quality agents on entire codebase
- For major refactors, pre-release audits

## Quality Levels

### Level 95 (Default — Ship-Ready)

- 6 quality agents
- For feature development, bug fixes, iteration

### Level 98 (Comprehensive — Production-Perfect)

- 10 agents (Phase 1: 7, Phase 2: 3)
- Adds: code-simplifier, accessibility-tester, performance-engineer, architect-reviewer
- Requires at least `--scope branch` (not compatible with changed)
- For production launches, customer-facing features

## Deep Review Mode (`--audit --deep`)

Spawns 6 agents in parallel:

| Agent                 | Focus                           | Return Format       |
| --------------------- | ------------------------------- | ------------------- |
| code-reviewer         | Bugs, logic errors, code smells | JSON findings array |
| silent-failure-hunter | Empty catches, swallowed errors | JSON findings array |
| type-design-analyzer  | Any abuse, weak generics        | JSON findings array |
| security-auditor      | OWASP top 10, secrets           | JSON findings array |
| performance-engineer  | N+1, memory leaks               | JSON findings array |
| architect-reviewer    | Tech debt, patterns             | JSON findings array |

After completion:

1. Display agent summary table
2. If `--dry-run=false`: create Linear issues for findings via mcp**linear**create_issue
3. If `--dry-run=true`: preview without modifying

## Teams Mode (`--teams`)

Uses agent teams instead of Task subagents. Provides:

- tmux split-pane visibility
- Cross-reviewer communication
- Coordinated retry on failures

Best for `--level 98` or `--scope all` (10+ min runs). Task subagents are faster for quick runs.

## Merge Flow (`--merge`)

1. Push branch, create PR
2. Wait for CI (unless `--skip-ci`)
3. Auto-merge via `gh pr merge --squash`
4. Manually verify the deployed system using your normal deployment tooling

## Next-Step Suggestions (CS-046)

After quality completes:

- `--merge`: "Run `/clear` then `/bs:dev` for next feature"
- Failed: "Run `/debug` to investigate"
- `--audit`: "Run `/bs:quality` to fix issues found"
