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

Resolve the installed runtime once, then reuse it:

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
bash "$QUALITY_SCRIPTS_DIR/quality-load-root.sh" \
  --manifest "<exact-manifest-path>"
GIT_ROOT="$(node "$QUALITY_SCRIPTS_DIR/quality-invocation.js" \
  field "<exact-manifest-path>" repo.realpath)"
cd "$GIT_ROOT"
```

Do not source Bash-only scripts from zsh.

## 2. Risk and agent contract

```bash
bash "$QUALITY_SCRIPTS_DIR/quality-risk-resolve.sh" \
  --manifest "<exact-manifest-path>"
bash "$QUALITY_SCRIPTS_DIR/quality-select-agents.sh" \
  --manifest "<exact-manifest-path>"
```

Risk resolution must persist a concrete tier and numeric agent target before
selection. Critical review requires a signed break-glass capability created by
the outer wrapper and bound to repository, PR, HEAD, invocation, approver, and
expiry identity. The wrapper pins its verification key into the invocation
before attachment; artifacts cannot supply or replace their own trust key.
Approval is accepted only from the outer `BREAK_GLASS_APPROVED=true`
environment channel, never from quality argv. Nested quality processes cannot
mint approval for an existing invocation. A changed HEAD or expired/replaced
capability invalidates approval.

## 3. Automated gates and formatting

Run every gate in the manifest's immutable `requiredGates` policy, derived at
invocation creation from applicable repository scripts and consumer-workflow
fixtures. This includes lint, type, test, build, security, and consumer gates
when applicable, all evidenced against the current HEAD. Tests must exist and
pass unless the manifest's
`options.skipTests` is true for a config-only repository. Execute the mandatory
categories through the evidence-recording runner:

The invocation also persists an absolute provider deadline and attempt cap
from its start time. Every Claude panel and Codex pass consumes an attempt
before launch; fallback and resumed review rounds cannot reset either bound.

```bash
bash "$QUALITY_SCRIPTS_DIR/quality-run-gate.sh" \
  --manifest "<exact-manifest-path>" --name lint -- <real-lint-command>
bash "$QUALITY_SCRIPTS_DIR/quality-run-gate.sh" \
  --manifest "<exact-manifest-path>" --name test -- <real-test-command>
bash "$QUALITY_SCRIPTS_DIR/quality-run-gate.sh" \
  --manifest "<exact-manifest-path>" --name security -- <real-security-command>
```

When `options.skipTests` is true, record the config-only decision explicitly
instead of inventing a passing test command:

```bash
bash "$QUALITY_SCRIPTS_DIR/quality-run-gate.sh" \
  --manifest "<exact-manifest-path>" --name test --skip \
  --reason "config-only repository has no executable test suite"
```

Use `options.scope` to select changed, branch, or all-project gate commands.

Formatting remediation must use:

```bash
node "$QUALITY_SCRIPTS_DIR/quality-format.js" \
  --manifest "<exact-manifest-path>" -- <changed-files...>
```

This respects repository-configured lint-staged extensions and uses
`--ignore-unknown`; never pass unsupported files such as `.gitleaks.toml`
directly to Prettier.

## 4. Bounded provider review

Before every review:

```bash
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

Provider exhaustion is classified only from a non-zero provider exit plus
structured API/CLI metadata. Generated review text mentioning HTTP 429, quota,
or rate-limit handling is ordinary review content.

Runtime is derived from both risk and actual diff workload. Risk controls
depth; changed lines plus per-file overhead control the clock. Default
campaigns scale from 5 minutes for micro changes to 15 minutes for huge
changes, with smaller independent limits for gates, discovery review, and
verification.

One campaign permits exactly one discovery review, one batched fix commit, and
one targeted verification review. A verification finding is a terminal
blocked result for that campaign: report it with evidence and stop. Do not fix
it and recursively start a third review. A new invocation may address the
reported blocker with a fresh, explicitly budgeted campaign.

## 5. Judge and remediation

Read only findings artifacts listed by the manifest. Verify artifact identity
before synthesis. Classify findings as BLOCKING, WARNING, or SUPPRESSED.
Generate the identity-bound judge context, classify every listed provider
finding as `BLOCKING`, `WARNING`, or `SUPPRESSED`, and preserve every `id`.
The runtime rejects missing, extra, or stale finding IDs and derives the
blocking count mechanically:

```bash
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
bash "$QUALITY_SCRIPTS_DIR/quality-stamp-and-merge.sh" \
  --manifest "<exact-manifest-path>"
```

Merge is forbidden when:

- BLOCKING findings remain;
- manifest identity does not match the current repository/revision;
- review coverage is stale or discontinuous;
- required break-glass approval is absent/stale;
- CI is failing;
- trailers are missing, malformed, or revision-stale.

After green CI and valid evidence, the merge invocation must execute the merge,
then perform worktree-aware cleanup. Never use `--no-verify`, weaken critical
review, or bypass the governor.

## References

- `reference.md` — flags, target resolution, manifest schema, budgets, history
- `checklist.md` — automated gates, finding validation, judge rules
- `scripts/quality-invocation.js` — authoritative state and identity contract
