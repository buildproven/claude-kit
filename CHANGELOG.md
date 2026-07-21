# Changelog

All notable changes to claude-kit are documented here.

## Unreleased

### Added

- The revision-bound quality engine now supports opt-in Gemini review as a
  bounded, read-only primary or fallback provider. Gemini responses use the
  same strict structured-review schema, provider circuit, attempt governor,
  artifact inventory, and fail-closed merge evidence as Claude and Codex
  (#139).

## [4.1.0] - 2026-07-19

### Added

- Tool-agnostic provider parity for Codex and Claude Code across the quality
  workflow (#121).
- Campaign telemetry recorder for quality runs (#115).
- Repo-context-aware critical gate with an always-human review floor (#128).
- Strengthened engineering and UI design disciplines in shared skills (#105).
- Review depth now routes by task type instead of a single fixed policy (#133).
- Unified worktree lifecycle management (#131).

### Changed

- Quality provider health probing now detects an unwinnable Codex cache and
  skips straight to fallback instead of stalling (#124).
- Quality CI jobs consolidated to eliminate per-job round-up overhead (#123).
- Default Codex skill surface trimmed to reduce install footprint (#102).
- Risk-change-nature detection extracted into a single shared module so
  fail-open channels can't diverge between call sites (#113, #114).

### Fixed

- Concurrent quality review runs now converge instead of racing to
  inconsistent verdicts (#98).
- Review verdict consistency enforced across providers (#103).
- Quality reviews are bounded to avoid runaway cost (#104).
- Merge state is isolated per revision, closing a cross-run leak (#100).
- Final evidence gaps in the quality gate closed (#110).
- `stop-validation.sh` no longer crashes in bare repositories (#112).
- Codex clean prose verdicts are accepted instead of blocking merges (#119).
- Removed a `-a` flag from `codex exec` invocations that Codex no longer
  supports (#116).
- Quality falls back to the secondary provider on review timeout (#120).
- Merges on unprotectable bases are no longer blocked; N/A SOTA scores are
  excluded from scoring (#126).
- Plugin manifest YAML with a colon-bearing description is now quoted
  correctly, with CI validation added to catch regressions (#127).
- Rename risk detection and failure recovery made actionable instead of
  silently degrading (#129).
- Quality campaigns are now durable and failure-aware across interruptions
  (#117).
- Validated CI billing waivers are now honored instead of blocking merges
  (#134).
- Gemini provider support is now opt-in and diagnosable instead of silently
  misconfigured (#130).
- CI is now validated on unprotectable repos instead of being skipped (#138).
- A recursive temp-cleanup trap that could delete unintended paths was
  removed (#107).
- Vitest global timeout raised to fix parallel-load flakes (#118).
- Changelog helper now resolves beside the gate it documents (#106).

### Security

- `notify` now passes text as an argv element instead of interpolating it
  into an AppleScript string, closing an AppleScript injection vector (#122).

## [4.0.1] - 2026-07-16

### Fixed

- Active-repository discovery now maps GitHub repositories only to primary
  checkouts, never to ephemeral linked worktrees with the same remote.

## [4.0.0] - 2026-07-16

### Added

- Native Codex Agent Skills installation from a curated allowlist, with drift
  checking and the same canonical instructions used by Claude Code.
- A provider-neutral runner and shared policy for Codex-primary, Claude-primary,
  explicit fallback, typed quota/authentication/timeout failures, and bounded runs.
- Active-repository fleet discovery and convergence auditing, plus isolated
  worktree repair mode through the repository's normal PR quality workflow.
- Declarative MCP parity tooling for Claude Code and Codex, including forced
  convergence and separate OAuth login.
- A command/skill surface audit with an explicit public command budget.

### Changed

- Overnight loop engineering now uses the shared provider policy instead of
  hardcoding Claude Code.
- Twelve redundant command wrappers were removed. Their durable skills remain
  available where they are useful; internal implementation skills are hidden from
  user menus with `user-invocable: false`.
- Steward state moved out of the repository into the XDG state directory.
- The distributed plugin and marketplace manifests now match v4.0.0, and the
  duplicate standard hooks declaration was removed so fresh installs load cleanly.

## [3.2.0] - 2026-07-15

### Changed

- Removed the lightly modified vendored `webapp-testing` skill; Anthropic's upstream
  repository is now the canonical maintained source.
- Documented the substantial modifications and Apache-2.0 attribution for
  `frontend-design`; all other kit content remains MIT.
- Made plugin installs resolve the inline-list parser and ensemble runner through
  `CLAUDE_PLUGIN_ROOT`.
- Raised the supported runtime floor to Node 24 LTS and committed the npm lockfile
  for reproducible `npm ci` builds.
- Upgraded the lint and commit toolchain, including ESLint 10 compatibility for
  the bundled defensive rules.

### Security and quality

- Added sandbox credential and metadata-network protections while using Claude
  Code's guarded `auto` permission mode.
- Promoted the tested destructive-path hook from the private overlay into the
  public kit and wired it before every Bash tool call.
- Made Semgrep findings fail CI, added license enforcement and a pre-push security
  gate, and enabled weekly dependency and GitHub Actions updates.
- Removed destructive stale-branch automation and two dead private-only scripts.
- Corrected SOTA scoring for sandbox networking, skill frontmatter, CI security,
  plugin-native paths, git hooks, and opt-in OpenTelemetry.
- Added direct tests for every published defensive ESLint rule and hardened JSX
  handler analysis against namespaced and short prop names.

## [3.1.0] - 2026-07-13

The kit stops doing things to your repo that you didn't ask for.

### BREAKING — the hooks no longer mutate your working tree

**`session-start-context.sh` was force-deleting your branches.** On every session
start, in whatever repo you had open, it ran `git branch -D` on every branch whose
upstream was gone, and `git branch -d` on merged ones. No prompt, no opt-out — and
it was wired into the _recommended_ plugin install.

`-D` is a force delete. If a remote branch was deleted while you still had unpushed
local commits, those commits went with it. Install the plugin, open Claude in an
unrelated repo, lose work.

It now **reports** and deletes nothing:

> 🌿 Branches whose remote is gone: `feature` — review, then `git branch -D` if
> you're sure (they may hold unpushed commits).

Set `CLAUDE_KIT_AUTO_PRUNE=1` to restore the old behavior. Off by default.

**`auto-branch-on-main.sh` was switching your branch mid-edit.** On any Edit/Write
while on `main` it ran `git checkout -b feat/<filename>` in your tree — and if the
branch already existed, a bare `git checkout`, which carries uncommitted changes
across it. Every git call was `2>/dev/null`, so failures were invisible.

It now **denies with a message** telling you what to run (exit 2) — which is what
its own header always claimed it did, and what `block-commit-main.sh` already does.
Set `CLAUDE_KIT_ALLOW_MAIN_EDITS=1` to disable the hook.

### BREAKING — the quality gate now blocks on failing reviews

`BLOCKING_COUNT` was only ever interpolated into the `Reviewed-By` trailer text
(`findings=2`); it was never compared to zero. Every `MERGE BLOCKED` guard verified
the review _ran_ — none verified it _passed_. An attendance register, not an exam.

Unresolved BLOCKING findings now abort the merge.

Compounding it: `skills/quality/SKILL.md` was **17,394 tokens against a 5,000-token
compaction re-attach cap**, so the merge gates — which live late in the file —
silently ceased to exist after any compaction, i.e. in exactly the long sessions
where they matter most. The CI check for this was `continue-on-error: true`.

SKILL.md is now split (under 5,000 tokens) and `check-skill-size.sh` is a hard gate.

### BREAKING — defaults that surprised you

- **`fallbackModel` was Opus-first.** A stranger on a metered plan installed this and
  was billed at Opus rates by default. Now `claude-sonnet-5` → `claude-haiku-4-5`.
- **`alwaysThinkingEnabled: true`** forced extended thinking on for everyone.
  Thinking tokens are output tokens. Removed — that's your call, not the toolkit's.
- **`permissions.allow` blanket-allowed `mcp__*`**, i.e. every tool from every MCP
  server you might install. Removed.

### Fixed

- **`Bash(chown -R:*)` never fired.** Per the permissions docs, `:*` is only
  recognized at the _end_ of a pattern; a mid-pattern colon is a literal. So this
  prefix-matched the string `chown -R:` and matched nothing. A user read a deny rule
  that appeared to block recursive chown; it didn't.
- **The flaky detector counted a skipped test as a failure.** Any conditionally
  skipped test (env var, platform, missing binary) flipped pass↔fail between runs,
  got flagged flaky, and failed the run with exit 1 — a false-positive generator
  inside the false-positive detector. Also, its `flips` field reported the number of
  _runs_, not transitions.
- **`/bs:strategy` exited 0 with an empty report** when `acpx` (a binary named in no
  README, installed by nothing) was absent. It now fails loudly with an install
  pointer, and exits non-zero when every provider fails.
- **`/bs:backlog`, `/bs:dev --next` and `/bs:triage`** hard-required Linear/Sentry MCP
  servers with no detection and no message. They now say what's missing and stop.
- **Notification hooks ran raw `osascript`**, which does not exist on Linux/WSL — so
  the hook exited 127 on every permission prompt, every idle prompt and every agent
  completion. Replaced with `scripts/notify.sh` (osascript / notify-send / silent).
- Removed a vendored third-party **facebook-mcp-server** and a `.env.template` of 20
  social-media credentials, neither read by any shipped command.
- Removed maintainer-only references — `keyflash`, `BUI-*` ticket IDs, private doc
  paths, and one instruction to obtain "written permission from Brett" — that
  `CONTRIBUTING.md` itself forbids.

### Added

- **Coverage 64.76% → 87.94%** (312 tests, up from 237). The gap was worst in the
  differentiated part: `risk-score.js` (62% → 84%) and the run governor's `bumpRound`
  — the round cap that terminates the fix→re-review loop — which had **no tests at
  all** despite its whole safety property being that it fails closed.
- Regression tests that pin the three failures above: a real `: gone]` branch holding
  an unpushed commit must survive; `BLOCKING_COUNT` must be _compared_, not merely
  interpolated; SKILL.md must stay inside the compaction budget.
- A **Prerequisites** section in the README. There wasn't one.

### Changed

- `requiredMinimumVersion` 2.1.198 → 2.1.207.
- `requiredMinimumVersion` 2.1.207 → 2.1.210 for the latest worktree and
  destructive-path safety fixes.

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

### Changed — tightened default Bash permissions (BREAKING)

`config/settings.json` listed a bare `"Bash"` in `permissions.allow`, which
auto-approved **every** shell command and effectively neutered the `deny` and `ask`
rules below it. Removed. The allow-list now only covers the specific read-only
patterns (`Bash(**/grep *)`, `Bash(**/cat *)`, …).

Expect prompts for Bash commands that previously ran unprompted. That is the point —
widen the allow-list in your own `~/.claude/settings.json` if you want it back.

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
