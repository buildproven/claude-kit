const {
  findingShapeKey,
  detectRepeatedPattern,
  evaluateBudget,
  parseFindingsArg,
  priorFindingsFrom,
} = require("../quality-run-governor");

describe("findingShapeKey", () => {
  it("strips trailing line numbers from the file path fallback", () => {
    const key = findingShapeKey({ file: "src/foo.ts:42", summary: "" });
    expect(key).toBe("src/foo.ts");
  });

  it("normalizes numbers and punctuation in the summary", () => {
    const a = findingShapeKey({
      file: "src/jobs/handler1.ts",
      summary: "on-disk job at line 42 differs from loaded job",
    });
    const b = findingShapeKey({
      file: "src/jobs/handler2.ts",
      summary: "on-disk job at line 99 differs from loaded job",
    });
    expect(a).toBe(b);
  });

  it("distinguishes genuinely different findings", () => {
    const a = findingShapeKey({
      file: "a.ts",
      summary: "missing null check on user input",
    });
    const b = findingShapeKey({
      file: "b.ts",
      summary: "SQL injection via raw query",
    });
    expect(a).not.toBe(b);
  });
});

describe("detectRepeatedPattern", () => {
  it("reports no repetition when there is no prior history", () => {
    const result = detectRepeatedPattern([], [{ file: "a.ts", summary: "x" }]);
    expect(result.repeated).toBe(false);
  });

  it("reports no repetition when current findings are empty", () => {
    const result = detectRepeatedPattern([{ file: "a.ts", summary: "x" }], []);
    expect(result.repeated).toBe(false);
    expect(result.total).toBe(0);
  });

  it("detects a dominant repeated shape across rounds (the incident scenario)", () => {
    const prior = [
      {
        file: "src/jobs/a.ts:10",
        summary: "on-disk job differs from loaded job at call site A",
      },
    ];
    const current = [
      {
        file: "src/jobs/b.ts:20",
        summary: "on-disk job differs from loaded job at call site B",
      },
      {
        file: "src/jobs/c.ts:30",
        summary: "on-disk job differs from loaded job at call site C",
      },
      {
        file: "src/jobs/d.ts:40",
        summary: "on-disk job differs from loaded job at call site D",
      },
    ];
    const result = detectRepeatedPattern(prior, current);
    expect(result.repeated).toBe(true);
    expect(result.matchCount).toBe(3);
    expect(result.total).toBe(3);
  });

  it("does not flag genuinely distinct findings as repeated", () => {
    const prior = [{ file: "a.ts", summary: "missing null check" }];
    const current = [
      { file: "b.ts", summary: "SQL injection risk" },
      { file: "c.ts", summary: "race condition on write" },
    ];
    const result = detectRepeatedPattern(prior, current);
    expect(result.repeated).toBe(false);
  });

  it("never flags repetition on a single coincidental match, even at a low threshold", () => {
    const prior = [{ file: "a.ts", summary: "shape one issue" }];
    const current = [
      { file: "b.ts", summary: "shape one issue" },
      { file: "c.ts", summary: "totally different issue" },
    ];
    // 1/2 = 0.5 matches the threshold, but the >=2 match floor guards against
    // a single coincidental repeat triggering a false "same gap" verdict.
    expect(detectRepeatedPattern(prior, current, 0.4).repeated).toBe(false);
  });

  it("respects a custom threshold once the >=2 match floor is met", () => {
    const prior = [{ file: "a.ts", summary: "shape one issue" }];
    const current = [
      { file: "b.ts", summary: "shape one issue" },
      { file: "c.ts", summary: "shape one issue" },
      { file: "d.ts", summary: "totally different issue" },
    ];
    // 2/3 = 0.67 >= default 0.6 -> repeated
    expect(detectRepeatedPattern(prior, current).repeated).toBe(true);
  });
});

describe("evaluateBudget", () => {
  const baseState = {
    start_epoch: 1000,
    start_commit_count: 5,
    max_fix_commits: 4,
    max_wall_seconds: 1800,
  };

  it("passes when under both budgets", () => {
    const result = evaluateBudget(baseState, {
      nowEpoch: 1500,
      commitCount: 6,
    });
    expect(result.ok).toBe(true);
    expect(result.elapsedSeconds).toBe(500);
    expect(result.commitsUsed).toBe(1);
  });

  it("trips on wall-clock even with zero commits", () => {
    const result = evaluateBudget(baseState, {
      nowEpoch: 1000 + 1800,
      commitCount: 5,
    });
    expect(result.ok).toBe(false);
    expect(result.wallTripped).toBe(true);
    expect(result.commitTripped).toBe(false);
  });

  it("trips on commit count even with time remaining", () => {
    const result = evaluateBudget(baseState, {
      nowEpoch: 1100,
      commitCount: 9,
    });
    expect(result.ok).toBe(false);
    expect(result.commitTripped).toBe(true);
    expect(result.wallTripped).toBe(false);
  });

  it("trips on both simultaneously", () => {
    const result = evaluateBudget(baseState, {
      nowEpoch: 1000 + 1800,
      commitCount: 20,
    });
    expect(result.ok).toBe(false);
    expect(result.wallTripped).toBe(true);
    expect(result.commitTripped).toBe(true);
  });

  it("is exact at the boundary (>= trips, not just >)", () => {
    const result = evaluateBudget(baseState, {
      nowEpoch: 1100,
      commitCount: 9,
    });
    expect(result.commitsUsed).toBe(4);
    expect(result.commitTripped).toBe(true);
  });

  it("fails CLOSED (trips) when state is null (unreadable sentinel)", () => {
    const result = evaluateBudget(null, { nowEpoch: 1500, commitCount: 6 });
    expect(result.ok).toBe(false);
    expect(result.configInvalid).toBe(true);
    expect(result.wallTripped).toBe(true);
    expect(result.commitTripped).toBe(true);
  });

  it("fails CLOSED when a required numeric field is missing", () => {
    const { max_wall_seconds, ...incomplete } = baseState;
    void max_wall_seconds;
    const result = evaluateBudget(incomplete, {
      nowEpoch: 1500,
      commitCount: 6,
    });
    expect(result.ok).toBe(false);
    expect(result.configInvalid).toBe(true);
  });

  it("fails CLOSED when a required field is non-numeric (NaN/string)", () => {
    const corrupt = { ...baseState, max_fix_commits: "not-a-number" };
    const result = evaluateBudget(corrupt, {
      nowEpoch: 1500,
      commitCount: 6,
    });
    expect(result.ok).toBe(false);
    expect(result.configInvalid).toBe(true);
  });

  it("does not flag configInvalid on a fully valid state", () => {
    const result = evaluateBudget(baseState, {
      nowEpoch: 1500,
      commitCount: 6,
    });
    expect(result.configInvalid).toBe(false);
  });

  it("fails CLOSED when commitCount is null (git read failed)", () => {
    const result = evaluateBudget(baseState, {
      nowEpoch: 1500,
      commitCount: null,
    });
    expect(result.ok).toBe(false);
    expect(result.configInvalid).toBe(true);
  });
});

describe("parseFindingsArg", () => {
  it("parses a valid findings array", () => {
    const arr = parseFindingsArg('[{"file":"a.ts","summary":"x"}]');
    expect(arr).toEqual([{ file: "a.ts", summary: "x" }]);
  });

  it("defaults to an empty array when the arg is undefined", () => {
    expect(parseFindingsArg(undefined)).toEqual([]);
  });

  it("degrades to an empty array on malformed JSON", () => {
    expect(parseFindingsArg("{not valid json")).toEqual([]);
  });

  it("degrades to an empty array on valid JSON that is not an array (object)", () => {
    expect(parseFindingsArg("{}")).toEqual([]);
  });

  it("degrades to an empty array on valid JSON that is not an array (number)", () => {
    expect(parseFindingsArg("42")).toEqual([]);
  });

  it("degrades to an empty array on valid JSON that is not an array (string)", () => {
    expect(parseFindingsArg('"x"')).toEqual([]);
  });
});

describe("priorFindingsFrom", () => {
  it("returns findings_seen when it is a valid array", () => {
    const state = { findings_seen: [{ file: "a.ts", summary: "x" }] };
    expect(priorFindingsFrom(state)).toEqual(state.findings_seen);
  });

  it("returns [] when findings_seen is missing", () => {
    expect(priorFindingsFrom({})).toEqual([]);
  });

  it("returns [] when state itself is null/undefined", () => {
    expect(priorFindingsFrom(null)).toEqual([]);
    expect(priorFindingsFrom(undefined)).toEqual([]);
  });

  it("returns [] instead of corrupting on a truthy non-array findings_seen (corrupt/tampered sentinel)", () => {
    // Regression: `state.findings_seen || []` does NOT catch this — a truthy
    // string/object survives the `||` and would previously flow into
    // `.concat()`, coercing findings_seen into a garbage string on save.
    const state = { findings_seen: "corrupted" };
    const prior = priorFindingsFrom(state);
    expect(prior).toEqual([]);
    // Verify concatenating onto the safe result stays an array (this is the
    // exact operation main()'s record-finding branch performs).
    expect(prior.concat([{ file: "b.ts", summary: "y" }])).toEqual([
      { file: "b.ts", summary: "y" },
    ]);
  });

  it("returns [] on other non-array truthy shapes (number, object)", () => {
    expect(priorFindingsFrom({ findings_seen: 42 })).toEqual([]);
    expect(priorFindingsFrom({ findings_seen: { not: "an array" } })).toEqual(
      [],
    );
  });
});
