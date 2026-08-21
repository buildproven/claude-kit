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
budgets, or history. Read `checklist.md` before gates, leads, remediation, or merge.
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
review invokes no provider and records an exact-head policy exemption. Provider
failure or malformed output at Medium+ is recorded as incomplete discovery,
never as clean. AI leads and completion status are advisory; deterministic gate
failure, stale coverage, and CI failure block unless the outer operator issues
the signed exact-identity `approve --override-quality` capability. That override
preserves gates, CI, freshness, and audit evidence. Explicit
`mergeAuthority=human-required` policy
still needs the wrapper-created, identity-bound, unexpired capability; nested
processes cannot create one.

An exhausted provider retry may be resumed across a legitimate descendant fix
only through an exact-new-HEAD operator override accepting
`review:provider-exhaustion` with `--i-understand-missing-review`. The runtime
preserves the prior incomplete evidence, never mints another provider budget,
and requires deterministic gates and mutation evidence for the descendant
before attaching the signed override.
Once that transition is recorded, the campaign cannot authorize another
provider attempt; any later code change starts a fresh campaign so the audit
trail never reuses the exhausted review state.

## 2. Deterministic gates and formatting

Before executing the test gate, classify the immutable diff with
`scripts/test-impact.js`. Run only its persisted `focused` commands; record a
clean no-test result for `none`; stop on `unmapped` and repair the repository's
`.buildproven/test-impact.json`; run a complete regression only for an explicit
`audit` result and record its reason. Never turn uncertainty into an automatic
full-suite run. An exact-candidate success with the same source and command is
reused rather than rerun.

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
# Execute exactly the persisted gate contract. Replaying a name that is not in
# requiredGates is a policy error, not a skip; verify-app is present only when
# the caller passed --verify-app (BUI-306).
MANIFEST="<exact-manifest-path>"
while IFS= read -r name; do
  bash "$QUALITY_SCRIPTS_DIR/quality-run-gate.sh" \
    --manifest "$MANIFEST" --name "$name" || exit 1
done < <(jq -r '.requiredGates[].name' "$MANIFEST")
```

The caller enumerates only categories required by the manifest; the runner
rejects any other name. A config-only repository may use
`--name test --skip --reason "<recorded reason>"` only when
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
"$QUALITY_SCRIPTS_DIR/quality-authorize-review-round.sh" "<exact-manifest-path>" || exit 1
bash "$QUALITY_SCRIPTS_DIR/quality-run-review.sh" --manifest "<exact-manifest-path>"
```

Classify availability, exhaustion, billing, parser failure, timeout, findings,
and CI failure from structured evidence, never generated review prose. Primary
and fallback share one provider ledger. A successful initial review covers
`base..HEAD`; after one batched fix, resume the same manifest for the incremental
review. A verification finding is terminal: do not start a third review.

An incomplete v2 provider-failure attestation records the exact failed attempt.
The review runner itself authorizes and executes one bounded same-range retry
before it returns. A second incomplete failure attestation remains explicitly
`review-incomplete` and lets deterministic gates continue; it never becomes a
synthetic clean verdict. Do not advance HEAD or start another provider run
between those attempts. Default runtime planning reserves its provider starts
and cumulative execution time; an explicit operator provider time cap remains
authoritative. This is separate from a completed critical review that truthfully
records incomplete model-family diversity.

Critical discovery records effective slot identities and is complete only when
the two Claude slots use distinct model families. A one-provider native run or
missing diversity is signed as incomplete, never independent or clean. See
`checklist.md` for provider failure handling.

Codex review model selection is task-scoped: low uses Luna, medium/high uses
Terra, and critical uses Sol. This does not change the interactive builder
session. Claude agents continue to inherit the selected session model, with the
existing critical diversity rule. Starting a session on a stronger model does
not automatically downshift it; only an explicit scoped invocation can do that.

## 4. Lead verification, remediation, and terminal diagnosis

Provider findings are leads, not verdicts. Read only manifest-listed artifacts
and verify their identity. Settle each lead by reading the cited path and using
deterministic repository evidence. Do not ask another model to vote, promote a
finding because multiple agents repeated it, or treat a model clean verdict as
proof.

A lead becomes merge-blocking only when converted into an allowlisted failing
gate, regression test, or executable static rule. Batch confirmed repairs into
at most one fix commit, rerun affected gates, then produce one incremental
discovery attestation for the changed HEAD. Refuted or unproved leads remain in
the signed lead count; they are not rewritten as clean and do not control merge
authority. After the bounded fix/delta cycle, use the existing signed operator
override for any unresolved policy decision instead of starting another model
round.

Before any terminal deterministic-finding stop, print the categorized
diagnosis:

```bash
QUALITY_SCRIPTS_DIR="$(for d in "${CLAUDE_PLUGIN_ROOT:-}" "${CLAUDE_KIT_ROOT:-}" "$HOME/.claude" .; do [ -n "$d" ] && [ -f "$d/scripts/quality-runtime-dir.sh" ] && bash "$d/scripts/quality-runtime-dir.sh" 2>/dev/null && break; done)"
[ -n "$QUALITY_SCRIPTS_DIR" ] || { echo "quality runtime not found" >&2; exit 1; }
node "$QUALITY_SCRIPTS_DIR/quality-terminal-status.js" --manifest "<exact-manifest-path>" --category code-findings
```

## 5. Evidence, CI, and optional merge

If `options.merge` is false, report the verified result after telemetry. If true,
only `quality-stamp-and-merge.sh` may authorize the merge. New campaigns keep the
reviewed HEAD immutable and publish signed evidence through the
`quality-review-evidence` check run; legacy campaigns may resume an existing empty
stamp. Either path requires contiguous review checkpoints covering the final change,
valid exact-head evidence, zero deterministic findings, current manifest identity,
required green CI, fresh base, and the required merge authority. Never use
`gh pr merge`, `--no-verify`, a forged trailer, a skipped review, or a weaker tier
to bypass these checks.

An optional fleet CI-budget policy is checked before direct pushes and before
merge admission. At its hard limit, ordinary pushes fail closed; only the
signed, time-bounded exact-head billing override can select the local evidence
path. Trusted GitHub Actions evidence may be reused without another API call
only when repository, workflow, check, base SHA, candidate SHA/kind, source app,
source URL, and successful conclusion all still match exactly.

A protected `strict: false` base remains blocked unless the exact campaign has
the distinct signed `operator-nonstrict-refcas-override`. The merge lease uses
one non-force GitHub ref update after it rechecks the complete protection
contract, required App bindings, resolved conversations, base, PR, and head.
Green CI remains required unless the same capability also binds the exact
Actions outage evidence. Never reinterpret the ordinary CI capability as this
scope.

contiguous review checkpoints are mandatory.

```text
Reviewed-By: quality
Reviewed-By: <provider>
Quality-Tier: <tier>
Quality-Reviewer: <provider>
Quality-Primary: <provider>
Quality-Fallback: <provider-or-none>
Quality-Findings: 0
Quality-Leads: <advisory-lead-count>
Quality-Review-Status: <complete|incomplete|policy-exempt>
Quality-Head: <reviewed-head>
Quality-Base: <base-sha>
```

An operator-override merge (see `/bs:quality override` below) additionally
carries `Quality-Override: operator-quality-override`,
`Quality-Override-Reason: <text>`, `Quality-Override-Accepted: <comma-list of
condition ids>`, and `Quality-Override-Approver: <name>` alongside — never
instead of — the evidence trailers above, so the merge is never confused with
a clean auto-merge.

The parenthetical legacy form used `reviewer=<provider>` and
`head=<reviewed-head>, base=<base-sha>`; it is reader compatibility only.

```bash
QUALITY_SCRIPTS_DIR="$(for d in "${CLAUDE_PLUGIN_ROOT:-}" "${CLAUDE_KIT_ROOT:-}" "$HOME/.claude" .; do [ -n "$d" ] && [ -f "$d/scripts/quality-runtime-dir.sh" ] && bash "$d/scripts/quality-runtime-dir.sh" 2>/dev/null && break; done)"
[ -n "$QUALITY_SCRIPTS_DIR" ] || { echo "quality runtime not found" >&2; exit 1; }
bash "$QUALITY_SCRIPTS_DIR/quality-stamp-and-merge.sh" --manifest "<exact-manifest-path>"
```

The script must prove that the merge landed at the exact reviewed SHA and then run
worktree-aware cleanup. A billing preallocation waiver is allowed only under the
narrow conditions in `checklist.md`; it never waives signed review evidence.

CI remains required except on a plan-proven unprotectable private repository.

It never excuses pending, ambiguous, runner-acquired, step-running, or
non-Actions failures.

## 6. Telemetry — always terminal

On every exit path (merge, no-merge report, blocked, incomplete), record exactly
one idempotent manifest-derived telemetry line. A recorder failure warns without
changing the quality outcome; a missing/unreadable manifest remains a hard error.
The public `terminal-state` command performs that fail-soft telemetry write
automatically after it persists the write-once terminal state. Do not depend on
a separate agent-authored recorder step.

```bash
QUALITY_SCRIPTS_DIR="$(for d in "${CLAUDE_PLUGIN_ROOT:-}" "${CLAUDE_KIT_ROOT:-}" "$HOME/.claude" .; do [ -n "$d" ] && [ -f "$d/scripts/quality-runtime-dir.sh" ] && bash "$d/scripts/quality-runtime-dir.sh" 2>/dev/null && break; done)"
[ -n "$QUALITY_SCRIPTS_DIR" ] || { echo "quality runtime not found" >&2; exit 1; }
node "$QUALITY_SCRIPTS_DIR/quality-invocation.js" terminal-state \
  "<exact-manifest-path>" --state verified-unmerged \
  --detail "deterministic evidence complete; merge not requested" >/dev/null
```

The recorder writes to `$BS_QUALITY_TELEMETRY_FILE` or the operator state
directory, never the audited checkout by default. For recovery or historical
backfill only, `node "$QUALITY_SCRIPTS_DIR/quality-telemetry.js" record
"<exact-manifest-path>"` remains an idempotent direct entrypoint. Use the
standalone report for campaign p50/p95, fallback, convergence, and repeated
complete-suite rates:

```bash
node "$QUALITY_SCRIPTS_DIR/quality-telemetry-report.js" \
  --input "$HOME/.local/state/claude-kit/quality-telemetry" \
  --ci-snapshot /path/to/ci-budget-snapshot.json \
  --dispositions /path/to/finding-dispositions.json
```

The optional evidence files are schema-versioned JSON. A CI snapshot requires
`schemaVersion`, `usedMinutes`, `includedMinutes`, and `fetchedAt`; a finding
ledger requires `schemaVersion`, `confirmed`, `refuted`, `escaped`, `source`,
and `asOf`.
Unavailable, historical, malformed, or unsupported data is labeled in the
report's `completeness` section, never inferred as zero. Use the quality-value
report for escaped-defect attribution and cost per deterministic failure.
