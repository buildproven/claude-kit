const { analyzeTrend } = require("../quality-trend");

describe("analyzeTrend", () => {
  it("returns insufficient for empty history", () => {
    const result = analyzeTrend([]);
    expect(result.status).toBe("insufficient");
  });

  it("returns insufficient for single run", () => {
    const result = analyzeTrend([{ score: 95, date: "2026-01-01" }]);
    expect(result.status).toBe("insufficient");
  });

  it("returns stable when score is consistent", () => {
    const history = [
      { score: 95, date: "2026-01-01", branch: "a" },
      { score: 95, date: "2026-01-02", branch: "b" },
      { score: 96, date: "2026-01-03", branch: "c" },
    ];
    const result = analyzeTrend(history);
    expect(result.status).toBe("stable");
    expect(result.drop).toBeLessThanOrEqual(5);
  });

  it("returns warning when score drops >5 pts", () => {
    const history = [
      { score: 100, date: "2026-01-01", branch: "a" },
      { score: 100, date: "2026-01-02", branch: "b" },
      { score: 100, date: "2026-01-03", branch: "c" },
      { score: 93, date: "2026-01-04", branch: "d" },
    ];
    const result = analyzeTrend(history);
    expect(result.status).toBe("warning");
    expect(result.drop).toBeGreaterThan(5);
  });

  it("returns critical when score drops >10 pts", () => {
    const history = [
      { score: 100, date: "2026-01-01", branch: "a" },
      { score: 100, date: "2026-01-02", branch: "b" },
      { score: 100, date: "2026-01-03", branch: "c" },
      { score: 88, date: "2026-01-04", branch: "d" },
    ];
    const result = analyzeTrend(history);
    expect(result.status).toBe("critical");
    expect(result.drop).toBeGreaterThan(10);
  });

  it("returns stable when score improves", () => {
    const history = [
      { score: 80, date: "2026-01-01", branch: "a" },
      { score: 85, date: "2026-01-02", branch: "b" },
      { score: 95, date: "2026-01-03", branch: "c" },
    ];
    const result = analyzeTrend(history);
    expect(result.status).toBe("stable");
    expect(result.drop).toBeLessThanOrEqual(0);
  });

  it("uses up to 3 previous runs for average", () => {
    const history = [
      { score: 50, date: "2026-01-01", branch: "a" }, // outside window
      { score: 90, date: "2026-01-02", branch: "b" },
      { score: 90, date: "2026-01-03", branch: "c" },
      { score: 90, date: "2026-01-04", branch: "d" },
      { score: 88, date: "2026-01-05", branch: "e" },
    ];
    const result = analyzeTrend(history);
    // avg of 90,90,90 = 90, latest = 88, drop = 2 → stable
    expect(result.status).toBe("stable");
  });

  it("includes last 5 scores in output", () => {
    const history = Array.from({ length: 7 }, (_, i) => ({
      score: 90 + i,
      date: `2026-01-0${i + 1}`,
      branch: `b${i}`,
    }));
    const result = analyzeTrend(history);
    expect(result.scores).toHaveLength(5);
  });
});
