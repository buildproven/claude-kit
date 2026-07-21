const {
  formatProviderFailure,
  parseArgs,
  synthesizeResponses,
} = require("../ensemble-runner");

describe("ensemble runner provider readiness", () => {
  it("does not request optional Gemini by default", () => {
    const options = parseArgs(["Review this"]);
    expect(options.providers).toEqual(["claude", "codex"]);
  });

  it("turns Gemini spawn failure into actionable guidance", () => {
    const detail = formatProviderFailure(
      "gemini",
      "Failed to spawn agent command: gemini --acp",
    );
    expect(detail).toMatch(/Gemini CLI is unavailable/i);
    expect(detail).toMatch(/API-key auth/i);
    expect(detail).toMatch(/Antigravity/i);
  });

  it("keeps a successful provider result when Gemini is unavailable", () => {
    const options = parseArgs(["Review this", "--providers", "codex,gemini"]);
    const report = synthesizeResponses(
      [
        {
          provider: "codex",
          ok: true,
          stdout:
            "RECOMMENDATION: Ship the narrow fix\nCONFIDENCE: 8\nTASKS:\n- Add a regression test",
          stderr: "",
        },
        {
          provider: "gemini",
          ok: false,
          stdout: "",
          stderr: formatProviderFailure(
            "gemini",
            "Failed to spawn agent command: gemini --acp",
          ),
        },
      ],
      options,
    );
    expect(report).toMatch(/Successes: 1/);
    expect(report).toMatch(/Failures: 1/);
    expect(report).toMatch(/Ship the narrow fix/);
    expect(report).toMatch(/Gemini CLI is unavailable/i);
  });
});
