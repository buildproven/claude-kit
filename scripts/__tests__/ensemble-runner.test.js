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

// A zero exit is not a review. Provider CLIs routinely print an auth, quota,
// or permission error to stderr and still exit 0; that was counted as success,
// producing a panel that reported "Successes: 2, Failures: 0" with both
// responses empty and no Provider Failures section — a clean bill of health
// from providers that said nothing at all.
describe("ensemble runner argument validation", () => {
  it("does not swallow the next flag when a value is omitted", () => {
    const options = parseArgs([
      "Review this",
      "--providers",
      "--dry-run",
      "--persist",
      "/tmp/x",
    ]);
    // --dry-run must be honored, not consumed as the value of --providers.
    expect(options.dryRun).toBe(true);
    expect(options.providers).toEqual(["claude", "codex"]);
  });

  // Number.parseInt stops at the first non-digit, so "1e9" became 1 — a user
  // asking for a billion rounds silently got one.
  const malformed = [
    ["--rounds", "5x"],
    ["--rounds", "1e9"],
    ["--timeout-ms", "5000abc"],
  ];

  it.each(malformed)(
    "rejects %s %s rather than reinterpreting it",
    (flag, value) => {
      expect(() => parseArgs(["Review this", flag, value])).toThrow(/Invalid/);
    },
  );

  // Node stores timers in a signed 32-bit int; a larger value is clamped to
  // 1ms with only a warning, so every provider would be killed instantly.
  const overflowing = ["2147483648", "1000000000000000"];

  it.each(overflowing)(
    "rejects a timeout of %s that would overflow to 1ms",
    (value) => {
      expect(() => parseArgs(["Review this", "--timeout-ms", value])).toThrow(
        /Invalid timeout-ms/,
      );
    },
  );

  it("still accepts ordinary values", () => {
    const options = parseArgs([
      "Review this",
      "--rounds",
      "3",
      "--timeout-ms",
      "60000",
    ]);
    expect(options.rounds).toBe(3);
    expect(options.timeoutMs).toBe(60000);
  });
});
