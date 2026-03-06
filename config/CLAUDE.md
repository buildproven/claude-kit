# Global Claude Code Configuration

## Action Defaults

- **80% rule**: If the user would >80% answer "yes" or "do it", just do it proactively. Never ask for confirmation on obvious next steps (push after commit, run tests after code, create branch before work, etc.). Only ask when the answer is genuinely uncertain.
- Match response depth to what was asked. A question gets a concise answer, not an audit.

## Code Quality (IMPORTANT -- enforce these)

- Fix ESLint errors at root cause. NEVER use eslint-disable -- it masks bugs.
- Use specific TypeScript types. NEVER use `any` -- it defeats TypeScript's purpose.
- Let pre-commit hooks run. NEVER bypass with --no-verify.
- Remove unused code entirely. Don't prefix with underscore.
- Resolve underlying issues, not symptoms. Quality over speed.
- Secrets go in environment variables only -- never in code, commands, or responses.
- Never commit .env files.

## Documentation (YOU MUST follow this)

- When code changes, update related docs in the SAME commit (README, CLAUDE.md, help commands, API docs).
- Never claim completion without evidence: test output, execution log, or explicit user confirmation.
- Encode lessons as tests or scripts, not MEMORY.md prose. Once codified, delete the memory entry.

## Communication

- Concise: < 4 lines unless detail requested. Skip preamble/postamble.
- After multi-step tasks, provide brief summary of what changed.

## Tools & Workflow

- Use TodoWrite for complex multi-step tasks.
- Use Grep/Glob instead of bash search. Read files before editing.
- Batch independent tool calls in parallel.
- Use EnterPlanMode for: complex architectural decisions with multiple valid approaches and genuinely uncertain scope.
- Audit MCP servers periodically -- unused servers waste context tokens.

## Conversation Efficiency

Reference: `~/Projects/claude-setup/CLAUDE_CODE_OPTIMIZATION_GUIDE.md`

- Use autonomous agents instead of manual review-fix-review loops.
- Break at natural boundaries: `/dev` -> code -> `/quality` -> `/clear` -> next feature.
- Aim for < 50 turns per session. Start fresh when context degrades.
- Two-correction rule: if you've corrected twice on same issue, `/clear` and restart.
- Delegate to agents: boilerplate, refactoring, test generation, code review, migrations.
- Work manually: exploratory design, novel architecture, taste-driven UI, creative writing.

## Git

- Always create feature branch first. Never commit directly to main/master.
- Conventional commits: feat:, fix:, chore:, docs:

## Config Management

- ALWAYS edit in `claude-setup/`, not `~/.claude/` (those are symlinks).
- Settings: `~/Projects/claude-setup/config/settings.json`
- Commands: `~/Projects/claude-setup/commands/`
- Shared .env: `~/Projects/claude-setup/.env`
