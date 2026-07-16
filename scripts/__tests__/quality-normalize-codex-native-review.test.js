const {
  parseNativeReview,
} = require("../quality-normalize-codex-native-review");

describe("native Codex review normalization", () => {
  it("normalizes native priority findings into the review schema", () => {
    const result = parseNativeReview(
      `Review summary.

Full review comments:

- [P1] Preserve the whole range — /repo/scripts/review.sh:12-18
  Intermediate commits are otherwise omitted from evidence.

- [P2] Reject unsupported scope — /repo/scripts/state.js:40
  Persisting an ignored option is misleading.
`,
      "/repo",
    );
    expect(result).toMatchObject({
      verdict: "needs-attention",
      findings: [
        {
          severity: "high",
          title: "Preserve the whole range",
          file: "scripts/review.sh",
          line_start: 12,
        },
        {
          severity: "medium",
          file: "scripts/state.js",
          line_start: 40,
        },
      ],
    });
  });

  it("approves native output without priority findings", () => {
    expect(parseNativeReview("No findings.").verdict).toBe("approve");
  });

  it("rejects unrecognized prose instead of inventing approval", () => {
    expect(() => parseNativeReview("Review ended unexpectedly.")).toThrow(
      /no recognizable verdict/,
    );
  });

  it("rejects malformed structured output even when its text says no findings", () => {
    expect(() =>
      parseNativeReview(
        JSON.stringify({
          verdict: "needs-attention",
          summary: "No findings were normalized",
          findings: [{ severity: "high" }],
        }),
      ),
    ).toThrow(/malformed structured Codex review/);
  });
});
