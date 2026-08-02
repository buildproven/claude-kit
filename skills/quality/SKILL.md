---
name: quality
description: "Autonomous, revision-bound quality loop: deterministic gates, independent review, CI, and optional merge."
disallowed-tools: AskUserQuestion
---

# Quality Skill

Run autonomously from the exact `--manifest <path>` supplied by the wrapper;
reject every other argument. The manifest is the sole source of campaign state.
Never infer state from environment inheritance, session IDs, globbing, mtimes, or
a “latest” pointer. Never source or eval manifest content.

Campaign identity is deterministic for repository, PR, base, HEAD, scope, level,
and merge intent. An identical request resumes its evidence, deadline, attempts,
and terminal state. Changing provider order or retrying an unchanged HEAD cannot
mint budget. Workers are ephemeral (`--no-session-persistence` / `--ephemeral`)
and must obtain the same operator admission as Ralph before a new campaign.

Each fenced Bash block starts a fresh shell. Begin every executable block with
this resolver; it finds the installed runtime and fails closed when absent:

```bash
QUALITY_SCRIPTS_DIR="$(for d in "${CLAUDE_PLUGIN_ROOT:-}" "${CLAUDE_KIT_ROOT:-}" "$HOME/.claude" .; do [ -n "$d" ] && [ -f "$d/scripts/quality-runtime-dir.sh" ] && bash "$d/scripts/quality-runtime-dir.sh" 2>/dev/null && break; done)"
[ -n "$QUALITY_SCRIPTS_DIR" ] || { echo "quality runtime not found" >&2; exit 1; }
```

Use `reference.md` only when resolving flags, target paths, manifest schema,
budgets, or history. Read `checklist.md` before gates, findings, judge, or merge.
Those references are part of the policy, not optional background reading.

## Status

`/bs:quality status --manifest <exact-manifest-path>` is read-only. It validates
that exact manifest and prints repository-gate, provider, approval, and CI
diagnosis. Do not substitute a PR number or search for an invocation.

```bash
QUALITY_SCRIPTS_DIR="$(for d in "${CLAUDE_PLUGIN_ROOT:-}" "${CLAUDE_KIT_ROOT:-}" "$HOME/.claude" .; do [ -n "$d" ] && [ -f "$d/scripts/quality-runtime-dir.sh" ] && bash "$d/scripts/quality-runtime-dir.sh" 2>/dev/null && break; done)"
[ -n "$QUALITY_SCRIPTS_DIR" ] || { echo "quality runtime not found" >&2; exit 1; }
bash "$QUALITY_SCRIPTS_DIR/quality-status.sh" --manifest "<exact-manifest-path>"
```

## 1. Bootstrap, risk, and contracts

Load the rooted repository, then persist risk and select agents before any gate
or provider call. Fetch only the manifest fields a command needs.

```bash
QUALITY_SCRIPTS_DIR="$(for d in "${CLAUDE_PLUGIN_ROOT:-}" "${CLAUDE_KIT_ROOT:-}" "$HOME/.claude" .; do [ -n "$d" ] && [ -f "$d/scripts/quality-runtime-dir.sh" ] && bash "$d/scripts/quality-runtime-dir.sh" 2>/dev/null && break; done)"
[ -n "$QUALITY_SCRIPTS_DIR" ] || { echo "quality runtime not found" >&2; exit 1; }
bash "$QUALITY_SCRIPTS_DIR/quality-load-root.sh" --manifest "<exact-manifest-path>"
GIT_ROOT="$(node "$QUALITY_SCRIPTS_DIR/quality-invocation.js" field "<exact-manifest-path>" repo.realpath)"
cd "$GIT_ROOT"
bash "$QUALITY_SCRIPTS_DIR/quality-risk-resolve.sh" --manifest "<exact-manifest-path>"
bash "$QUALITY_SCRIPTS_DIR/quality-select-agents.sh" --manifest "<exact-manifest-path>"
```

Path/security floors always win. The initial task type is bound to the campaign;
a remediation commit cannot change task context or reset budget. Bug-fix and
performance labels are context; path sensitivity, change nature, and magnitude
set depth. Critical increases review depth, not routine human approval. Low-tier
typed provider unavailability may record revision-bound `ci-only` coverage only
after its configured fallback path. Medium+ provider failure, malformed output,
stale coverage, findings, and CI failure block unless the outer operator issues
the signed exact-identity `approve --override-quality` capability. That override
preserves gates, CI, freshness, and audit evidence; it never converts failed
evidence into a clean review. Explicit `mergeAuthority=human-required` policy
still needs the wrapper-created, identity-bound, unexpired capability; nested
processes cannot create one.

## 2. Deterministic gates and formatting

Run every immutable `requiredGates` entry through the recording runner. It
accepts only manifest-policy argv, records results atomically, applies attempt
and cumulative execution limits, and reuses only exact-HEAD successes whose
source and command still match. Never invent a passing command or execute a
fork-controlled script on the operator host.

For example, `bash "$QUALITY_SCRIPTS_DIR/quality-run-gate.sh" --manifest "<exact-manifest-path>" --name lint`
is a persisted-policy invocation, never a caller-supplied command.

```bash
QUALITY_SCRIPTS_DIR="$(for d in "${CLAUDE_PLUGIN_ROOT:-}" "${CLAUDE_KIT_ROOT:-}" "$HOME/.claude" .; do [ -n "$d" ] && [ -f "$d/scripts/quality-runtime-dir.sh" ] && bash "$d/scripts/quality-runtime-dir.sh" 2>/dev/null && break; done)"
[ -n "$QUALITY_SCRIPTS_DIR" ] || { echo "quality runtime not found" >&2; exit 1; }
# Names must be present in requiredGates. verify-app only appears when the
# caller passed --verify-app (BUI-306); every other name is unconditional.
for name in lint type test build security consumer verify-app; do
  bash "$QUALITY_SCRIPTS_DIR/quality-run-gate.sh" \
    --manifest "<exact-manifest-path>" --name "$name"
done
```

The runner skips categories not required by the manifest. A config-only
repository may use `--name test --skip --reason "<recorded reason>"` only when
the manifest authorizes `options.skipTests`. Supported gate names and native
`.quality-gates.json` policy are in `reference.md`; shell strings and unknown
fields fail closed. `verify-app` boots the app and, for a web project, drives
`agent-browser` against it — see `reference.md` for its opt-in flag and
detection rules.

High/critical campaigns require the bounded detached-worktree mutation check
after the recorded test gate succeeds. It must never modify the reviewed checkout.

```bash
QUALITY_SCRIPTS_DIR="$(for d in "${CLAUDE_PLUGIN_ROOT:-}" "${CLAUDE_KIT_ROOT:-}" "$HOME/.claude" .; do [ -n "$d" ] && [ -f "$d/scripts/quality-runtime-dir.sh" ] && bash "$d/scripts/quality-runtime-dir.sh" 2>/dev/null && break; done)"
[ -n "$QUALITY_SCRIPTS_DIR" ] || { echo "quality runtime not found" >&2; exit 1; }
TIER="$(node "$QUALITY_SCRIPTS_DIR/quality-invocation.js" field "<exact-manifest-path>" risk.tier)"
case "$TIER" in
  high|critical) bash "$QUALITY_SCRIPTS_DIR/quality-mutation-check.sh" --manifest "<exact-manifest-path>" ;;
  low|medium) ;;
  *) echo "quality risk tier is unresolved" >&2; exit 1 ;;
esac
```

Formatting remediation uses the manifest-bound formatter and configured
extensions; do not send unknown files directly to Prettier.

```bash
QUALITY_SCRIPTS_DIR="$(for d in "${CLAUDE_PLUGIN_ROOT:-}" "${CLAUDE_KIT_ROOT:-}" "$HOME/.claude" .; do [ -n "$d" ] && [ -f "$d/scripts/quality-runtime-dir.sh" ] && bash "$d/scripts/quality-runtime-dir.sh" 2>/dev/null && break; done)"
[ -n "$QUALITY_SCRIPTS_DIR" ] || { echo "quality runtime not found" >&2; exit 1; }
node "$QUALITY_SCRIPTS_DIR/quality-format.js" --manifest "<exact-manifest-path>" -- <changed-files...>
```

## 3. Bounded independent review

Increment the persisted round, then run the selected provider policy. Provider
and gate execution budgets are separate from idle lifecycle time; each attempt
still has a strict timeout. Review artifacts must bind repository, PR, base,
HEAD, invocation, diff hash, and round.

```bash
QUALITY_SCRIPTS_DIR="$(for d in "${CLAUDE_PLUGIN_ROOT:-}" "${CLAUDE_KIT_ROOT:-}" "$HOME/.claude" .; do [ -n "$d" ] && [ -f "$d/scripts/quality-runtime-dir.sh" ] && bash "$d/scripts/quality-runtime-dir.sh" 2>/dev/null && break; done)"
[ -n "$QUALITY_SCRIPTS_DIR" ] || { echo "quality runtime not found" >&2; exit 1; }
node "$QUALITY_SCRIPTS_DIR/quality-run-governor.js" bump-round "<exact-manifest-path>"
bash "$QUALITY_SCRIPTS_DIR/quality-run-review.sh" --manifest "<exact-manifest-path>"
```

Classify availability, exhaustion, billing, parser failure, timeout, findings,
and CI failure from structured evidence, never generated review prose. Primary
and fallback share one provider ledger. A successful initial review covers
`base..HEAD`; after one batched fix, resume the same manifest for the incremental
review. A verification finding is terminal: do not start a third review.

For high/critical, independent-review requirements are strict: a fallback that
would make reviewer identity equal the implementing/primary model must block,
not silently authorize. See `checklist.md` for provider failure handling.

## 4. Judge, remediation, and terminal diagnosis

Read only manifest-listed artifacts and verify their identity. Generate judge
context, classify every provider finding as `BLOCKING`, `WARNING`, or
`SUPPRESSED`, preserve every ID, and let the runtime derive the blocking count.

```bash
QUALITY_SCRIPTS_DIR="$(for d in "${CLAUDE_PLUGIN_ROOT:-}" "${CLAUDE_KIT_ROOT:-}" "$HOME/.claude" .; do [ -n "$d" ] && [ -f "$d/scripts/quality-runtime-dir.sh" ] && bash "$d/scripts/quality-runtime-dir.sh" 2>/dev/null && break; done)"
[ -n "$QUALITY_SCRIPTS_DIR" ] || { echo "quality runtime not found" >&2; exit 1; }
JUDGE_ARTIFACT="$(node "$QUALITY_SCRIPTS_DIR/quality-invocation.js" field "<exact-manifest-path>" stateRoot)/judge-input.json"
node "$QUALITY_SCRIPTS_DIR/quality-invocation.js" judge-context "<exact-manifest-path>" > "$JUDGE_ARTIFACT"
# Add disposition and reason to every findings[] entry without changing identity.
node "$QUALITY_SCRIPTS_DIR/quality-invocation.js" judge "<exact-manifest-path>" --artifact "$JUDGE_ARTIFACT"
```

Fix every blocking finding in one batched commit, run affected gates, then one
incremental review. If the second review blocks, report its evidence and stop.
Any BLOCKING finding must be fixed. If BLOCKING findings remain, merge is
forbidden before any trailer is emitted.
Before any terminal code-finding stop, print the categorized diagnosis:

```bash
QUALITY_SCRIPTS_DIR="$(for d in "${CLAUDE_PLUGIN_ROOT:-}" "${CLAUDE_KIT_ROOT:-}" "$HOME/.claude" .; do [ -n "$d" ] && [ -f "$d/scripts/quality-runtime-dir.sh" ] && bash "$d/scripts/quality-runtime-dir.sh" 2>/dev/null && break; done)"
[ -n "$QUALITY_SCRIPTS_DIR" ] || { echo "quality runtime not found" >&2; exit 1; }
node "$QUALITY_SCRIPTS_DIR/quality-terminal-status.js" --manifest "<exact-manifest-path>" --category code-findings
```

## 5. Evidence, CI, and optional merge

If `options.merge` is false, report the verified result after telemetry. If true,
only `quality-stamp-and-merge.sh` may authorize the merge. It requires contiguous
review checkpoints covering the final change, valid canonical `Quality-*` evidence,
zero findings, current manifest identity, required green CI, fresh base, and the
required merge authority. Never use `gh pr merge`, `--no-verify`, a forged
trailer, a skipped review, or a weaker tier to bypass these checks.

contiguous review checkpoints are mandatory.

```text
Reviewed-By: quality
Reviewed-By: <provider>
Quality-Tier: <tier>
Quality-Reviewer: <provider>
Quality-Primary: <provider>
Quality-Fallback: <provider-or-none>
Quality-Findings: 0
Quality-Head: <reviewed-head>
Quality-Base: <base-sha>
```

The parenthetical legacy form used `reviewer=<provider>` and
`head=<reviewed-head>, base=<base-sha>`; it is reader compatibility only.

```bash
QUALITY_SCRIPTS_DIR="$(for d in "${CLAUDE_PLUGIN_ROOT:-}" "${CLAUDE_KIT_ROOT:-}" "$HOME/.claude" .; do [ -n "$d" ] && [ -f "$d/scripts/quality-runtime-dir.sh" ] && bash "$d/scripts/quality-runtime-dir.sh" 2>/dev/null && break; done)"
[ -n "$QUALITY_SCRIPTS_DIR" ] || { echo "quality runtime not found" >&2; exit 1; }
bash "$QUALITY_SCRIPTS_DIR/quality-stamp-and-merge.sh" --manifest "<exact-manifest-path>"
```

The script must prove that the merge landed at the reviewed SHA and then run
worktree-aware cleanup. A billing preallocation waiver is allowed only under the
narrow conditions in `checklist.md`.

CI remains required except on a plan-proven unprotectable private repository.

It never excuses pending, ambiguous, runner-acquired, step-running, or
non-Actions failures.

## 6. Telemetry — always terminal

On every exit path (merge, no-merge report, blocked, incomplete), record exactly
one idempotent manifest-derived telemetry line. A recorder failure warns without
changing the quality outcome; a missing/unreadable manifest remains a hard error.

```bash
QUALITY_SCRIPTS_DIR="$(for d in "${CLAUDE_PLUGIN_ROOT:-}" "${CLAUDE_KIT_ROOT:-}" "$HOME/.claude" .; do [ -n "$d" ] && [ -f "$d/scripts/quality-runtime-dir.sh" ] && bash "$d/scripts/quality-runtime-dir.sh" 2>/dev/null && break; done)"
[ -n "$QUALITY_SCRIPTS_DIR" ] || { echo "quality runtime not found" >&2; exit 1; }
node "$QUALITY_SCRIPTS_DIR/quality-telemetry.js" record "<exact-manifest-path>" \
  || echo "[quality] telemetry failed; campaign outcome stands" >&2
```

The recorder writes to `$BS_QUALITY_TELEMETRY_FILE` or the operator state
directory, never the audited checkout by default. Use the quality-value report
for escaped-defect rate, finding precision, and token-based cost per caught bug.
