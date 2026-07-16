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

## 1. Manifest handoff

The wrapper has already run bootstrap and must invoke this fork with exactly
`--manifest <path>`. Reject every other argument. Substitute that literal path
in every command. Never source or eval manifest content.

Before a command block needs state, validate it and fetch only required fields:

```bash
bash "$HOME/.claude/scripts/quality-load-root.sh" \
  --manifest "<exact-manifest-path>"
GIT_ROOT="$(node "$HOME/.claude/scripts/quality-invocation.js" \
  field "<exact-manifest-path>" repo.realpath)"
cd "$GIT_ROOT"
```

Do not source Bash-only scripts from zsh.

## 2. Risk and agent contract

```bash
bash "$HOME/.claude/scripts/quality-risk-resolve.sh" \
  --manifest "<exact-manifest-path>"
bash "$HOME/.claude/scripts/quality-select-agents.sh" \
  --manifest "<exact-manifest-path>"
```

Risk resolution must persist a concrete tier and numeric agent target before
selection. Critical review requires break-glass approval persisted in the
manifest and bound to the exact repository, PR, and HEAD. A changed HEAD
invalidates approval.

## 3. Automated gates and formatting

Run the repository's real lint, type, test, build, security, and
consumer-workflow gates. Tests must exist and pass unless `--skip-tests` was
explicitly selected for a config-only repository.

Formatting remediation must use:

```bash
node "$HOME/.claude/scripts/quality-format.js" \
  --manifest "<exact-manifest-path>" -- <changed-files...>
```

This respects repository-configured lint-staged extensions and uses
`--ignore-unknown`; never pass unsupported files such as `.gitleaks.toml`
directly to Prettier.

## 4. Bounded provider review

Before every review:

```bash
node "$HOME/.claude/scripts/quality-run-governor.js" \
  bump-round "<exact-manifest-path>"
bash "$HOME/.claude/scripts/quality-run-review.sh" \
  --manifest "<exact-manifest-path>"
```

The first successful review covers `baseSha..HEAD`. After a fix commit, resume
the same explicit manifest; bootstrap advances only to a descendant HEAD and
the next review covers `previousReviewedHead..currentHead`. Review artifacts
live under the invocation directory at `reviews/<headSha>/round-N/` and carry
repository, PR, base, head, invocation, and diff-hash identity.

Provider exhaustion is classified only from a non-zero provider exit plus
structured API/CLI metadata. Generated review text mentioning HTTP 429, quota,
or rate-limit handling is ordinary review content.

The governor reserves a separate allowance for the mandatory validation
re-review, so initial provider overhead cannot consume the required success
path. Round and fix-commit caps remain hard.

## 5. Judge and remediation

Read only findings artifacts listed by the manifest. Verify artifact identity
before synthesis. Classify findings as BLOCKING, WARNING, or SUPPRESSED.

- Any BLOCKING finding must be fixed.
- Before a fix, run governor `check` against the same manifest.
- Advance/resume the manifest after committing, rerun all affected automated
  gates, then run the incremental review.
- An inconclusive or malformed provider response blocks merge.

## 6. Review evidence and merge

Final authorization remains bound to the complete base/final-HEAD
relationship. The manifest's contiguous review checkpoints must cover the
whole change with no gaps; a changed, unreviewed HEAD cannot be stamped.

Write provider-neutral and provider-specific `Reviewed-By:` trailers containing
tier, findings count, reviewed head, and base. Then run:

```text
Reviewed-By: quality (tier=<tier>, reviewer=<provider>, findings=0, head=<reviewed-head>, base=<base-sha>)
Reviewed-By: <provider> (tier=<tier>, findings=0, head=<reviewed-head>, base=<base-sha>)
```

```bash
bash "$HOME/.claude/scripts/quality-authorize-merge.sh" \
  --manifest "<exact-manifest-path>" \
  --blocking-count "$BLOCKING_COUNT" \
  --ci-status success
```

Merge is forbidden when:

- BLOCKING findings remain;
- manifest identity does not match the current repository/revision;
- review coverage is stale or discontinuous;
- required break-glass approval is absent/stale;
- CI is failing;
- trailers are missing, malformed, or revision-stale.

After green CI and valid evidence, push and merge through the normal quality
merge path, then perform worktree-aware cleanup. Never use `--no-verify`,
weaken critical review, or bypass the governor.

## References

- `reference.md` — flags, target resolution, manifest schema, budgets, history
- `checklist.md` — automated gates, finding validation, judge rules
- `scripts/quality-invocation.js` — authoritative state and identity contract
