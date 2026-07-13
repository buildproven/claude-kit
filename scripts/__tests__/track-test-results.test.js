const fs = require("fs");
const path = require("path");
const Module = require("module");
const childProcess = require("child_process");

const {
  detectFlaky,
  extractTestOutcomes,
  loadHistory,
} = require("../track-test-results");

// RESULTS_PATH / HISTORY_PATH are baked in from __dirname, and main() only runs
// under `require.main === module`. Re-compiling the source with require.main set
// lets us drive main() in-process (so v8 coverage sees it) while fs is stubbed —
// nothing is written to the real data/ directory. Source is read once, up front,
// so the fs.readFileSync spy can never intercept the module's own source read.
const SRC = path.join(__dirname, "..", "track-test-results.js");
const SOURCE = fs.readFileSync(SRC, "utf8");

// Emulate a real process.exit: stop execution at the call site.
class ExitSignal extends Error {
  constructor(code) {
    super(`exit:${code}`);
    this.code = code;
  }
}

function runAsMain() {
  const m = new Module(SRC, null);
  m.filename = SRC;
  m.paths = Module._nodeModulePaths(path.dirname(SRC));
  const prevMain = process.mainModule;
  process.mainModule = m;
  try {
    m._compile(SOURCE, SRC);
    return { code: 0 };
  } catch (e) {
    if (e instanceof ExitSignal) return { code: e.code };
    throw e;
  } finally {
    process.mainModule = prevMain;
  }
}

/**
 * Stub the filesystem for one main() run.
 * `results` / `history` are objects (serialized), a raw string (to test malformed
 * JSON), or null (to make the path look absent).
 * Returns the writeFileSync spy so tests can assert what was persisted.
 */
function stubFs({ results, history }) {
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ExitSignal(code);
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});

  const serialize = (v) => (typeof v === "string" ? v : JSON.stringify(v));

  vi.spyOn(fs, "existsSync").mockImplementation((p) =>
    String(p).endsWith("test-results.json") ? results !== null : true,
  );

  vi.spyOn(fs, "readFileSync").mockImplementation((p) => {
    const file = String(p);
    if (file.endsWith("test-results.json")) {
      if (results === null) throw new Error("ENOENT");
      return serialize(results);
    }
    if (file.endsWith("test-history.json")) {
      if (history === null) throw new Error("ENOENT");
      return serialize(history);
    }
    throw new Error(`unexpected read: ${file}`);
  });

  return vi.spyOn(fs, "writeFileSync").mockImplementation(() => {});
}

/** Parse the object that main() persisted to test-history.json. */
function writtenHistory(writeSpy) {
  const [file, payload] = writeSpy.mock.calls.at(-1);
  expect(String(file)).toContain("test-history.json");
  return JSON.parse(payload);
}

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

  it("falls back to suite.file when suite.name is absent", () => {
    const outcomes = extractTestOutcomes({
      testResults: [
        {
          file: "bar.test.js",
          assertionResults: [{ fullName: "runs", status: "passed" }],
        },
      ],
    });
    expect(outcomes).toEqual({ "bar.test.js::runs": "pass" });
  });

  it("uses 'unknown' when the suite has neither name nor file", () => {
    const outcomes = extractTestOutcomes({
      testResults: [
        { assertionResults: [{ fullName: "runs", status: "passed" }] },
      ],
    });
    expect(outcomes).toEqual({ "unknown::runs": "pass" });
  });

  it("falls back to test.title when fullName is absent", () => {
    const outcomes = extractTestOutcomes({
      testResults: [
        {
          name: "baz.test.js",
          assertionResults: [{ title: "short name", status: "passed" }],
        },
      ],
    });
    expect(outcomes).toEqual({ "baz.test.js::short name": "pass" });
  });

  it("tolerates a suite with no assertionResults", () => {
    expect(
      extractTestOutcomes({ testResults: [{ name: "empty.test.js" }] }),
    ).toEqual({});
  });

  it("maps any non-'passed' status to fail, including skipped", () => {
    // Notable: skipped/todo tests are recorded as failures, which is what makes
    // a conditionally-skipped test look flaky.
    const outcomes = extractTestOutcomes({
      testResults: [
        {
          name: "a.test.js",
          assertionResults: [
            { fullName: "skipped one", status: "skipped" },
            { fullName: "todo one", status: "todo" },
          ],
        },
      ],
    });
    expect(outcomes).toEqual({
      "a.test.js::skipped one": "fail",
      "a.test.js::todo one": "fail",
    });
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

  it("counts flips as the number of recorded statuses, not transitions", () => {
    // Named `flips`, but the source assigns statuses.length. A test seen 3 times
    // with a single pass→fail transition still reports flips: 3.
    const runs = [
      { outcomes: { "a::t": "pass" } },
      { outcomes: { "a::t": "pass" } },
      { outcomes: { "a::t": "fail" } },
    ];
    const [flaky] = detectFlaky(runs);
    expect(flaky.flips).toBe(3);
  });

  it("skips a test present in only one run of the window", () => {
    const runs = [
      { outcomes: { "a::stable": "pass", "a::once": "fail" } },
      { outcomes: { "a::stable": "pass" } },
    ];
    expect(detectFlaky(runs)).toEqual([]);
  });

  it("flags every flaky test independently", () => {
    const runs = [
      { outcomes: { "a::x": "pass", "a::y": "fail", "a::z": "pass" } },
      { outcomes: { "a::x": "fail", "a::y": "pass", "a::z": "pass" } },
    ];
    const names = detectFlaky(runs)
      .map((f) => f.test)
      .sort();
    expect(names).toEqual(["a::x", "a::y"]);
  });

  it("ignores flips older than the 10-run window", () => {
    // A fail in run 1, then 10 clean passes: the window no longer sees the fail.
    const runs = [{ outcomes: { "a::t": "fail" } }];
    for (let i = 0; i < 10; i++) runs.push({ outcomes: { "a::t": "pass" } });
    expect(detectFlaky(runs)).toEqual([]);
  });
});

// ─── loadHistory ──────────────────────────────────────────────────────────────

describe("loadHistory", () => {
  afterEach(() => vi.restoreAllMocks());

  it("parses an existing history file", () => {
    const stored = { version: 1, runs: [{ outcomes: {} }], flaky: [] };
    vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(stored));
    expect(loadHistory()).toEqual(stored);
  });

  it("returns an empty history when the file is missing", () => {
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    expect(loadHistory()).toEqual({ version: 1, runs: [], flaky: [] });
  });

  it("returns an empty history when the file is malformed JSON", () => {
    vi.spyOn(fs, "readFileSync").mockReturnValue("{ truncated");
    expect(loadHistory()).toEqual({ version: 1, runs: [], flaky: [] });
  });
});

// ─── main ─────────────────────────────────────────────────────────────────────

describe("main", () => {
  const passingResults = {
    testResults: [
      {
        name: "a.test.js",
        assertionResults: [{ fullName: "works", status: "passed" }],
      },
    ],
  };

  beforeEach(() => {
    vi.spyOn(childProcess, "execFileSync").mockImplementation((_cmd, args) =>
      args[0] === "branch" ? "main\n" : "abc1234\n",
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it("exits 0 without writing when the results file is absent", () => {
    const write = stubFs({ results: null, history: null });
    expect(runAsMain().code).toBe(0);
    expect(write).not.toHaveBeenCalled();
  });

  it("exits 0 without writing when the results file is malformed JSON", () => {
    const write = stubFs({ results: "{ not json", history: null });
    expect(runAsMain().code).toBe(0);
    expect(write).not.toHaveBeenCalled();
  });

  it("appends the run to a fresh history and exits 0 when nothing is flaky", () => {
    const write = stubFs({ results: passingResults, history: null });
    expect(runAsMain().code).toBe(0);

    const saved = writtenHistory(write);
    expect(saved.runs).toHaveLength(1);
    expect(saved.runs[0].outcomes).toEqual({ "a.test.js::works": "pass" });
    expect(saved.flaky).toEqual([]);
  });

  it("records branch and commit from git", () => {
    const write = stubFs({ results: passingResults, history: null });
    runAsMain();
    expect(writtenHistory(write).runs[0]).toMatchObject({
      branch: "main",
      commit: "abc1234",
    });
  });

  it("falls back to 'unknown' branch/commit when git is unavailable", () => {
    childProcess.execFileSync.mockImplementation(() => {
      throw new Error("not a git repository");
    });
    const write = stubFs({ results: passingResults, history: null });
    runAsMain();
    expect(writtenHistory(write).runs[0]).toMatchObject({
      branch: "unknown",
      commit: "unknown",
    });
  });

  it("exits 1 and records the flaky test when an outcome flips", () => {
    const write = stubFs({
      results: {
        testResults: [
          {
            name: "a.test.js",
            assertionResults: [{ fullName: "works", status: "failed" }],
          },
        ],
      },
      history: {
        version: 1,
        runs: [
          { date: "2026-01-01", outcomes: { "a.test.js::works": "pass" } },
        ],
        flaky: [],
      },
    });

    expect(runAsMain().code).toBe(1);

    const saved = writtenHistory(write);
    expect(saved.flaky).toEqual([
      { test: "a.test.js::works", flips: 2, lastStatus: "fail" },
    ]);
  });

  it("prunes the persisted history to the most recent 50 runs", () => {
    const runs = Array.from({ length: 50 }, (_, i) => ({
      date: `run-${i}`,
      outcomes: {},
    }));
    const write = stubFs({
      results: passingResults,
      history: { version: 1, runs, flaky: [] },
    });

    runAsMain();

    const saved = writtenHistory(write);
    expect(saved.runs).toHaveLength(50); // 51 appended, oldest dropped
    expect(saved.runs[0].date).toBe("run-1");
    expect(saved.runs.at(-1).outcomes).toEqual({ "a.test.js::works": "pass" });
  });
});
