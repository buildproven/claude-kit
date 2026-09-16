const {
  CURRENT_BASELINE,
  compareVersions,
  overallScore,
  scoreRepository,
  scoreSettingsValidity,
} = require("../sota-score");

const SETTINGS_SCHEMA = {
  type: "object",
  required: ["requiredMinimumVersion", "permissions", "hooks"],
  properties: {
    requiredMinimumVersion: { type: "string" },
    permissions: { type: "object" },
    hooks: { type: "object" },
  },
};

describe("SOTA rubric 3.0 scorer", () => {
  it("scores exactly the 15 documented rubric categories", async () => {
    const output = await scoreRepository({ schema: SETTINGS_SCHEMA });

    expect(output.rubricVersion).toBe("3.0");
    expect(Object.keys(output.categories)).toEqual([
      "settings_validity",
      "permission_posture",
      "native_first",
      "distribution",
      "agent_orchestration",
      "claude_md",
      "bounded_autonomy",
      "hooks",
      "skill_design",
      "model_config",
      "quality_gates",
      "security",
      "git_workflow",
      "observability",
      "currency",
    ]);
    expect(Object.keys(output.scores)).toHaveLength(15);
    expect(output.categories.skill_design.inert).toEqual([]);
    expect(output.categories.skill_design.score).toBe(10);
    expect(output.categories.agent_orchestration.score).toBe(10);
  });

  it("pins currency scoring to the required Claude Code baseline", async () => {
    const output = await scoreRepository({ schema: SETTINGS_SCHEMA });

    expect(CURRENT_BASELINE).toBe("2.1.233");
    expect(output.categories.currency.details).toBeUndefined();
    expect(output.categories.currency.pinned).toBe("2.1.233");

    // Currency is 6 points for the version pin plus 4 for a rubric reviewed
    // within 30 days. Asserting a flat 10 made this a time bomb: it passed
    // for 30 days after each rubric review and then failed on day 31 with no
    // code change, which is a calendar failure masquerading as a defect. It
    // did exactly that here -- the rubric was last reviewed 2026-08-16 and
    // this broke on 2026-09-16, day 31.
    //
    // The version half is the part under this repository's control, so pin
    // that and let the age half report honestly.
    // Deterministic: the score is the SUM of two independent components, so
    // assert each rather than a range. A range admits a regression that awards
    // 2 for age instead of 0 or 4 -- the category would report 8 with an
    // "older than 30 days" gap and the test would still pass, which the
    // cross-model review caught in the first version of this fix.
    const { score, gap } = output.categories.currency;
    const ageCredit = score - 6;
    expect(ageCredit === 0 || ageCredit === 4).toBe(true);
    if (ageCredit === 0) expect(gap).toMatch(/older than 30 days/);
    else expect(gap).toBeNull();
  });

  it("fails settings validity closed when the live schema is unavailable", () => {
    const scored = scoreSettingsValidity(null, "network unavailable");

    expect(scored.score).toBe(0);
    expect(scored.gap).toContain("network unavailable");
  });

  it("compares semantic version components numerically", () => {
    expect(compareVersions("2.1.210", "2.1.207")).toBe(1);
    expect(compareVersions("2.1.210", "2.1.210")).toBe(0);
    expect(compareVersions("2.1.99", "2.1.210")).toBe(-1);
  });

  describe("overallScore", () => {
    it("excludes N/A categories from the mean instead of scoring them zero", () => {
      // The real 2026-07-18 amendment: distribution is N/A for a private
      // overlay that is never published. Averaging across all 15 keys read
      // 8.2; the true mean of the 14 applicable categories is 8.8.
      const scores = {
        settings_validity: 9,
        permission_posture: 9,
        native_first: 9,
        distribution: null,
        agent_orchestration: 8,
        claude_md: 10,
        bounded_autonomy: 9,
        hooks: 9,
        skill_design: 8,
        model_config: 8,
        quality_gates: 9,
        security: 9,
        git_workflow: 10,
        observability: 7,
        currency: 9,
      };

      expect(overallScore(scores)).toBe(8.8);
    });

    it("does not let a null category deflate the average", () => {
      expect(overallScore({ a: 10, b: 10, c: null })).toBe(10);
    });

    it("returns null rather than NaN when nothing is applicable", () => {
      expect(overallScore({ a: null, b: undefined })).toBeNull();
      expect(overallScore({})).toBeNull();
    });

    it("ignores non-finite values that would poison the mean", () => {
      expect(overallScore({ a: 8, b: NaN, c: Infinity })).toBe(8);
    });
  });
});
