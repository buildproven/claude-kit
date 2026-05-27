---
name: deps
description: Dependency health — outdated packages, security audit, smart upgrades
triggers:
  - "outdated.*dep"
  - "outdated.*package"
  - "security.*audit"
  - "vulnerabilit"
  - "check.*dep"
  - "upgrade.*dep"
  - "npm.*audit"
---

You are running the `deps` skill. Execute all steps using your tools — do not print instructions, actually run them.

## 1. Parse arguments

Arguments: $ARGUMENTS

Extract:
- **repo paths**: any absolute or `~/…` paths. If none, use current working directory.
- **mode**: `--audit` (report only), `--upgrade` (update outdated), `--analyze` (bundle size). Default = fix audit vulns.

If multiple repo paths are given, process them in parallel using multiple agents or sequential Bash calls.

## 2. For each repo — detect package manager

Check for lock files: `pnpm-lock.yaml` → pnpm | `yarn.lock` → yarn | `package-lock.json` → npm. If none found, report and skip.

## 3. Execute the selected mode

### Default mode: audit fix

1. Run `npm audit --prefix <path>` (or pnpm/yarn equivalent). Note the vuln count.
2. If vulns exist, run `npm audit fix --prefix <path>`. Check if anything changed (`git -C <path> status --short`).
3. Re-run audit. If vulns remain that require `--force`:
   - Create a worktree: `git -C <path> worktree add <path>-deps-fix -b chore/deps-fix-$(date +%Y-%m-%d)`
   - In the worktree, run `npm audit fix --force`
   - Run tests: prefer `npm run test:fast` if available, else `npm test`. Exit 0 or 5 = pass.
   - If **tests pass**: `git add package.json package-lock.json` (or pnpm/yarn equivalents), commit with message `chore(deps): npm audit fix --force — resolve remaining vulnerabilities\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`, push branch, open PR.
   - If **tests fail**: do NOT commit. Report which test failed and which package broke it.
4. If the non-force fix produced changes: commit them to a branch (same worktree pattern), push, open PR.
5. If already clean: report "no vulnerabilities found".

### --audit mode: report only

Run `npm audit` and summarise: total vulns by severity, top 3 affected packages. Do not auto-fix.

### --upgrade mode: upgrade outdated

1. Run `npm outdated --prefix <path>` — list what's behind.
2. Run `npm update --prefix <path>` (safe semver-range upgrades only).
3. Run tests to verify.
4. If tests pass and lock file changed: create worktree branch, commit, push, open PR.

### --analyze mode: bundle size

Read `package.json`. If it contains `"next"`, print: `ANALYZE=true npm run build` and note they need `@next/bundle-analyzer`. Otherwise run `du -sh <path>/dist <path>/build <path>/.next 2>/dev/null` for a quick size snapshot.

## 4. Summary

After processing all repos, print a concise table:

| Repo | Action | Result | PR |
|------|--------|--------|----|
| … | … | … | … |

## Rules

- NEVER commit directly to main — always worktree + branch
- NEVER use `--no-verify`
- `npm outdated` exits 1 when packages are outdated — not an error
- `npm audit` exits 1 when vulns found — not fatal, continue
- Tests exit 5 = no tests collected = treat as pass
