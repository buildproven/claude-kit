const { planRuntime, workloadUnits } = require("../quality-runtime-plan");

describe("quality runtime planning", () => {
  const plan = (riskScore, files, lines) =>
    planRuntime({ riskScore, diffStats: { files, lines } });

  it("scales bounded campaign and review time with actual workload", () => {
    const plans = [
      plan(10, 1, 5),
      plan(10, 4, 120),
      plan(10, 12, 700),
      plan(10, 30, 3000),
      plan(10, 80, 9000),
    ];
    expect(plans.map((item) => item.campaignSeconds)).toEqual([
      300, 420, 600, 780, 900,
    ]);
    expect(plans.map((item) => item.reviewSeconds)).toEqual([
      75, 120, 210, 330, 720,
    ]);
  });

  it("charges scattered changes per file", () => {
    expect(workloadUnits({ files: 20, lines: 20 })).toBeGreaterThan(
      workloadUnits({ files: 1, lines: 20 }),
    );
    expect(plan(10, 20, 20).workload).not.toBe(plan(10, 1, 20).workload);
  });

  it("keeps tiny critical work deep without granting a huge-change clock", () => {
    const critical = plan(90, 1, 5);
    expect(critical.workload).toBe("micro");
    expect(critical.reviewSeconds).toBe(240);
    expect(critical.campaignSeconds).toBe(600);
    expect(critical.campaignSeconds).toBeLessThan(
      plan(90, 80, 9000).campaignSeconds,
    );
  });

  it("allows exactly one targeted verification after one batched fix", () => {
    const result = plan(100, 500, 100000);
    expect(result.campaignSeconds).toBe(900);
    expect(result.maxReviewRounds).toBe(2);
    expect(result.maxFixCommits).toBe(1);
    expect(result.verificationSeconds).toBe(120);
    expect(result.validationSeconds).toBe(300);
  });

  it("scales the single validation phase from three to five minutes", () => {
    expect(plan(10, 1, 5).validationSeconds).toBe(180);
    expect(plan(10, 4, 120).validationSeconds).toBe(240);
    expect(plan(10, 80, 9000).validationSeconds).toBe(300);
  });

  it("lets requested quality raise depth without erasing size scaling", () => {
    const level95 = planRuntime({
      riskScore: 5,
      minimumRisk: 50,
      diffStats: { files: 1, lines: 5 },
    });
    const level98 = planRuntime({
      riskScore: 5,
      minimumRisk: 75,
      diffStats: { files: 1, lines: 5 },
    });
    expect(level95.tier).toBe("high");
    expect(level95.campaignSeconds).toBe(540);
    expect(level98.tier).toBe("critical");
    expect(level98.campaignSeconds).toBe(600);
  });
});
