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
    expect(SKILL).toMatch(/if\s+\[\s+"\$\{BLOCKING_COUNT:-0\}"\s+-ne\s+0\s+\]/);
    expect(SKILL).toMatch(/MERGE BLOCKED:.*BLOCKING finding/i);
  });

  it("the blocking-findings gate runs BEFORE the trailer gate", () => {
    const findingsGate = SKILL.indexOf('${BLOCKING_COUNT:-0}" -ne 0');
    const trailerGate = SKILL.indexOf(
      "MERGE BLOCKED: No 'Reviewed-By: quality'",
    );
    expect(findingsGate).toBeGreaterThan(-1);
    expect(trailerGate).toBeGreaterThan(-1);
    // A merge must not be authorized by a trailer while findings are outstanding.
    expect(findingsGate).toBeLessThan(trailerGate);
  });

  it("authorizes either reviewer through a provider-neutral quality trailer", () => {
    expect(SKILL).toMatch(/Reviewed-By: quality/);
    expect(SKILL).toMatch(/reviewer=\$\{REVIEW_PROVIDER\}/);
    expect(SKILL).not.toMatch(/requires a 'Reviewed-By: codex'/);
  });

  it("binds neutral evidence to HEAD/HEAD~1 and merge-base", () => {
    expect(SKILL).toMatch(/head=\$\{HEAD_SHA\}, base=\$\{BASE_SHA\}/);
    expect(SKILL).toMatch(/git log -1 --format=%B/);
    expect(SKILL).toMatch(/quality-validate-review-trailers\.sh/);
    expect(VALIDATOR).toMatch(/STAMP_HEAD.*CURRENT_PARENT/s);
    expect(VALIDATOR).toMatch(/STAMP_BASE.*CURRENT_BASE/s);
    expect(VALIDATOR).toMatch(/grep -Fxq "\$EXPECTED"/);
  });

  it("persists and reloads the exact reviewed base across fenced shells", () => {
    expect(RUN_REVIEW).toMatch(/-reviewstate\.env/);
    expect(RUN_REVIEW).toMatch(
      /REVIEW_BASE=.*git merge-base HEAD "\$REVIEW_BASE_REF"/,
    );
    expect(RUN_REVIEW).toMatch(/REVIEWED_BASE="\$REVIEW_BASE"/);
    expect(RUN_REVIEW).toMatch(/RESOLVED_BASE='\$REVIEW_BASE_REF'/);
    expect(SKILL).toMatch(/BS_QUALITY_REVIEWSTATE_FILE/);
    expect(SKILL).toMatch(/\. "\$BS_QUALITY_REVIEWSTATE_FILE"/);
  });

  it("BLOCKING_COUNT is not merely decorative in the trailer", () => {
    // It must be COMPARED, not just interpolated. Guard against a regression
    // that drops the check but keeps `findings=${BLOCKING_COUNT}` in the stamp.
    const compared = /BLOCKING_COUNT:-0\}"\s+-ne\s+0/.test(SKILL);
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
