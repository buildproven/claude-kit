const {
  CURRENT_BASELINE,
  compareVersions,
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
  });

  it("pins currency scoring to the required Claude Code baseline", async () => {
    const output = await scoreRepository({ schema: SETTINGS_SCHEMA });

    expect(CURRENT_BASELINE).toBe("2.1.210");
    expect(output.categories.currency.details).toBeUndefined();
    expect(output.categories.currency.pinned).toBe("2.1.210");
    expect(output.categories.currency.score).toBe(10);
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
});
