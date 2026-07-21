const { normalizeGeminiReview } = require("../quality-normalize-gemini-review");

describe("Gemini review normalization", () => {
  const cleanReview = {
    verdict: "approve",
    summary: "No actionable findings.",
    findings: [],
  };

  it.each([
    ["JSON response", { response: JSON.stringify(cleanReview) }],
    [
      "fenced JSON response",
      { response: `\`\`\`json\n${JSON.stringify(cleanReview)}\n\`\`\`` },
    ],
  ])("normalizes a Gemini %s envelope", (_label, envelope) => {
    expect(normalizeGeminiReview(envelope)).toEqual(cleanReview);
  });

  it.each([
    ["non-JSON response", { response: "Looks good." }],
    [
      "contradictory approval",
      {
        response: JSON.stringify({
          ...cleanReview,
          findings: [
            {
              severity: "high",
              title: "Unsafe fallback",
              body: "The fallback silently approves malformed output.",
              file: "scripts/quality-run-review.sh",
              line_start: 1,
              recommendation: "Fail closed.",
            },
          ],
        }),
      },
    ],
    [
      "attention verdict without findings",
      {
        response: JSON.stringify({
          verdict: "needs-attention",
          summary: "Review required.",
          findings: [],
        }),
      },
    ],
  ])("rejects %s", (_label, envelope) => {
    expect(() => normalizeGeminiReview(envelope)).toThrow();
  });
});
