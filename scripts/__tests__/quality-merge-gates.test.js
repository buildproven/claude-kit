import { readFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SKILL = readFileSync(path.join(ROOT, "skills/quality/SKILL.md"), "utf8");
const VALIDATOR = readFileSync(
  path.join(ROOT, "scripts/quality-validate-review-trailers.sh"),
  "utf8",
);
const RUN_REVIEW = readFileSync(
  path.join(ROOT, "scripts/quality-run-review.sh"),
  "utf8",
);
const AUTHORIZE = readFileSync(
  path.join(ROOT, "scripts/quality-authorize-merge.sh"),
  "utf8",
);
const STAMP_AND_MERGE = readFileSync(
  path.join(ROOT, "scripts/quality-stamp-and-merge.sh"),
  "utf8",
);

/**
 * On 2026-07-12 a review panel returned FAIL with 2 blocking findings; the skill
 * stamped `findings=2` into the Reviewed-By trailer and merged anyway, shipping
 * an install-bricking bug to a public repo.
 *
 * Root cause: BLOCKING_COUNT was only ever interpolated into the trailer string —
 * never compared to zero. Every gate verified the review RAN; none verified it
 * PASSED. These tests pin the gate that closes that hole.
 */
describe("quality merge gates", () => {
  it("blocks the merge when BLOCKING_COUNT is non-zero", () => {
    expect(SKILL).toMatch(/Any BLOCKING finding must be fixed/);
    expect(SKILL).toMatch(/BLOCKING findings remain/);
  });

  it("the blocking-findings gate runs BEFORE the trailer gate", () => {
    const findingsGate = SKILL.indexOf("Any BLOCKING finding must be fixed");
    const trailerGate = SKILL.indexOf("Reviewed-By: quality");
    expect(findingsGate).toBeGreaterThan(-1);
    expect(trailerGate).toBeGreaterThan(-1);
    // A merge must not be authorized by a trailer while findings are outstanding.
    expect(findingsGate).toBeLessThan(trailerGate);
  });

  it("authorizes either reviewer through a provider-neutral quality trailer", () => {
    expect(SKILL).toMatch(/Reviewed-By: quality/);
    expect(SKILL).toMatch(/reviewer=<provider>/);
    expect(SKILL).not.toMatch(/requires a 'Reviewed-By: codex'/);
  });

  it("binds neutral evidence to HEAD/HEAD~1 and merge-base", () => {
    expect(SKILL).toMatch(/head=<reviewed-head>, base=<base-sha>/);
    expect(SKILL).toMatch(/quality-stamp-and-merge\.sh/);
    expect(STAMP_AND_MERGE).toMatch(/review-authorization/);
    expect(STAMP_AND_MERGE).toMatch(/quality-authorize-merge\.sh/);
    expect(VALIDATOR).toMatch(/STAMP_HEAD.*CURRENT_PARENT/s);
    expect(VALIDATOR).toMatch(/STAMP_BASE.*CURRENT_BASE/s);
    expect(VALIDATOR).toMatch(/grep -Fxq "\$EXPECTED"/);
  });

  it("head-binds the merge and verifies terminal merged state", () => {
    expect(AUTHORIZE).toMatch(/--match-head-commit "\$ACTUAL_HEAD"/);
    expect(AUTHORIZE).toMatch(/MERGE_RC=0/);
    expect(AUTHORIZE).toMatch(/gh pr merge[\s\S]*MERGE_RC=\$\?/);
    expect(AUTHORIZE).toMatch(/gh pr view[\s\S]*state,mergedAt,mergeCommit/);
    expect(AUTHORIZE).toMatch(/\.state.*MERGED/s);
    expect(AUTHORIZE).toMatch(/\.mergeCommit\.oid/);
  });

  it("preflights without mutation and pushes one exact persisted remote ref", () => {
    expect(STAMP_AND_MERGE).toMatch(/--manifest "\$MANIFEST" --preflight/);
    expect(STAMP_AND_MERGE.indexOf("--preflight")).toBeLessThan(
      STAMP_AND_MERGE.indexOf("git commit"),
    );
    expect(STAMP_AND_MERGE).toMatch(
      /--force-with-lease="refs\/heads\/\$EXPECTED_HEAD_REF:\$PREFLIGHT_PR_HEAD"/,
    );
    expect(STAMP_AND_MERGE).toMatch(
      /"\$HEAD_REMOTE" "\$STAMP_HEAD:refs\/heads\/\$EXPECTED_HEAD_REF"/,
    );
    expect(STAMP_AND_MERGE).not.toMatch(/^git push\s*$/m);
    expect(AUTHORIZE).toMatch(/repo\.githubRepository/);
    expect(AUTHORIZE).toMatch(/repo\.headRefName/);
    expect(AUTHORIZE).toMatch(/--repo "\$EXPECTED_REPOSITORY"/);
  });

  it("delegates concrete ruleset applicability to GitHub", () => {
    expect(AUTHORIZE).toMatch(/rules\/branches\/\$ENCODED_BASE_NAME/);
    expect(AUTHORIZE).not.toMatch(/rulesets\?includes_parents/);
    expect(AUTHORIZE).not.toMatch(/conditions\.ref_name/);
    expect(AUTHORIZE).toMatch(/strict_required_status_checks_policy == true/);
  });

  it("checks critical approval during non-mutating preflight", () => {
    const approval = AUTHORIZE.indexOf('if [ "$TIER" = critical ]');
    const preflight = AUTHORIZE.lastIndexOf('[ "$PREFLIGHT" = false ]');
    expect(approval).toBeGreaterThan(-1);
    expect(preflight).toBeGreaterThan(approval);
  });

  it("documents only persisted-policy gate invocations", () => {
    expect(SKILL).toMatch(/--manifest "<exact-manifest-path>" --name lint/);
    expect(SKILL).not.toMatch(/--name (?:lint|test|security) -- </);
  });

  it("persists one exact empty stamp and waits boundedly for its CI", () => {
    expect(STAMP_AND_MERGE).toMatch(/merge\.stampHead/);
    expect(STAMP_AND_MERGE).toMatch(/record-stamp/);
    expect(STAMP_AND_MERGE).toMatch(/quality-run-bounded\.sh/);
    expect(STAMP_AND_MERGE).toMatch(
      /quality-wait-required-checks\.sh" --pr "\$PR"/,
    );
    expect(
      STAMP_AND_MERGE.indexOf("quality-wait-required-checks.sh"),
    ).toBeLessThan(STAMP_AND_MERGE.lastIndexOf("quality-authorize-merge.sh"));
    expect(AUTHORIZE).toMatch(/persisted empty stamp/);
  });

  it("persists and reloads the exact reviewed base across fenced shells", () => {
    expect(RUN_REVIEW).toMatch(/quality-invocation\.js" record-review/);
    expect(RUN_REVIEW).toMatch(/--from "\$REVIEW_DIFF_BASE"/);
    expect(RUN_REVIEW).toMatch(/--to "\$REVIEWED_HEAD"/);
    expect(SKILL).toMatch(/contiguous review checkpoints/);
  });

  it("BLOCKING_COUNT is not merely decorative in the trailer", () => {
    // It must be COMPARED, not just interpolated. Guard against a regression
    // that drops the check but keeps `findings=${BLOCKING_COUNT}` in the stamp.
    const compared =
      /Any BLOCKING finding must be fixed/.test(SKILL) &&
      /BLOCKING findings remain/.test(SKILL);
    expect(compared).toBe(true);
  });

  /** The gate is worthless if the model never sees it — see check-skill-size.sh. */
  it("SKILL.md stays inside the compaction re-attach budget", () => {
    // Exits non-zero if any SKILL.md exceeds ~5000 tokens, at which point
    // everything past the cutoff (including these merge gates) is silently
    // dropped after any compaction. That is how the gates vanished in the first
    // place — the file was 17,394 tokens and the gates lived at the tail.
    const out = execFileSync(
      "bash",
      [path.join(ROOT, "scripts/check-skill-size.sh")],
      {
        encoding: "utf8",
      },
    );
    expect(out).toMatch(/within the .* budget/i);
  });
});
