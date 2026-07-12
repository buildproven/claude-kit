# Changelog

All notable changes to claude-kit are documented here.

## [3.0.0] - 2026-07-12

The paid tier is gone. claude-kit is now the whole thing, free and MIT.

### Changed — claude-kit-pro folded in and archived

Anthropic shipped the orchestration layer natively (workflows, background agents,
agent teams), which is most of what the paid tier sold. Keeping a middle tier that
duplicated the platform stopped making sense, so `claude-kit-pro` was folded into
this repo and archived on 2026-07-11. Everything it had — quality, ralph, strategy,
sota, steward, review, backlog, the domain skills, all 14 agents — is here, MIT.

The old three-tier chain (setup → kit-pro → kit) is collapsed. There is no "core
layer" and no "pro"; there is just the kit.

### Fixed — the installer was silently broken

`install.sh` symlinked `commands/`, `skills/` and `agents/` into `~/.claude/` but
**not `scripts/`** — while `config/settings.json` wires 14 hooks to
`$HOME/.claude/scripts/*.sh`. Every hook (including the `block-push-main` and
`block-commit-main` safety rails) silently no-opped for anyone who installed from a
clean clone. One missing word in a `for` loop.

- `install.sh`: link `scripts/` as well (#—)
- `scripts/setup-claude-sync.sh`: **added**. Six files referenced this script and it
  did not exist; `/bs:sync`, whose entire job is repairing symlinks, invoked it. It
  now exists, links all four directories, and verifies every hook named in
  `settings.json` actually resolves. `--check` exits non-zero when they don't.
- `skills/ralph/SKILL.md`: `SCRIPT` was built from `$SETUP_REPO`, a variable that is
  never set — so ralph's runner path resolved to `/scripts/ralph-next-run.sh` and
  failed for everyone. Now resolved through the standard candidate chain.
- `commands/bs/sync.md`: same `$SETUP_REPO` bug.

### Fixed — hardcoded maintainer-only paths

`skills/quality/SKILL.md` and `skills/ralph/SKILL.md` fell back to
`$HOME/Projects/products/claude-kit/...`, a path that exists on exactly one machine.
Removed; the chain now ends at `$HOME/.claude/scripts/`, which the installer creates.
This is the rule CONTRIBUTING.md already stated and the repo was violating.

### Fixed — CI hostile to contributors

- `.github/workflows/cascade-to-pro.yml`: **removed**. It fired on every push to
  main, dispatching to `claude-kit-pro` — now archived and private. It failed every
  time, leaving a permanent red ✗ on the repo homepage, and advertised a private repo.
- `.github/workflows/stale-prs.yml`: this auto-closed **any** PR after 48 hours. It is
  a solo-maintainer discipline hack and it was pointed at the public: a first-time
  contributor opening a PR on Friday would have it closed by Sunday. Now scoped to
  PRs explicitly labelled `maintainer`; community PRs are invisible to it.

### Fixed — dangling command references

`/bs:post`, `/bs:maintain`, `/bs:resume` and `/bs:context` were referenced in shipped
docs but ship in no version of the kit (the first two are private; the latter two were
removed). `/bs:workflow` — the guide the README points newcomers at — told them to run
commands that do not exist. All 44 referenced `/bs:*` commands now resolve.

### Fixed — version skew

`plugin.json` said 3.0.0, `package.json` said 1.2.1, the latest tag said v2.2.0.
Now uniformly 3.0.0.

## [1.2.1] - 2026-05-17

### Fixed

- `commands/bs/quality.md`: removed an unsafe cleanup-cron example that suggested a periodic find-and-delete rooted at the `$TMPDIR` variable. Even bounded by `-name` and `-mtime` filters, deleting through a shell-resolved path matches the dangerous-pattern rule documented in CLAUDE.md (filesystem-safety policy, 2026-04-19 incident). The OS reclaims `$TMPDIR` on its own schedule, so no user-level cron is needed (#42).

## [1.2.0] - 2026-05-16

### Repositioned

claude-kit is now positioned as a **complete OSS Claude Code toolkit**, not "the free core layer that pro extends." Most devs won't need anything beyond it. Pro (claude-kit-pro) is a different category — autonomous workflow + commercial intelligence + license enforcement — not "more features."

The full kit↔pro de-duplication arc landed across 5 PRs (#36–#40). Items that weren't truly commercial or pro-only moved into kit:

### Added

- **`quality` skill — full body absorbed from pro** (#36): tier classification (`--level auto`, `harness-config.json` risk routing), Codex cross-review (`--codex-effort`, `--codex-skip`, `--no-codex`), break-glass approval for critical tier, agent panel mapping, `--background`/`--wait` flags, full `--target-dir` PR/branch/worktree resolver. Was previously a forked pro-only superset; now lives in kit canonically. `reference.md` and `checklist.md` also added (kit was missing both).
- **`scripts/quality-target-resolver.js`** (410 lines) + **32 tests** (#36) — full PR / branch / worktree-path resolution moved from the claude-setup overlay so kit-only users get the full target resolver, not just the legacy `--target-dir` parser.
- **`skills/healthcheck`: `model: haiku` frontmatter** (#36).
- **Basic-hygiene skills** (#37): `cost`, `deps`, `status`, `workflow` skills + `bs:cost`, `bs:deps` commands. License gates stripped on the kit copies. Pro's overrides deleted.
- **Sticky-funnel skills** (#38): `frontend-design` (Apache 2.0, Anthropic-original), `ui-reviewer` (Brett-authored), `webapp-testing` (Apache 2.0, Anthropic-original Playwright toolkit), `visualise` (Brett-authored). LICENSE.txt files preserved on the Apache 2.0 skills.
- **6 generic SWE agents** (#39): `accessibility-tester`, `architect-reviewer`, `performance-engineer`, `postgres-pro`, `prompt-engineer`, `refactoring-specialist`. Joining the existing 2 (`code-reviewer`, `security-auditor`) for **8 total SWE agents**.
- **2 dev-hygiene commands** (#39): `bs:investigate`, `bs:init-project`. License gates stripped.
- **README rewritten** (#40): 15-row tier comparison table, lists all 14+ skills with one-liners, dedicated Agents section, "When you might want pro" section that honestly tells readers when they don't need pro.

### Fixed

- **Drift hazard for 5 duplicated items eliminated** (#36): `skills/quality`, `skills/healthcheck`, `skills/recover`, `agents/code-reviewer`, `agents/security-auditor` had been forked between kit and pro with 782 lines of divergence on quality alone. Kit absorbed pro's canonical versions and pro deleted its copies.

### Changed

- **`tests/__tests__/quality-target-resolution.test.js`** runs under Vitest as part of the standard suite (32 tests, all green).

## [1.1.0] - 2026-05-15

### Added

- **`scrub` skill** — `/bs:scrub` is now backed by `skills/scrub/SKILL.md` and auto-invokes on natural language ("prep this for open source", "scrub for release", "clean before publishing", "prep for giveaway", "prepare commercial release"). The 334-line implementation moved from a top-level command file into a proper Skill, matching the same pattern used by `/bs:quality`, `/bs:ralph`, and `/bs:dev`. Slash-command users can still call `/bs:scrub` directly; the file at `commands/bs/scrub.md` is now a thin shim that invokes the skill.

### Fixed

- **`skills/scrub`: Phase 9 release block restored** — the original `commands/bs:scrub.md` had a `Phase 9: Version Bump + GitHub Release` step (auto-bumps `package.json`, tags, runs `gh release create`). It was missing from the initial skill conversion; restored verbatim so the documented end-to-end "scrub + cut release" flow works.
- **`skills/scrub`: hardened submodule deletion example** — the previous `git submodule deinit` walkthrough included a `rm -rf .git/modules/<path>` snippet that would trip the filesystem-safety hook. Rewrote to require explicit literal-path resolution, repo-boundary check, and user confirmation before any deletion.
- **`skills/quality`: persist git root through forked Bash blocks** — `--target-dir` now survives skill forks (#33).
- **`skills/quality`: arg propagation across fork boundary** — `$ARGUMENTS` now persists via a tempfile bridge (`--args-file`), so flags reach the forked skill reliably (#26).
- **`skills/quality`: auto-select scope+level from diff size and risk tier** (#30), with a coaching note when `--scope changed` is the right call for tiny critical/high-tier changes (#31).

### Removed

- **`commands/bs:scrub.md`** (top-level, colon-prefix variant) — superseded by `commands/bs/scrub.md` + `skills/scrub/`.

## [1.0.6] - internal

Version bumped in #32; no CHANGELOG entry written at the time. Covered by 1.1.0.

## [1.0.5] - internal

Tag without a CHANGELOG entry. Covered by 1.1.0.

## [1.0.4] - 2026-05-06

### Fixed

- Add the missing `.semgrep/defensive-patterns.yaml` config so `npm run security:scan:ci` works for release checks.
- Wire Husky `pre-commit` and `commit-msg` hooks to match the documented lint-staged and commitlint workflow.
- Tighten `knip.config.js` to the actual source layout so `npm run dead-code:strict` passes.
- Apply Prettier formatting to release-facing templates, `SECURITY.md`, `/bs:scrub`, and the agent dashboard server.

### Removed

- Remove unused `fast-check` dev dependency.

## [1.0.2] - 2026-04-19

### Fixed

- **`skills/quality/`**: remove Codex Cross-Review section (requires paid ChatGPT subscription — belongs in claude-kit-pro). Fix acpx 0.5.3 syntax in the Parallel Sub-Review block — the old syntax (`acpx claude exec --no-wait`, `acpx status`, `acpx output`) had not worked since acpx 0.5.3, so `/bs:quality --parallel` silently fell back to sequential. Now uses the correct `sessions new` → `prompt --no-wait` → `sessions read` flow with history-based completion detection.
- **`commands/bs/dev.md`**: remove `--alt` Second Opinion mode (Codex-based, paid tier).
- **`skills/quality/reference.md`**: drop `--no-codex` flag and `CODEX_TIMEOUT` env var.
- **`skills/quality/checklist.md`**: drop the "Claude AND Codex" confidence-boost line.

### Removed

- **`scripts/risk-policy-gate.js`** (+ its tests, stryker config, and the Harness Policy Gate workflow). The scrub that created v1.0 removed the required `harness-config.json`, leaving an always-failing workflow on every PR. `quality.yml` is the primary CI gate.
- **`mcp-servers/dataforseo-mcp-server/dist/`** — 380K of compiled 3rd-party JS with no source, LICENSE, or attribution. Free-tier users cannot use it anyway (needs paid DataForSEO credentials).
- **`mcp-servers/twitter-mcp-server/`** — only a rate-limit cache file, no source/LICENSE.
- **`scripts/run-dataforseo-mcp.sh`** — now-orphan wrapper.
- **Stryker mutation testing**: config + package.json scripts + deps. Only mutated the removed `risk-policy-gate.js`.

### Added

- **Pull-request CI**: `quality.yml` now triggers on `pull_request` (lint-and-format + test jobs). Previously PRs had zero automated CI after the Harness Policy Gate workflow was removed.
- **`.defensive-patterns.json`**: exclusion config for `eslint-plugin-defensive/` (self-referential false positives — its rule definitions contain the patterns they describe) and `mcp-servers/*/dist/`.

### Chore

- Prettier auto-format across 80 files (non-semantic — repo's existing prettier config applied).

## [1.0.1] - earlier

Initial public release cycle.

## [1.0.0] - 2026-04-12

Initial public release of claude-kit (renamed from claude-power-kit).
