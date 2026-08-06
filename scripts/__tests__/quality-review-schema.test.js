const {
  normalizeStructuredReview,
} = require("../quality-normalize-structured-review");

function finding(overrides = {}) {
  return {
    severity: "high",
    title: "Stale evidence can merge",
    body: "The authorization reads an outdated head.",
    failure_scenario: "Advance HEAD after review, then invoke authorization.",
    file: "scripts/authorize.js",
    line_start: 42,
    proof: {
      kind: "static-analysis",
      evidence:
        "scripts/authorize.js:42 reads the cached head without recomputing it.",
    },
    recommendation: "Recompute and compare the current head.",
    ...overrides,
  };
}

describe("quality review proof contract", () => {
  it("preserves a concrete failure scenario and proof", () => {
    const review = normalizeStructuredReview({
      verdict: "needs-attention",
      summary: "One material defect",
      findings: [finding()],
    });
    expect(review.findings[0]).toMatchObject({
      failure_scenario: expect.stringContaining("Advance HEAD"),
      proof: { kind: "static-analysis" },
    });
  });

  it.each([
    ["missing scenario", { failure_scenario: undefined }],
    ["missing proof", { proof: undefined }],
    ["empty proof", { proof: { kind: "static-analysis", evidence: "" } }],
    ["unknown proof kind", { proof: { kind: "opinion", evidence: "maybe" } }],
  ])("rejects %s", (_name, override) => {
    expect(() =>
      normalizeStructuredReview({
        verdict: "needs-attention",
        summary: "One material defect",
        findings: [finding(override)],
      }),
    ).toThrow(/invalid finding/);
  });
});
