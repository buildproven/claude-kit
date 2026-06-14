const {
  computeScore,
  classifyChangeNature,
  scoreToKnobs,
  matchesPattern,
  fileIsMechanical,
  isForcedLogic,
  deepMerge,
  DEFAULTS,
} = require("../risk-score");

// Helper: build a descriptor.
function d(file, status = "M", patch = "", lines = 10, isBinary = false) {
  return { file, status, isBinary, lines, patch };
}

// Helper: full score from a descriptor list (computes diffStats from lines).
function scoreOf(descriptors, cfg = DEFAULTS) {
  const diffStats = {
    files: descriptors.length,
    lines: descriptors.reduce((n, x) => n + (x.lines || 0), 0),
  };
  return computeScore(descriptors, diffStats, cfg);
}

// ─── glob matcher ────────────────────────────────────────────────────────────

describe("globToRegExp / matchesPattern", () => {
  it("** matches across path separators and zero dirs", () => {
    expect(matchesPattern("a/b/c.js", ["**/c.js"])).toBe(true);
    expect(matchesPattern("c.js", ["**/c.js"])).toBe(true);
    expect(
      matchesPattern(".github/workflows/ci.yml", ["**/.github/workflows/**"]),
    ).toBe(true);
  });
  it("* stays within a segment", () => {
    expect(matchesPattern("lib/a.js", ["lib/*.js"])).toBe(true);
    expect(matchesPattern("lib/sub/a.js", ["lib/*.js"])).toBe(false);
  });
  it("escapes regex metachars in literals", () => {
    expect(matchesPattern("package.json", ["**/package.json"])).toBe(true);
    expect(matchesPattern("packageXjson", ["**/package.json"])).toBe(false);
  });
});

// ─── change nature ──────────────────────────────────────────────────────────

describe("classifyChangeNature", () => {
  const floor = DEFAULTS.securityFloor;

  it("comment-only JS change → mechanical", () => {
    expect(
      classifyChangeNature([d("lib/util.js", "M", "+// a note\n+\n")], floor),
    ).toBe("mechanical");
  });
  it("new test file → mechanical", () => {
    expect(
      classifyChangeNature([d("tests/new.test.js", "A", "+stuff")], floor),
    ).toBe("mechanical");
  });
  it("additive-only edit to existing test → mechanical", () => {
    expect(
      classifyChangeNature(
        [d("x.test.js", "M", '+it("more", () => {})')],
        floor,
      ),
    ).toBe("mechanical");
  });
  it("a real logic line → logic", () => {
    expect(
      classifyChangeNature([d("lib/a.js", "M", "+if (x) doThing()")], floor),
    ).toBe("logic");
  });
  it("deletion is forced logic", () => {
    expect(classifyChangeNature([d("lib/a.js", "D", "")], floor)).toBe("logic");
  });
  it(".github/workflows is forced logic even if comment-only", () => {
    expect(
      classifyChangeNature(
        [d(".github/workflows/ci.yml", "M", "+# note")],
        floor,
      ),
    ).toBe("logic");
  });
  it("executable prompt surface (skills/) is forced logic", () => {
    expect(
      classifyChangeNature(
        [d("skills/quality/SKILL.md", "M", "+<!-- note -->")],
        floor,
      ),
    ).toBe("logic");
  });
  it("directive comment (eslint-disable) is NOT inert → logic", () => {
    expect(
      classifyChangeNature(
        [d("lib/a.js", "M", "+// eslint-disable-next-line")],
        floor,
      ),
    ).toBe("logic");
  });
  it("floor file comment-only is NOT mechanical → logic", () => {
    expect(
      classifyChangeNature([d("lib/licensing.js", "M", "+// note")], floor),
    ).toBe("logic");
  });
  it("one logic file taints a mixed set", () => {
    expect(
      classifyChangeNature(
        [d("a.test.js", "A", "+x"), d("lib/a.js", "M", "+if(y)z()")],
        floor,
      ),
    ).toBe("logic");
  });
  it("empty changeset → logic", () => {
    expect(classifyChangeNature([], floor)).toBe("logic");
  });
});

// ─── scoring invariants (the plan's critical cases) ──────────────────────────

describe("computeScore — security floor never beaten by mechanical", () => {
  it("comment-only licensing.js stays ≥ security floor", () => {
    const r = scoreOf([d("lib/licensing.js", "M", "+// note", 2)]);
    expect(r.riskScore).toBeGreaterThanOrEqual(DEFAULTS.base.securityFloor);
  });
  it("comment-only .github/workflows stays high", () => {
    const r = scoreOf([d(".github/workflows/quality.yml", "M", "+# note", 1)]);
    expect(r.riskScore).toBeGreaterThanOrEqual(DEFAULTS.base.securityFloor);
  });
  it("package.json touch pins the floor", () => {
    const r = scoreOf([d("package.json", "M", '+  "x": "1",', 1)]);
    expect(r.riskScore).toBeGreaterThanOrEqual(DEFAULTS.base.securityFloor);
  });
});

describe("computeScore — large mechanical diff is not low-risk", () => {
  it("600-line additive test does not drop to the trivial band", () => {
    const r = scoreOf([d("tests/big.test.js", "A", "+x", 600)]);
    // mechanical downgrade is suppressed above the cap, and magnitude adds.
    expect(r.changeNature).toBe("mechanical");
    expect(r.riskScore).toBeGreaterThan(20);
  });
});

describe("computeScore — trivial change goes low (but never zero handling)", () => {
  it("tiny comment-only change in a docs file → low score", () => {
    const r = scoreOf([d("docs/readme-notes.md", "M", "+<!-- note -->", 1)]);
    expect(r.riskScore).toBeLessThanOrEqual(20);
  });
  it("small logic change in a plain source file → medium-ish, not floor", () => {
    const r = scoreOf([d("lib/widget.js", "M", "+if (a) b()", 5)]);
    expect(r.riskScore).toBeGreaterThan(20);
    expect(r.riskScore).toBeLessThan(DEFAULTS.base.securityFloor);
  });
});

// ─── score → knobs (Moderate curve) ──────────────────────────────────────────

describe("scoreToKnobs — Moderate curve", () => {
  it("score 10 → 2 agents, no codex", () => {
    expect(scoreToKnobs(10, DEFAULTS)).toEqual({
      agents: 2,
      codex: "skip",
      codexRounds: 0,
    });
  });
  it("score 40 → 4 agents, codex high x1", () => {
    expect(scoreToKnobs(40, DEFAULTS)).toEqual({
      agents: 4,
      codex: "high",
      codexRounds: 1,
    });
  });
  it("score 70 → 6 agents, codex high x1", () => {
    expect(scoreToKnobs(70, DEFAULTS)).toEqual({
      agents: 6,
      codex: "high",
      codexRounds: 1,
    });
  });
  it("score 90 → 6 agents, codex xhigh x2", () => {
    expect(scoreToKnobs(90, DEFAULTS)).toEqual({
      agents: 6,
      codex: "xhigh",
      codexRounds: 2,
    });
  });
  it("codexForceFloor: a ≥75 score never has codex skip", () => {
    // craft a band where skip might apply but force-floor overrides
    const cfg = deepMerge(DEFAULTS, {
      curve: [{ maxScore: 100, agents: 2, codex: "skip", codexRounds: 0 }],
    });
    expect(scoreToKnobs(80, cfg).codex).not.toBe("skip");
  });
});

// ─── config override merge ───────────────────────────────────────────────────

describe("deepMerge / override", () => {
  it("repo scorePolicy overrides defaults but keeps unspecified keys", () => {
    const merged = deepMerge(DEFAULTS, { base: { medium: 99 } });
    expect(merged.base.medium).toBe(99);
    expect(merged.base.securityFloor).toBe(DEFAULTS.base.securityFloor);
  });
  it("a repo can extend securityFloor via override", () => {
    const cfg = deepMerge(DEFAULTS, { securityFloor: ["**/custom-secret.ts"] });
    const r = scoreOf([d("src/custom-secret.ts", "M", "+// note", 1)], cfg);
    expect(r.riskScore).toBeGreaterThanOrEqual(DEFAULTS.base.securityFloor);
  });
});

// ─── helpers exposed for reuse ───────────────────────────────────────────────

describe("isForcedLogic / fileIsMechanical", () => {
  it("binary files are forced logic", () => {
    expect(isForcedLogic("img.png", "M", true)).toBe(true);
  });
  it("rename is forced logic", () => {
    expect(isForcedLogic("lib/a.js", "R", false)).toBe(true);
  });
  it("floor file is never mechanical", () => {
    expect(
      fileIsMechanical("package.json", "M", "+// note", DEFAULTS.securityFloor),
    ).toBe(false);
  });
});
