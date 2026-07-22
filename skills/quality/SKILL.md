---
name: quality
description: Autonomous quality loop with configurable thoroughness. Runs checks, revision-bound provider review, remediation, CI, and optional merge.
context: fork
disallowed-tools: AskUserQuestion
---

# Quality Skill

Run autonomously to completion. Every mutable fact belongs to one versioned
JSON invocation manifest. Never infer active state from environment inheritance,
session IDs, globbing, mtimes, or a "latest" pointer.

Campaign identity is deterministic for the exact repository, PR, base, HEAD,
scope, level, and merge intent. Repeating the same request resumes that campaign
and its evidence, deadlines, attempts, and terminal state. Changing provider
order cannot mint a fresh budget for the same work. Never start another campaign
for an unchanged identity merely to retry a provider or reset a clock.

Each fenced Bash block runs in a fresh shell. Resolve the installed runtime at
the start of every block; never assume a variable from an earlier block exists.

```bash
QUALITY_SCRIPTS_DIR=""
for candidate in \
  "${CLAUDE_PLUGIN_ROOT:-}/scripts" \
  "${CLAUDE_KIT_ROOT:-}/scripts" \
  "$HOME/.claude/scripts" \
  "./scripts"
do
  if [ -f "$candidate/quality-invocation.js" ]; then
    QUALITY_SCRIPTS_DIR="$(cd "$candidate" && pwd -P)"
    break
  fi
done
[ -n "$QUALITY_SCRIPTS_DIR" ] || { echo "quality runtime not found" >&2; exit 1; }
```

## 1. Manifest handoff

The wrapper has already run bootstrap and must invoke this fork with exactly
`--manifest <path>`. Reject every other argument. Substitute that literal path
in every command. Never source or eval manifest content.

Before a command block needs state, validate it and fetch only required fields:

```bash
QUALITY_SCRIPTS_DIR="$(for candidate in "${CLAUDE_PLUGIN_ROOT:-}/scripts" "${CLAUDE_KIT_ROOT:-}/scripts" "$HOME/.claude/scripts" "./scripts"; do [ -f "$candidate/quality-invocation.js" ] && { cd "$candidate" && pwd -P; break; }; done)"
bash "$QUALITY_SCRIPTS_DIR/quality-load-root.sh" \
  --manifest "<exact-manifest-path>"
GIT_ROOT="$(node "$QUALITY_SCRIPTS_DIR/quality-invocation.js" \
  field "<exact-manifest-path>" repo.realpath)"
cd "$GIT_ROOT"
```

Do not source Bash-only scripts from zsh.

## 2. Risk and agent contract

```bash
QUALITY_SCRIPTS_DIR="$(for candidate in "${CLAUDE_PLUGIN_ROOT:-}/scripts" "${CLAUDE_KIT_ROOT:-}/scripts" "$HOME/.claude/scripts" "./scripts"; do [ -f "$candidate/quality-invocation.js" ] && { cd "$candidate" && pwd -P; break; }; done)"
bash "$QUALITY_SCRIPTS_DIR/quality-risk-resolve.sh" \
  --manifest "<exact-manifest-path>"
bash "$QUALITY_SCRIPTS_DIR/quality-select-agents.sh" \
  --manifest "<exact-manifest-path>"
```

Risk resolution must persist a concrete task type, tier, and numeric agent
target before selection. Docs/CI/build/chore work receives the lightest
eligible routing without weakening path or security floors; feature work keeps
the standard floor; bug-fix and performance work receive the high-review floor.
The initial task type remains bound to the campaign so a later remediation
commit named `fix` cannot mint a stronger campaign or reset its budget.
Critical review increases review depth; it does not require routine human
approval. New campaigns persist `mergeAuthority=autonomous` and merge when
their revision-bound gates, review evidence, CI, and base freshness are clean.
Actionable findings, malformed or inconclusive provider output, stale review
coverage, and CI failures remain terminal blocked states—the only cases that
need human direction because quality cannot mechanically converge.

Repositories may explicitly set `scorePolicy.mergeAuthority` to
`human-required`. That legacy opt-in requires a signed break-glass capability
created only by the outer wrapper and bound to repository, PR, HEAD,
invocation, approver, and expiry identity. Nested quality processes cannot mint
it; a changed HEAD or expired/replaced capability invalidates it.

## 3. Automated gates and formatting

Run every gate in the manifest's immutable `requiredGates` policy, derived at
invocation creation from applicable package scripts, a committed
`.quality-gates.json` policy, and consumer-workflow fixtures. A native
Python/shell/polyglot repository can declare revision-bound commands without
adding a fake `package.json`:

```json
{
  "version": 1,
  "gates": {
    "lint": {
      "executable": "python3",
      "args": ["-m", "ruff", "check", "."]
    },
    "test": {
      "executable": "python3",
      "args": ["-m", "pytest", "-q"]
    },
    "security": {
      "executable": "python3",
      "args": ["-m", "pip_audit", "-r", "requirements.txt"]
    }
  }
}
```

Only argv arrays are accepted; shell command strings and unknown gate fields
fail closed. Explicit native declarations take precedence over same-named
package-script fallbacks. Supported names are `lint`, `test`, `security`,
`build`, `type`, and `consumer`.

This includes lint, type, test, build, security, and consumer gates when
applicable, all evidenced against the current HEAD. Tests must exist and pass
unless the manifest's
`options.skipTests` is true for a config-only repository. Execute the mandatory
categories through the evidence-recording runner:

The invocation persists a campaign deadline and absolute attempt cap. Each
provider gets one bounded phase window within the remaining campaign deadline;
a fallback does not inherit an already-expired primary window, but neither
provider can extend the campaign or mint additional attempts.

```bash
QUALITY_SCRIPTS_DIR="$(for candidate in "${CLAUDE_PLUGIN_ROOT:-}/scripts" "${CLAUDE_KIT_ROOT:-}/scripts" "$HOME/.claude/scripts" "./scripts"; do [ -f "$candidate/quality-invocation.js" ] && { cd "$candidate" && pwd -P; break; }; done)"
bash "$QUALITY_SCRIPTS_DIR/quality-run-gate.sh" \
  --manifest "<exact-manifest-path>" --name lint
bash "$QUALITY_SCRIPTS_DIR/quality-run-gate.sh" \
  --manifest "<exact-manifest-path>" --name test
bash "$QUALITY_SCRIPTS_DIR/quality-run-gate.sh" \
  --manifest "<exact-manifest-path>" --name security
```

The runner resolves commands only from the revision-bound `requiredGates`
policy and executes and records each result atomically. It rejects caller
commands. Cross-repository PRs fail during bootstrap until trusted CI-evidence
ingestion exists; never run fork-controlled scripts on the operator host.
On resume, an exact-HEAD successful gate whose persisted source and command
still match policy is reused instead of rerun. A changed HEAD, command, source,
or failed result executes normally.

When `options.skipTests` is true, record the config-only decision explicitly
instead of inventing a passing test command:

```bash
QUALITY_SCRIPTS_DIR="$(for candidate in "${CLAUDE_PLUGIN_ROOT:-}/scripts" "${CLAUDE_KIT_ROOT:-}/scripts" "$HOME/.claude/scripts" "./scripts"; do [ -f "$candidate/quality-invocation.js" ] && { cd "$candidate" && pwd -P; break; }; done)"
bash "$QUALITY_SCRIPTS_DIR/quality-run-gate.sh" \
  --manifest "<exact-manifest-path>" --name test --skip \
  --reason "config-only repository has no executable test suite"
```

The revision-bound engine supports `options.scope=branch` only. Unsupported
`changed` and `all` values fail during manifest creation instead of silently
behaving like branch scope.

Formatting remediation must use:

```bash
QUALITY_SCRIPTS_DIR="$(for candidate in "${CLAUDE_PLUGIN_ROOT:-}/scripts" "${CLAUDE_KIT_ROOT:-}/scripts" "$HOME/.claude/scripts" "./scripts"; do [ -f "$candidate/quality-invocation.js" ] && { cd "$candidate" && pwd -P; break; }; done)"
node "$QUALITY_SCRIPTS_DIR/quality-format.js" \
  --manifest "<exact-manifest-path>" -- <changed-files...>
```

This respects repository-configured lint-staged extensions and uses
`--ignore-unknown`; never pass unsupported files such as `.gitleaks.toml`
directly to Prettier.

## 4. Bounded provider review

Before every review:

```bash
QUALITY_SCRIPTS_DIR="$(for candidate in "${CLAUDE_PLUGIN_ROOT:-}/scripts" "${CLAUDE_KIT_ROOT:-}/scripts" "$HOME/.claude/scripts" "./scripts"; do [ -f "$candidate/quality-invocation.js" ] && { cd "$candidate" && pwd -P; break; }; done)"
node "$QUALITY_SCRIPTS_DIR/quality-run-governor.js" \
  bump-round "<exact-manifest-path>" || exit 1
bash "$QUALITY_SCRIPTS_DIR/quality-run-review.sh" \
  --manifest "<exact-manifest-path>" || exit 1
```

The first successful review covers `baseSha..HEAD`. After a fix commit, resume
the same explicit manifest; bootstrap advances only to a descendant HEAD and
the next review covers `previousReviewedHead..currentHead`. Review artifacts
live under the invocation directory at `reviews/<headSha>/round-N/` and carry
repository, PR, base, head, invocation, and diff-hash identity.

Provider exhaustion and billing failures are classified only from structured
API/CLI error metadata. Some provider CLIs return an error envelope with process
status 0, so the envelope is authoritative; generated review text mentioning
HTTP 429, quota, or rate-limit handling remains ordinary review content.
Claude, Codex, and the opt-in Gemini adapter share this circuit and governor
contract; Gemini runs only when explicitly selected by quality provider policy.

Typed failures update an operator-state provider circuit. Exhaustion remains
open until its structured reset time; failures without a reset use a bounded
cooldown before one recovery probe (one hour for exhaustion, six for billing).
A successful probe clears the circuit. An open primary circuit skips immediately
to the configured fallback instead of spending another review clock. Parser
failures, provider exhaustion, billing, availability, timeouts, code findings,
and CI failures remain distinct fail-closed diagnoses.

Runtime is derived from both risk and actual diff workload. Risk controls
depth; changed lines plus per-file overhead control the clock. The complete
default campaign is capped at 15 minutes. Critical review receives a 9-minute
provider floor because measured xhigh review of a roughly 1,200-line security
change exceeded the former 330-second large-diff window. Lower-risk windows
remain workload-scaled. If discovery requires a fix, the remaining campaign
budget reserves affected gates and one targeted verification; there is no
recursive third round.

One campaign permits exactly one discovery review, one batched fix commit, and
one targeted verification review. A verification finding is a terminal
blocked result for that campaign: report it with evidence and stop. Do not fix
it and recursively start a third review. Address the reported blocker in a new
commit; the changed HEAD then creates a distinct, explicitly budgeted campaign.

## 5. Judge and remediation

Read only findings artifacts listed by the manifest. Verify artifact identity
before synthesis. Classify findings as BLOCKING, WARNING, or SUPPRESSED.
Generate the identity-bound judge context, classify every listed provider
finding as `BLOCKING`, `WARNING`, or `SUPPRESSED`, and preserve every `id`.
The runtime rejects missing, extra, or stale finding IDs and derives the
blocking count mechanically:

```bash
QUALITY_SCRIPTS_DIR="$(for candidate in "${CLAUDE_PLUGIN_ROOT:-}/scripts" "${CLAUDE_KIT_ROOT:-}/scripts" "$HOME/.claude/scripts" "./scripts"; do [ -f "$candidate/quality-invocation.js" ] && { cd "$candidate" && pwd -P; break; }; done)"
JUDGE_ARTIFACT="$(node "$QUALITY_SCRIPTS_DIR/quality-invocation.js" field \
  "<exact-manifest-path>" stateRoot)/judge-input.json"
node "$QUALITY_SCRIPTS_DIR/quality-invocation.js" judge-context \
  "<exact-manifest-path>" > "$JUDGE_ARTIFACT"
# Add disposition and reason to every findings[] entry without changing identity.
node "$QUALITY_SCRIPTS_DIR/quality-invocation.js" judge \
  "<exact-manifest-path>" --artifact "$JUDGE_ARTIFACT"
```

- Any BLOCKING finding must be fixed.
- Before a fix, run governor `check` against the same manifest.
- Advance/resume the manifest after committing, rerun all affected automated
  gates, then run the incremental review.
- If the incremental verification finds a blocker, stop and report it. Never
  mutate the reviewed HEAD after the second review in the same campaign.
- An inconclusive or malformed provider response blocks merge.

Before a terminal stop for remaining code findings, print the separated
diagnosis:

```bash
QUALITY_SCRIPTS_DIR="$(for candidate in "${CLAUDE_PLUGIN_ROOT:-}/scripts" "${CLAUDE_KIT_ROOT:-}/scripts" "$HOME/.claude/scripts" "./scripts"; do [ -f "$candidate/quality-terminal-status.js" ] && { cd "$candidate" && pwd -P; break; }; done)"
node "$QUALITY_SCRIPTS_DIR/quality-terminal-status.js" \
  --manifest "<exact-manifest-path>" --category code-findings
```

## 6. Review evidence and merge

Final authorization remains bound to the complete base/final-HEAD
relationship. The manifest's contiguous review checkpoints must cover the
whole change with no gaps; a changed, unreviewed HEAD cannot be stamped.

Read `options.merge` from the manifest. When it is false, finish after reporting
the verified review result; do not invoke PR authorization. When it is true,
generate the exact provider-neutral and provider-specific trailers:

```text
Reviewed-By: quality (tier=<tier>, reviewer=<provider>, primary=<provider>, fallback=<provider-or-none>, findings=0, head=<reviewed-head>, base=<base-sha>)
Reviewed-By: <provider> (tier=<tier>, findings=0, head=<reviewed-head>, base=<base-sha>)
```

```bash
QUALITY_SCRIPTS_DIR="$(for candidate in "${CLAUDE_PLUGIN_ROOT:-}/scripts" "${CLAUDE_KIT_ROOT:-}/scripts" "$HOME/.claude/scripts" "./scripts"; do [ -f "$candidate/quality-invocation.js" ] && { cd "$candidate" && pwd -P; break; }; done)"
bash "$QUALITY_SCRIPTS_DIR/quality-stamp-and-merge.sh" \
  --manifest "<exact-manifest-path>"
```

Merge is forbidden when:

- BLOCKING findings remain;
- manifest identity does not match the current repository/revision;
- review coverage is stale or discontinuous;
- `mergeAuthority=human-required` and its required break-glass approval is
  absent or stale;
- CI is failing, except on a plan-proven unprotectable private repository
  during an active operator-authorized GitHub billing window where every failed
  Actions job is exact-HEAD, acquired no runner, ran zero steps, and terminated
  within 30 seconds;
- trailers are missing, malformed, or revision-stale.

When a repository cannot express required checks, wait for all registered
checks instead of polling forever for a nonexistent required set. A billing
waiver never excuses a job that acquired a runner, ran a step, is pending,
failed outside GitHub Actions, or has an ambiguous result. Persist its
classification artifact alongside the manifest.

After green CI—or the narrow billing-preallocation classification above—and
valid evidence, the merge invocation must execute the merge, then perform
worktree-aware cleanup. Never use `--no-verify`, weaken critical review, or
bypass the governor.

## 7. Campaign telemetry (terminal — always run)

Record exactly one telemetry line at the end of the campaign, on **every** exit
path: after a merge, after a no-merge report, and after a blocked/incomplete
stop. It summarizes the manifest — no model judgment — and is idempotent on
invocation id, so a run that both merges and reports records once. A telemetry
write failure never changes the campaign outcome (it warns and exits 0); a
missing or unreadable manifest is a hard failure worth surfacing.

```bash
QUALITY_SCRIPTS_DIR=""
for candidate in "${CLAUDE_PLUGIN_ROOT:-}/scripts" "${CLAUDE_KIT_ROOT:-}/scripts" "$HOME/.claude/scripts" "./scripts"; do
  [ -f "$candidate/quality-telemetry.js" ] || continue
  QUALITY_SCRIPTS_DIR="$(cd "$candidate" && pwd -P)" || {
    echo "[quality] telemetry: found recorder at $candidate but cannot resolve it — campaign verdict stands" >&2
    QUALITY_SCRIPTS_DIR=""
  }
  break
done
if [ -n "$QUALITY_SCRIPTS_DIR" ]; then
  node "$QUALITY_SCRIPTS_DIR/quality-telemetry.js" \
    record "<exact-manifest-path>" \
    || echo "[quality] telemetry: recorder exited $? (see above) — campaign verdict stands" >&2
else
  echo "[quality] telemetry: recorder unresolved — skipping (campaign outcome stands)" >&2
fi
```

The line lands in `$BS_QUALITY_TELEMETRY_FILE` when set, else in the operator
state directory at
`$XDG_STATE_HOME/claude-kit/quality-telemetry/<repo-key>.jsonl` (falling back to
`~/.local/state`). It never dirties the audited repository by default. The
monthly quality-value report derives escaped-defect rate, finding precision,
and cost-per-caught-bug from these lines.

## References

- `reference.md` — flags, target resolution, manifest schema, budgets, history
- `checklist.md` — automated gates, finding validation, judge rules
- `scripts/quality-invocation.js` — authoritative state and identity contract
