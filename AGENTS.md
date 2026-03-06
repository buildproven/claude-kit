# Repository Guidelines

## Project Structure & Module Organization

- Source of truth lives here; `scripts/setup-claude-sync.sh` symlinks to `~/.claude`—never edit the symlinked copies.
- Key paths: `config/settings.json` (permissions/model), `config/CLAUDE.md` (global prefs), `templates/CLAUDE.md.template` (generation), `commands/bs/*.md` (bs command prompts), `agents/*.md` (role configs), `skills/` (skill specs), `mcp-servers/` (MCP templates), `docs/PREFLIGHT_SPEC.md`, `BACKLOG.md`, `data/` + `logs/` (runtime artifacts).
- Add scripts to `scripts/` (bash), commands to `commands/bs/` (lowercase kebab filenames, `/bs:` prefix inside), and agents to `agents/` following role/goal/style blocks used by `code-reviewer`, `security-auditor`, etc.

## Build, Test, and Development Commands

- `./install.sh` — bootstrap or refresh this setup on a machine.
- `./scripts/setup-claude-sync.sh --check|--repair` — verify/fix symlinks into `~/.claude`.
- `./scripts/ai-cli-cleanup.sh --dry-run|--aggressive` — clear caches for Claude/Codex/Gemini/Cursor/Node; dry-run before aggressive.
- MCP/skills: `./scripts/setup-mcp.sh --list|--remove`, `./scripts/setup-skills.sh` (social MCP servers registered by `setup-claude-sync.sh`).
- Prompt sync: `./scripts/sync-ai-prompts.sh`, `./scripts/sync-codex-prompts.sh`, `./scripts/sync-gemini-prompts.sh` keep command/agent prompts consistent.
- Social scheduling: Use `/bs:post --schedule` or `/bs:post --schedule-week` (GitHub Actions dispatcher).

## Coding Style & Naming Conventions

- Bash: `set -euo pipefail`, 4-space indents, small `log_*` helpers with emoji/status prefixes; keep commands idempotent and `$HOME/Projects/claude-setup`-safe.
- Markdown: concise headings, short bullets, `bash` fences for commands, aligned tables; reference commands as `/bs:<command>`.
- Avoid secrets or machine-specific paths; document required env vars in headers or `docs/`.

## Testing Guidelines

- No formal test suite; rely on script check modes (`setup-claude-sync.sh --check`, `ai-cli-cleanup.sh --dry-run`, `setup-mcp.sh --list`).
- Run `shellcheck scripts/<file>.sh` locally when touching bash to catch portability issues.
- After prompt edits (commands/agents/templates), run the relevant sync script and spot-check rendering in Claude Code.

## Commit & Pull Request Guidelines

- Use Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, etc.) as in the log.
- PRs should call out scope and touched areas (`commands/`, `agents/`, `config/`, `scripts/`) plus verification steps (checks/dry-runs/shellcheck).
- If prompt or template changes were synced, note which sync script ran; include command outputs over screenshots unless UI assets changed.

## Security & Configuration Tips

- Treat `config/settings.json`, `config/CLAUDE.md`, and token references as sensitive; never commit secrets or personal paths.
- Always edit in this repo, then re-run `setup-claude-sync.sh --repair` after path changes to keep symlinks correct.
- When adding MCPs/skills, document required env vars in headers or `docs/`; avoid committing generated caches/binaries unless required.

## Agent Catalog (14 agents)

Use agents via the Task tool with `subagent_type` parameter.

| Agent                    | Purpose                                                                          | Use When                                                       |
| ------------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `accessibility-tester`   | WCAG 2.1 AA compliance, screen reader testing, keyboard navigation               | Before launch, compliance audits                               |
| `architect-reviewer`     | System design evaluation, architectural patterns, technical decisions            | Scalability/maintainability concerns, major structural changes |
| `business-panel-experts` | Multi-expert business strategy panel (Christensen, Porter, Drucker, Godin, etc.) | Strategic decisions, positioning, market analysis              |
| `code-reviewer`          | Code quality, security vulnerabilities, best practices                           | After writing/modifying code                                   |
| `command-creator`        | Create new Claude Code commands with proper structure                            | Adding new slash commands                                      |
| `competitive-analyst`    | Market positioning, competitor analysis, differentiation strategy                | Market research, positioning decisions                         |
| `critic`                 | Identify risks, blind spots, alternative approaches                              | Contrarian perspective on technical decisions                  |
| `github-issue-fixer`     | Analyze, plan, and implement fixes for GitHub issues                             | Fixing specific GitHub issues                                  |
| `performance-engineer`   | Lighthouse scores, bundle analysis, Core Web Vitals, database optimization       | Performance issues                                             |
| `postgres-pro`           | Query optimization, index design, schema design, Prisma optimization             | Database performance                                           |
| `prompt-engineer`        | Prompt optimization for AI features, reduce token usage                          | AI feature development                                         |
| `refactoring-specialist` | Safe code transformation, technical debt reduction                               | Code restructuring, complexity reduction                       |
| `security-auditor`       | OWASP top 10, dependency vulnerabilities, auth flows, secrets scanning           | Security review                                                |
| `seo-specialist`         | Meta tags, structured data, Core Web Vitals, keyword optimization                | Before launch, SEO audits                                      |

**Example usage:**

```bash
# In Claude Code, use Task tool:
Task tool → subagent_type: "code-reviewer" → prompt: "Review the auth module"
```
