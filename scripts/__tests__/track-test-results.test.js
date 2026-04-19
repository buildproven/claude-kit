const { detectFlaky, extractTestOutcomes } = require("../track-test-results");

describe("extractTestOutcomes", () => {
  it("extracts pass/fail from vitest JSON format", () => {
    const results = {
      testResults: [
        {
          name: "foo.test.js",
          assertionResults: [
            { fullName: "adds numbers", status: "passed" },
            { fullName: "handles null", status: "failed" },
          ],
        },
      ],
    };
    const outcomes = extractTestOutcomes(results);
    expect(outcomes["foo.test.js::adds numbers"]).toBe("pass");
    expect(outcomes["foo.test.js::handles null"]).toBe("fail");
  });

  it("returns empty object for null/undefined input", () => {
    expect(extractTestOutcomes(null)).toEqual({});
    expect(extractTestOutcomes(undefined)).toEqual({});
  });

  it("returns empty object when testResults is missing", () => {
    expect(extractTestOutcomes({})).toEqual({});
  });
});

describe("detectFlaky", () => {
  it("returns empty for fewer than 2 runs", () => {
    expect(detectFlaky([])).toEqual([]);
    expect(detectFlaky([{ outcomes: { "a::test1": "pass" } }])).toEqual([]);
  });

  it("detects test that flipped from pass to fail", () => {
    const runs = [
      { outcomes: { "a::test1": "pass" } },
      { outcomes: { "a::test1": "fail" } },
    ];
    const flaky = detectFlaky(runs);
    expect(flaky).toHaveLength(1);
    expect(flaky[0].test).toBe("a::test1");
    expect(flaky[0].lastStatus).toBe("fail");
  });

  it("does not flag consistently passing tests", () => {
    const runs = [
      { outcomes: { "a::test1": "pass" } },
      { outcomes: { "a::test1": "pass" } },
      { outcomes: { "a::test1": "pass" } },
    ];
    expect(detectFlaky(runs)).toEqual([]);
  });

  it("does not flag consistently failing tests", () => {
    const runs = [
      { outcomes: { "a::test1": "fail" } },
      { outcomes: { "a::test1": "fail" } },
    ];
    expect(detectFlaky(runs)).toEqual([]);
  });

  it("only considers last 10 runs", () => {
    // 11 passes then 1 fail — should still detect flaky
    const runs = [];
    for (let i = 0; i < 11; i++) {
      runs.push({ outcomes: { "a::test1": "pass" } });
    }
    runs.push({ outcomes: { "a::test1": "fail" } });
    const flaky = detectFlaky(runs);
    // Window is last 10: 9 passes + 1 fail = flaky
    expect(flaky).toHaveLength(1);
  });

  it("handles tests that appear in some runs but not others", () => {
    const runs = [
      { outcomes: { "a::test1": "pass" } },
      { outcomes: {} }, // test1 not present
      { outcomes: { "a::test1": "pass" } },
    ];
    // Only 2 statuses, both pass — not flaky
    expect(detectFlaky(runs)).toEqual([]);
  });
});
