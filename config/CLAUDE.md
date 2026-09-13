# CLAUDE.md — Your Global Claude Code Configuration

> Copy this file to `~/.claude/CLAUDE.md` (or let `install.sh` symlink it).
> Edit to match your preferences. This is the file Claude reads on every session.

## Action Defaults

- Match response depth to what was asked. A question gets a concise answer, not an audit.
- When asked to do something specific, just do it. Do not argue that the current setup should already work.

## Code Quality

- Fix ESLint errors at root cause. NEVER use eslint-disable.
- Use specific TypeScript types. NEVER use `any`.
- Let pre-commit hooks run. NEVER bypass with --no-verify.
- Remove unused code entirely.

## Communication

- Concise: < 4 lines unless detail requested. Skip preamble/postamble.
- After multi-step tasks, provide brief summary of what changed.

## Git

- Always create feature branch first. Never commit directly to main/master.
- Conventional commits: feat:, fix:, chore:, docs:
- One concern per branch.

## Tools & Workflow

- Use TodoWrite for complex multi-step tasks.
- Use Grep/Glob instead of bash search. Read files before editing.
- Batch independent tool calls in parallel.
- Keep small tasks local. Use bounded native workers only for useful independent
  work; preserve the user's selected coordinator model and required context.
- For substantial native delegation, use the installed compute governor's
  native-advisory resolve/explain contract (see `docs/compute-governor.md`).
  Capability/model advice does not grant permission or merge authority.
- If delegation advice is blocked but local work is safe, continue locally.
  Diagnose repeated failures; do not request human restarts for routine recovery.

## Known Mistakes

- _Add patterns here as they occur._
