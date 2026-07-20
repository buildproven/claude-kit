const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { score, loadConfig, deepMerge, DEFAULTS } = require("../risk-score");

/**
 * The risk-adaptive gate is the differentiated thing this toolkit ships: it reads
 * the diff and scales review depth accordingly. The pure scoring functions were
 * well covered; the surface a real repo actually touches — a per-repo
 * `harness-config.json` overriding policy, and the `score()` entry point that
 * ties git -> descriptors -> knobs — was not. That is the half a user configures.
 */
const repoWith = (config) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "risk-"));
  if (config)
    fs.writeFileSync(
      path.join(dir, "harness-config.json"),
      JSON.stringify(config),
    );
  return dir;
};

/** Fake `git` so the score can be driven from a known diff without a real repo. */
const gitRunner = (files) => (args) => {
  const cmd = args.join(" ");
  if (cmd.includes("merge-base")) return "BASE";
  if (cmd.includes("--numstat"))
    return `${files.map((f) => `${f.added}\t${f.deleted}\t${f.path}`).join("\0")}\0`;
  if (cmd.includes("--name-status"))
    return `${files.map((f) => `${f.status || "M"}\0${f.path}`).join("\0")}\0`;
  if (cmd.includes("diff")) return files.map((f) => f.patch || "").join("\n");
  return "";
};

describe("loadConfig — per-repo harness-config.json", () => {
  it("returns the defaults when no config file exists", () => {
    expect(loadConfig(repoWith(null))).toBe(DEFAULTS);
  });

  it("merges a repo's scorePolicy over the defaults", () => {
    const cfg = loadConfig(repoWith({ scorePolicy: { maxScore: 42 } }));
    expect(cfg.maxScore).toBe(42);
    // Untouched keys must survive the merge, not be replaced wholesale.
    expect(cfg.securityFloor).toEqual(
      expect.arrayContaining([
        ...DEFAULTS.securityFloor,
        ...DEFAULTS.humanFloor,
      ]),
    );
  });

  it("ignores a config with no scorePolicy block", () => {
    expect(loadConfig(repoWith({ somethingElse: true }))).toBe(DEFAULTS);
  });

  it("fails closed on malformed JSON", () => {
    const dir = repoWith(null);
    fs.writeFileSync(path.join(dir, "harness-config.json"), "{ not json");
    expect(() => loadConfig(dir)).toThrow();
  });

  it("cannot remove or lower the built-in security floor", () => {
    const cfg = loadConfig(
      repoWith({
        scorePolicy: {
          securityFloor: [],
          base: { securityFloor: 0 },
          curve: [{ maxScore: 100, agents: 2, codex: "skip", codexRounds: 0 }],
          codexForceFloor: 101,
        },
      }),
    );
    expect(cfg.securityFloor).toEqual(
      expect.arrayContaining(DEFAULTS.securityFloor),
    );
    expect(cfg.base.securityFloor).toBe(DEFAULTS.base.securityFloor);
  });
});

describe("score — Git-valid control-character paths", () => {
  it("parses NUL-delimited Git records and fails control paths into the security floor", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "risk-control-path-"));
    const git = (args) =>
      execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.name", "Risk Test"]);
    git(["config", "user.email", "risk@example.com"]);
    fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
    git(["add", "base.txt"]);
    git(["commit", "-q", "-m", "base"]);
    git(["switch", "-q", "-c", "feature"]);
    fs.mkdirSync(path.join(dir, "safe"));
    fs.writeFileSync(path.join(dir, "safe", "server.pem\n"), "private key\n");
    fs.writeFileSync(path.join(dir, "safe", "server.pem\r"), "private key\n");
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "add adversarial paths"]);

    const result = score({ base: "main", repoRoot: dir, gitRunner: git });
    expect(result.diffStats.files).toBe(2);
    expect(result.riskScore).toBeGreaterThanOrEqual(
      DEFAULTS.base.securityFloor,
    );
  });
});

describe("score — semantic policy failures", () => {
  it("rejects a non-finite policy before scoring", () => {
    const config = deepMerge(DEFAULTS, {
      mechanicalDelta: "not-a-number",
      curve: [{ maxScore: 100, agents: 6, codex: "high", codexRounds: 1 }],
    });
    expect(() =>
      score({
        base: "BASE",
        config,
        gitRunner: gitRunner([
          {
            path: "src/widget.js",
            status: "M",
            added: 1,
            deleted: 1,
            patch: "-// before\n+// after",
          },
        ]),
      }),
    ).toThrow(/mechanicalDelta must be a finite number/i);
  });

  it.each([null, false, {}, []])(
    "rejects wrong-type base.medium value %j",
    (medium) => {
      const config = deepMerge(DEFAULTS, { base: { medium } });
      expect(() => score({ base: "BASE", config })).toThrow(
        /base\.medium must be a finite number/i,
      );
    },
  );

  it("rejects a malformed curve instead of selecting a weak fallback", () => {
    const config = deepMerge(DEFAULTS, { curve: [null] });
    expect(() => score({ base: "BASE", config })).toThrow(
      /curve\[0\] must be an object/i,
    );
  });

  it.each([
    ["securityFloor", { securityFloor: {} }, /array of strings/i],
    ["high", { high: { 0: "**/docs/**" } }, /array of strings/i],
    ["curve", { curve: { 3: DEFAULTS.curve[3] } }, /non-empty array/i],
    ["base", { base: [] }, /base\.securityFloor must be a finite number/i],
    [
      "magnitude",
      { magnitude: [] },
      /magnitude\.linesForSmall must be a finite number/i,
    ],
  ])("rejects object/array type confusion for %s", (_name, override, error) => {
    expect(() =>
      score({ base: "BASE", config: deepMerge(DEFAULTS, override) }),
    ).toThrow(error);
  });

  it.each([false, "bad", 1, [], null])(
    "rejects a present non-object scorePolicy root %j",
    (scorePolicy) => {
      expect(() => loadConfig(repoWith({ scorePolicy }))).toThrow(
        /scorePolicy must be an object/i,
      );
    },
  );
});

describe("deepMerge", () => {
  it("merges nested objects instead of replacing them", () => {
    const out = deepMerge({ a: { x: 1, y: 2 } }, { a: { y: 9 } });
    expect(out).toEqual({ a: { x: 1, y: 9 } });
  });

  it("replaces arrays wholesale (a repo's list is the list)", () => {
    const out = deepMerge({ tiers: ["a", "b"] }, { tiers: ["c"] });
    expect(out.tiers).toEqual(["c"]);
  });

  it("returns the base untouched when the override is not an object", () => {
    const base = { a: 1 };
    expect(deepMerge(base, null)).toBe(base);
    expect(deepMerge(base, "nope")).toBe(base);
  });
});

describe("score — the end-to-end entry point", () => {
  it("scores a mechanical doc change low and a security-surface change high", () => {
    const docs = score({
      gitRunner: gitRunner([
        { path: "docs/readme.md", added: 3, deleted: 0, patch: "+ a line" },
      ]),
      config: DEFAULTS,
    });

    const workflow = score({
      gitRunner: gitRunner([
        {
          path: ".github/workflows/ci.yml",
          added: 3,
          deleted: 0,
          patch: "+ run: deploy",
        },
      ]),
      config: DEFAULTS,
    });

    // The whole premise of the gate: risk drives review depth.
    expect(workflow.riskScore).toBeGreaterThan(docs.riskScore);
    // A CI-workflow change is security surface — it must escalate Codex effort,
    // not merely "enable" it.
    expect(workflow.knobs.codex).toBe("xhigh");
  });

  it("honors a repo's own policy over the defaults", () => {
    // A repo declaring its own security floor must have it respected.
    const dir = repoWith({
      scorePolicy: { securityFloor: ["**/payments/**"] },
    });
    const out = score({
      gitRunner: gitRunner([
        { path: "src/payments/charge.js", added: 1, deleted: 0, patch: "+x=1" },
      ]),
      repoRoot: dir,
    });
    expect(out.riskScore).toBeGreaterThanOrEqual(DEFAULTS.curve[0].maxScore);
  });

  it("returns a usable result for an empty diff rather than throwing", () => {
    const out = score({ gitRunner: gitRunner([]), config: DEFAULTS });
    expect(out).toHaveProperty("riskScore");
    expect(out).toHaveProperty("knobs");
  });

  it("loads base and HEAD manifests before assigning semantic risk", () => {
    const dir = repoWith(null);
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: dir,
    });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ description: "before" }),
    );
    execFileSync("git", ["add", "package.json"], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", "base"], { cwd: dir });
    execFileSync("git", ["switch", "-q", "-c", "feature"], { cwd: dir });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ description: "after" }),
    );
    execFileSync("git", ["commit", "-qam", "metadata"], { cwd: dir });

    const runGit = (args) =>
      execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
    expect(
      score({ base: "main", gitRunner: runGit, config: DEFAULTS }).riskScore,
    ).toBeLessThanOrEqual(20);

    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        description: "after",
        scripts: { postinstall: "node install.js" },
      }),
    );
    execFileSync("git", ["commit", "-qam", "install hook"], { cwd: dir });
    expect(
      score({ base: "main", gitRunner: runGit, config: DEFAULTS }).riskScore,
    ).toBeGreaterThanOrEqual(DEFAULTS.base.securityFloor);
  });
});
