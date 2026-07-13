const fs = require("fs");
const path = require("path");
const Module = require("module");

const { analyzeTrend, loadQualityHistory } = require("../quality-trend");

// The script derives QUALITYRC_PATH from __dirname and only runs main() under
// `require.main === module`. To exercise loadQualityHistory() and main() in the
// same process (so v8 coverage sees them) we stub fs and re-compile the source
// with require.main pointing at it. Source is read once, up front, so the later
// fs.readFileSync spy cannot intercept the module's own source read.
const SRC = path.join(__dirname, "..", "quality-trend.js");
const SOURCE = fs.readFileSync(SRC, "utf8");

function runAsMain() {
  const m = new Module(SRC, null);
  m.filename = SRC;
  m.paths = Module._nodeModulePaths(path.dirname(SRC));
  const prevMain = process.mainModule;
  process.mainModule = m;
  try {
    m._compile(SOURCE, SRC);
  } finally {
    process.mainModule = prevMain;
  }
}

function stubQualityrc(contents) {
  vi.spyOn(fs, "readFileSync").mockImplementation(() => {
    if (contents instanceof Error) throw contents;
    return contents;
  });
}

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

  it("insufficient result exposes raw scores, not the {date,branch,score} shape", () => {
    // Under 2 runs the function maps to bare numbers — main() relies on this to
    // decide whether to print the "Recent scores" block.
    const result = analyzeTrend([{ score: 91, date: "2026-01-01" }]);
    expect(result.scores).toEqual([91]);
    expect(result.drop).toBe(0);
  });

  it("treats an exactly-5-point drop as stable (threshold is strictly >5)", () => {
    const history = [
      { score: 100, date: "2026-01-01", branch: "a" },
      { score: 100, date: "2026-01-02", branch: "b" },
      { score: 95, date: "2026-01-03", branch: "c" },
    ];
    const result = analyzeTrend(history);
    expect(result.drop).toBe(5);
    expect(result.status).toBe("stable");
  });

  it("treats an exactly-10-point drop as warning, not critical", () => {
    const history = [
      { score: 100, date: "2026-01-01", branch: "a" },
      { score: 100, date: "2026-01-02", branch: "b" },
      { score: 90, date: "2026-01-03", branch: "c" },
    ];
    const result = analyzeTrend(history);
    expect(result.drop).toBe(10);
    expect(result.status).toBe("warning");
  });
});

// ─── loadQualityHistory ───────────────────────────────────────────────────────

describe("loadQualityHistory", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns the history array from .qualityrc.json", () => {
    stubQualityrc(
      JSON.stringify({
        history: [{ score: 92, date: "2026-01-01", branch: "main" }],
      }),
    );
    expect(loadQualityHistory()).toEqual([
      { score: 92, date: "2026-01-01", branch: "main" },
    ]);
  });

  it("returns [] when .qualityrc.json has no history key", () => {
    stubQualityrc(JSON.stringify({ threshold: 95 }));
    expect(loadQualityHistory()).toEqual([]);
  });

  it("returns [] when the file is missing", () => {
    stubQualityrc(
      Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" }),
    );
    expect(loadQualityHistory()).toEqual([]);
  });

  it("returns [] when the file contains malformed JSON", () => {
    stubQualityrc("{ not json ]");
    expect(loadQualityHistory()).toEqual([]);
  });
});

// ─── main (CLI exit codes) ────────────────────────────────────────────────────

describe("main", () => {
  let exitSpy;
  let logSpy;

  beforeEach(() => {
    // process.exit is not a real exit here — main() keeps running past it, which
    // is fine because every call site is the last statement on its path.
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("exits 0 when the trend is stable", () => {
    stubQualityrc(
      JSON.stringify({
        history: [
          { score: 95, date: "2026-01-01", branch: "a" },
          { score: 95, date: "2026-01-02", branch: "b" },
          { score: 96, date: "2026-01-03", branch: "c" },
        ],
      }),
    );
    runAsMain();
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(exitSpy).not.toHaveBeenCalledWith(1);
    expect(exitSpy).not.toHaveBeenCalledWith(2);
  });

  it("exits 1 when quality drops more than 5 points", () => {
    stubQualityrc(
      JSON.stringify({
        history: [
          { score: 100, date: "2026-01-01", branch: "a" },
          { score: 100, date: "2026-01-02", branch: "b" },
          { score: 93, date: "2026-01-03", branch: "c" },
        ],
      }),
    );
    runAsMain();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(exitSpy).not.toHaveBeenCalledWith(2);
  });

  it("exits 2 when quality drops more than 10 points", () => {
    stubQualityrc(
      JSON.stringify({
        history: [
          { score: 100, date: "2026-01-01", branch: "a" },
          { score: 100, date: "2026-01-02", branch: "b" },
          { score: 60, date: "2026-01-03", branch: "c" },
        ],
      }),
    );
    runAsMain();
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("exits 0 and skips the score table when history is insufficient", () => {
    stubQualityrc(JSON.stringify({ history: [] }));
    runAsMain();
    expect(exitSpy).toHaveBeenCalledWith(0);
    const printed = logSpy.mock.calls.flat().join("\n");
    expect(printed).toContain("INSUFFICIENT");
    // scores is [] here, so the "Recent scores:" block must not render.
    expect(printed).not.toContain("Recent scores");
  });

  it("prints a recent-scores table when history is sufficient", () => {
    stubQualityrc(
      JSON.stringify({
        history: [
          { score: 95, date: "2026-01-01T00:00:00Z", branch: "main" },
          { score: 96, date: "2026-01-02T00:00:00Z", branch: "feat" },
        ],
      }),
    );
    runAsMain();
    const printed = logSpy.mock.calls.flat().join("\n");
    expect(printed).toContain("Recent scores");
    expect(printed).toContain("2026-01-01 main: 95");
  });

  it("renders '?' placeholders for entries missing date and branch", () => {
    stubQualityrc(JSON.stringify({ history: [{ score: 90 }, { score: 91 }] }));
    runAsMain();
    const printed = logSpy.mock.calls.flat().join("\n");
    expect(printed).toContain("- ? ?: 91");
  });
});
