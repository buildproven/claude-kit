# Changelog

All notable changes to claude-kit are documented here.

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
