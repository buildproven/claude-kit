import { readFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SKILL = readFileSync(path.join(ROOT, "skills/quality/SKILL.md"), "utf8");

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
      "MERGE BLOCKED: No 'Reviewed-By: claude-quality'",
    );
    expect(findingsGate).toBeGreaterThan(-1);
    expect(trailerGate).toBeGreaterThan(-1);
    // A merge must not be authorized by a trailer while findings are outstanding.
    expect(findingsGate).toBeLessThan(trailerGate);
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
