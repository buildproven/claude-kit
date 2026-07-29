import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const INVOCATION = path.join(ROOT, "scripts", "quality-invocation.js");
const MUTATION = path.join(ROOT, "scripts", "quality-mutation-check.sh");

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function fixture(label, testBody, options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), `quality-mutation-${label}-`));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.name", "Quality Test"]);
  git(root, ["config", "user.email", "quality@example.com"]);
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      scripts: {
        lint: "true",
        test: "node logic.test.js",
        "security:audit": "true",
      },
    }),
  );
  const source = options.shellSource
    ? "policy.sh"
    : options.addedSource
      ? "policy.js"
      : "logic.js";
  if (!options.addedSource) {
    writeFileSync(
      path.join(root, source),
      options.shellSource
        ? "is_allowed() { return 1; }\n"
        : "exports.isAllowed = () => false;\n",
    );
  }
  writeFileSync(path.join(root, "logic.test.js"), testBody);
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "base"]);
  git(root, ["remote", "add", "origin", root]);
  git(root, ["fetch", "-q", "origin", "main"]);
  git(root, ["switch", "-q", "-c", "feature"]);
  if (options.uncoveredSource) {
    writeFileSync(
      path.join(root, "aaa-uncovered.js"),
      "exports.uncovered = true;\n",
    );
    git(root, ["add", "aaa-uncovered.js"]);
  }
  writeFileSync(
    path.join(root, source),
    options.shellSource
      ? "is_allowed() { return 0; }\n"
      : "exports.isAllowed = (role) => role === 'admin';\n",
  );
  git(root, ["add", source]);
  git(root, ["commit", "-qm", "feat: authorize admin"]);
  const manifest = execFileSync(
    "node",
    [INVOCATION, "create", "--repo", root, "--base-ref", "origin/main"],
    { cwd: root, encoding: "utf8" },
  ).trim();
  execFileSync(
    "node",
    [
      INVOCATION,
      "risk",
      manifest,
      "--tier",
      "high",
      "--task-type",
      "feature",
      "--score",
      "50",
      "--agents",
      "2",
      "--codex-depth",
      "high",
      "--codex-rounds",
      "1",
    ],
    { cwd: root },
  );
  if (options.checkSeconds) {
    const state = JSON.parse(readFileSync(manifest, "utf8"));
    state.risk.runtime.checkSeconds = options.checkSeconds;
    state.risk.runtime.checkReserveSeconds = 0;
    writeFileSync(manifest, `${JSON.stringify(state, null, 2)}\n`);
  }
  return { root, manifest };
}

function runMutation(root, manifest, env = {}) {
  try {
    return execFileSync("bash", [MUTATION, "--manifest", manifest], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
  } catch (error) {
    throw new Error(error.stderr.toString(), { cause: error });
  }
}

describe("config-promotion filter", () => {
  // Exercises the awk filter from quality-mutation-check.sh directly: cheap
  // coverage of every lockfile spelling, which full fixtures cannot afford.
  // A wrong pattern here silently promotes a lockfile, and reverting one
  // mid-run changes the test command the sandbox is about to execute.
  function promote(paths) {
    const script = readFileSync(MUTATION, "utf8");
    const block =
      /\/\(\^\|\\\/\)\(test\|tests\|spec\|__tests__\)[\s\S]*?\{ print \}/.exec(
        script.slice(script.indexOf("CONFIG_CANDIDATE")),
      );
    if (!block) throw new Error("config-promotion awk block not found");
    return execFileSync("awk", [block[0]], {
      input: `${paths.join("\n")}\n`,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
  }

  it("excludes every dependency manifest and lockfile spelling", () => {
    expect(
      promote([
        "package.json",
        "package-lock.json",
        "npm-shrinkwrap.json",
        "yarn.lock",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "poetry.lock",
        "uv.lock",
        "Cargo.toml",
        "Cargo.lock",
        "composer.json",
        "go.sum",
      ]),
    ).toEqual([]);
  });

  it("still promotes genuine config files", () => {
    expect(
      promote([
        "policy.yml",
        "tsconfig.json",
        ".github/workflows/ci.yml",
        "ruff.toml",
      ]),
    ).toEqual([
      "policy.yml",
      "tsconfig.json",
      ".github/workflows/ci.yml",
      "ruff.toml",
    ]);
  });

  it("never promotes a test path", () => {
    expect(promote(["__tests__/fixture.json", "spec/config.yml"])).toEqual([]);
  });
});

describe("quality-mutation-check", () => {
  it("fails when a vacuous test stays green after the changed behavior is reverted", () => {
    const { root, manifest } = fixture(
      "vacuous",
      "const { isAllowed } = require('./logic');\nif (typeof isAllowed !== 'function') process.exit(1);\n",
    );
    expect(() => runMutation(root, manifest)).toThrow(
      /no red-capable evidence/,
    );
  });

  it("records evidence when a behavioral test turns red after the controlled revert", () => {
    const { root, manifest } = fixture(
      "meaningful",
      "const { isAllowed } = require('./logic');\nif (!isAllowed('admin')) process.exit(1);\n",
    );
    expect(runMutation(root, manifest)).toMatch(
      /mutation evidence: revert-diff/,
    );
    const stateRoot = execFileSync(
      "node",
      [INVOCATION, "field", manifest, "stateRoot"],
      { encoding: "utf8" },
    ).trim();
    const head = execFileSync(
      "node",
      [INVOCATION, "field", manifest, "revisions.currentHead"],
      {
        encoding: "utf8",
      },
    ).trim();
    const artifact = JSON.parse(
      readFileSync(path.join(stateRoot, "mutation", `${head}.json`), "utf8"),
    );
    expect(artifact).toMatchObject({
      method: "revert-diff",
      mutatedPaths: ["logic.js"],
      testFailureObserved: true,
    });
    const state = JSON.parse(readFileSync(manifest, "utf8"));
    expect(state.governor.activeExecution).toBeNull();
    expect(state.governor.gateSecondsUsed).toBeGreaterThanOrEqual(1);
  });

  it("runs reverted tests with a private HOME and XDG state", () => {
    const witness = path.join(
      mkdtempSync(path.join(tmpdir(), "quality-mutation-home-witness-")),
      "home.txt",
    );
    const { root, manifest } = fixture(
      "home-isolation",
      "const { writeFileSync } = require('node:fs');\n"
        + "const { isAllowed } = require('./logic');\n"
        + "writeFileSync(process.env.MUTATION_HOME_WITNESS, process.env.HOME);\n"
        + "if (!isAllowed('admin')) process.exit(1);\n",
    );

    expect(
      runMutation(root, manifest, { MUTATION_HOME_WITNESS: witness }),
    ).toMatch(/mutation evidence: revert-diff/);
    const sandboxHome = readFileSync(witness, "utf8");
    expect(sandboxHome).not.toBe(process.env.HOME);
    expect(sandboxHome).toContain("quality-mutation.");
  });

  it("removes an added source file to produce revision-bound evidence", () => {
    const { root, manifest } = fixture(
      "added-source",
      "const { isAllowed } = require('./policy');\nif (!isAllowed('admin')) process.exit(1);\n",
      { addedSource: true },
    );
    expect(runMutation(root, manifest)).toMatch(
      /mutation evidence: revert-diff/,
    );
    const stateRoot = execFileSync(
      "node",
      [INVOCATION, "field", manifest, "stateRoot"],
      { encoding: "utf8" },
    ).trim();
    const head = execFileSync(
      "node",
      [INVOCATION, "field", manifest, "revisions.currentHead"],
      { encoding: "utf8" },
    ).trim();
    const artifact = JSON.parse(
      readFileSync(path.join(stateRoot, "mutation", `${head}.json`), "utf8"),
    );
    expect(artifact.mutatedPaths).toEqual(["policy.js"]);
  });

  it("records evidence for a behavioral test of changed shell source", () => {
    const { root, manifest } = fixture(
      "shell-meaningful",
      "const { spawnSync } = require('node:child_process');\nconst result = spawnSync('bash', ['-c', 'source ./policy.sh; is_allowed']);\nif (result.status !== 0) process.exit(1);\n",
      { shellSource: true },
    );
    expect(runMutation(root, manifest)).toMatch(
      /mutation evidence: revert-diff/,
    );
    const stateRoot = execFileSync(
      "node",
      [INVOCATION, "field", manifest, "stateRoot"],
      { encoding: "utf8" },
    ).trim();
    const head = execFileSync(
      "node",
      [INVOCATION, "field", manifest, "revisions.currentHead"],
      { encoding: "utf8" },
    ).trim();
    const artifact = JSON.parse(
      readFileSync(path.join(stateRoot, "mutation", `${head}.json`), "utf8"),
    );
    expect(artifact.mutatedPaths).toEqual(["policy.sh"]);
  });

  it("rejects a vacuous shell test that stays green after the revert", () => {
    const { root, manifest } = fixture(
      "shell-vacuous",
      "const { existsSync } = require('node:fs');\nif (!existsSync('policy.sh')) process.exit(1);\n",
      { shellSource: true },
    );
    expect(() => runMutation(root, manifest)).toThrow(
      /no red-capable evidence/,
    );
  });

  it("records only the candidate whose revert made the tests turn red", () => {
    const { root, manifest } = fixture(
      "proven-path",
      "const { isAllowed } = require('./logic');\nif (!isAllowed('admin')) process.exit(1);\n",
      { uncoveredSource: true },
    );
    expect(runMutation(root, manifest)).toMatch(
      /mutation evidence: revert-diff/,
    );
    const stateRoot = execFileSync(
      "node",
      [INVOCATION, "field", manifest, "stateRoot"],
      { encoding: "utf8" },
    ).trim();
    const head = execFileSync(
      "node",
      [INVOCATION, "field", manifest, "revisions.currentHead"],
      { encoding: "utf8" },
    ).trim();
    const artifact = JSON.parse(
      readFileSync(path.join(stateRoot, "mutation", `${head}.json`), "utf8"),
    );
    expect(artifact.mutatedPaths).toEqual(["logic.js"]);
  });

  it("skips the gate when the diff touches only a submodule pointer bump", () => {
    const submodule = mkdtempSync(
      path.join(tmpdir(), "quality-mutation-gitlink-submodule-"),
    );
    git(submodule, ["init", "-q", "-b", "main"]);
    git(submodule, ["config", "user.name", "Quality Test"]);
    git(submodule, ["config", "user.email", "quality@example.com"]);
    writeFileSync(path.join(submodule, "file.txt"), "v1\n");
    git(submodule, ["add", "."]);
    git(submodule, ["commit", "-q", "-m", "v1"]);
    writeFileSync(path.join(submodule, "file.txt"), "v2\n");
    git(submodule, ["add", "."]);
    git(submodule, ["commit", "-q", "-m", "v2"]);

    const root = mkdtempSync(path.join(tmpdir(), "quality-mutation-gitlink-"));
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["config", "user.name", "Quality Test"]);
    git(root, ["config", "user.email", "quality@example.com"]);
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: { lint: "true", test: "true", "security:audit": "true" },
      }),
    );
    git(root, [
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      submodule,
      "sub",
    ]);
    git(root, [
      "-C",
      "sub",
      "checkout",
      "-q",
      execFileSync(
        "git",
        ["-C", submodule, "rev-list", "--max-parents=0", "HEAD"],
        {
          encoding: "utf8",
        },
      ).trim(),
    ]);
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "base"]);
    git(root, ["remote", "add", "origin", root]);
    git(root, ["fetch", "-q", "origin", "main"]);
    git(root, ["switch", "-q", "-c", "feature"]);
    git(root, [
      "-c",
      "protocol.file.allow=always",
      "-C",
      "sub",
      "pull",
      "-q",
      "origin",
      "main",
    ]);
    git(root, ["add", "sub"]);
    git(root, ["commit", "-qm", "chore: bump sub submodule"]);

    const manifest = execFileSync(
      "node",
      [INVOCATION, "create", "--repo", root, "--base-ref", "origin/main"],
      { cwd: root, encoding: "utf8" },
    ).trim();
    execFileSync(
      "node",
      [
        INVOCATION,
        "risk",
        manifest,
        "--tier",
        "high",
        "--task-type",
        "feature",
        "--score",
        "50",
        "--agents",
        "2",
        "--codex-depth",
        "high",
        "--codex-rounds",
        "1",
      ],
      { cwd: root },
    );

    expect(runMutation(root, manifest)).toMatch(
      /mutation gate omitted: diff touches only submodule pointers/,
    );

    const state = JSON.parse(readFileSync(manifest, "utf8"));
    expect(state.mutation).not.toBeNull();
    expect(state.mutation.head).toBe(state.revisions.currentHead);
    const artifact = JSON.parse(
      readFileSync(state.mutation.artifactPath, "utf8"),
    );
    expect(artifact).toMatchObject({
      method: "gitlink-skip",
      mutatedPaths: [],
      testFailureObserved: false,
    });
  });

  it("skips the gate when the diff changes only dependency manifests", () => {
    const root = mkdtempSync(path.join(tmpdir(), "quality-mutation-manifest-"));
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["config", "user.name", "Quality Test"]);
    git(root, ["config", "user.email", "quality@example.com"]);
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: { lint: "true", test: "true", "security:audit": "true" },
        devDependencies: { "left-pad": "^1.0.0" },
      }),
    );
    writeFileSync(
      path.join(root, "package-lock.json"),
      JSON.stringify({ lockfileVersion: 3, packages: {} }),
    );
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "base"]);
    git(root, ["remote", "add", "origin", root]);
    git(root, ["fetch", "-q", "origin", "main"]);
    git(root, ["switch", "-q", "-c", "feature"]);

    // A security bump: dependency manifests only, no executable source.
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: { lint: "true", test: "true", "security:audit": "true" },
        devDependencies: { "left-pad": "^1.3.0" },
      }),
    );
    writeFileSync(
      path.join(root, "package-lock.json"),
      JSON.stringify({ lockfileVersion: 3, packages: { "": {} } }),
    );
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "fix(security): bump left-pad"]);

    const manifest = execFileSync(
      "node",
      [INVOCATION, "create", "--repo", root, "--base-ref", "origin/main"],
      { cwd: root, encoding: "utf8" },
    ).trim();
    execFileSync(
      "node",
      [
        INVOCATION,
        "risk",
        manifest,
        "--tier",
        "critical",
        "--task-type",
        "bugfix",
        "--score",
        "100",
        "--agents",
        "2",
        "--codex-depth",
        "xhigh",
        "--codex-rounds",
        "1",
      ],
      { cwd: root },
    );

    expect(runMutation(root, manifest)).toMatch(
      /mutation gate omitted: diff contains no source file to mutate/,
    );

    const state = JSON.parse(readFileSync(manifest, "utf8"));
    expect(state.mutation).not.toBeNull();
    expect(state.mutation.head).toBe(state.revisions.currentHead);
    const artifact = JSON.parse(
      readFileSync(state.mutation.artifactPath, "utf8"),
    );
    expect(artifact).toMatchObject({
      method: "no-mutable-source",
      mutatedPaths: [],
      testFailureObserved: false,
    });
  });

  it("proves evidence by reverting a config file its test guards", () => {
    // A workflow/policy file plus the test that guards it has no executable
    // source to revert, but a behavioral check exists: revert the config and
    // the test must go red. The config is promoted to a candidate so the
    // normal revert-diff loop proves it (BUI-511).
    const root = mkdtempSync(path.join(tmpdir(), "quality-mutation-config-"));
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["config", "user.name", "Quality Test"]);
    git(root, ["config", "user.email", "quality@example.com"]);
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: {
          lint: "true",
          test: "node run-policy-test.js",
          "security:audit": "true",
        },
      }),
    );
    // Test lives under __tests__/ so it is excluded from CANDIDATES; the
    // runner shim at the root keeps the package.json test command simple.
    execFileSync("mkdir", ["-p", path.join(root, "__tests__")]);
    writeFileSync(
      path.join(root, "run-policy-test.js"),
      "require('./__tests__/policy.test.js');\n",
    );
    const guardTest =
      "const fs=require('node:fs');\nconst s=fs.readFileSync(__dirname+'/../policy.yml','utf8');\nif(!s.includes('beta')) process.exit(1);\n";
    writeFileSync(path.join(root, "policy.yml"), "allow:\n  - alpha\n");
    writeFileSync(path.join(root, "__tests__", "policy.test.js"), guardTest);
    git(root, ["add", "."]);
    // Base must be green: add beta later, so seed the test as a no-op first.
    writeFileSync(
      path.join(root, "__tests__", "policy.test.js"),
      "process.exit(0);\n",
    );
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "base"]);
    git(root, ["remote", "add", "origin", root]);
    git(root, ["fetch", "-q", "origin", "main"]);
    git(root, ["switch", "-q", "-c", "feature"]);

    // Config gains 'beta'; its guarding test is tightened alongside.
    writeFileSync(
      path.join(root, "policy.yml"),
      "allow:\n  - alpha\n  - beta\n",
    );
    writeFileSync(path.join(root, "__tests__", "policy.test.js"), guardTest);
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "feat: allow beta"]);

    const manifest = execFileSync(
      "node",
      [INVOCATION, "create", "--repo", root, "--base-ref", "origin/main"],
      { cwd: root, encoding: "utf8" },
    ).trim();
    execFileSync(
      "node",
      [
        INVOCATION,
        "risk",
        manifest,
        "--tier",
        "high",
        "--task-type",
        "feature",
        "--score",
        "50",
        "--agents",
        "2",
        "--codex-depth",
        "high",
        "--codex-rounds",
        "1",
      ],
      { cwd: root },
    );

    expect(runMutation(root, manifest)).toMatch(
      /mutation evidence: revert-diff/,
    );

    const state = JSON.parse(readFileSync(manifest, "utf8"));
    const artifact = JSON.parse(
      readFileSync(state.mutation.artifactPath, "utf8"),
    );
    expect(artifact).toMatchObject({
      method: "revert-diff",
      mutatedPaths: ["policy.yml"],
      testFailureObserved: true,
    });
  });

  it("still fails closed when a config change has no covering test", () => {
    // The promoted-config path must still demand real evidence: if reverting
    // the config leaves the suite green, the test never covered it.
    const root = mkdtempSync(path.join(tmpdir(), "quality-mutation-cfgvac-"));
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["config", "user.name", "Quality Test"]);
    git(root, ["config", "user.email", "quality@example.com"]);
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: {
          lint: "true",
          test: "node run-policy-test.js",
          "security:audit": "true",
        },
      }),
    );
    execFileSync("mkdir", ["-p", path.join(root, "__tests__")]);
    writeFileSync(
      path.join(root, "run-policy-test.js"),
      "require('./__tests__/policy.test.js');\n",
    );
    writeFileSync(path.join(root, "policy.yml"), "allow:\n  - alpha\n");
    writeFileSync(
      path.join(root, "__tests__", "policy.test.js"),
      "process.exit(0);\n",
    );
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "base"]);
    git(root, ["remote", "add", "origin", root]);
    git(root, ["fetch", "-q", "origin", "main"]);
    git(root, ["switch", "-q", "-c", "feature"]);

    writeFileSync(
      path.join(root, "policy.yml"),
      "allow:\n  - alpha\n  - beta\n",
    );
    // The test file DOES change (so the config gets promoted), but the new
    // assertion is vacuous: it passes regardless of policy.yml content.
    writeFileSync(
      path.join(root, "__tests__", "policy.test.js"),
      "const fs=require('node:fs');\nfs.readFileSync(__dirname+'/../policy.yml','utf8');\nprocess.exit(0);\n",
    );
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "feat: allow beta"]);

    const manifest = execFileSync(
      "node",
      [INVOCATION, "create", "--repo", root, "--base-ref", "origin/main"],
      { cwd: root, encoding: "utf8" },
    ).trim();
    execFileSync(
      "node",
      [
        INVOCATION,
        "risk",
        manifest,
        "--tier",
        "high",
        "--task-type",
        "feature",
        "--score",
        "50",
        "--agents",
        "2",
        "--codex-depth",
        "high",
        "--codex-rounds",
        "1",
      ],
      { cwd: root },
    );

    // Assert the REASON, not merely that it threw — otherwise an unrelated
    // crash would satisfy this test.
    expect(() => runMutation(root, manifest)).toThrow(
      /no red-capable evidence/,
    );
    const state = JSON.parse(readFileSync(manifest, "utf8"));
    expect(state.mutation).toBeNull();
  });

  it("does not promote dependency manifests as config candidates", () => {
    // A routine dependency bump that also touches a test file must NOT be
    // read as a guarded-config change: reverting package.json mid-run would
    // change the very test command the sandbox is about to execute. Such
    // diffs belong to the no-mutable-source path instead.
    const root = mkdtempSync(path.join(tmpdir(), "quality-mutation-deps-"));
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["config", "user.name", "Quality Test"]);
    git(root, ["config", "user.email", "quality@example.com"]);
    const pkg = (dep) =>
      JSON.stringify({
        scripts: {
          lint: "true",
          test: "node __tests__/policy.test.js",
          "security:audit": "true",
        },
        devDependencies: { "left-pad": dep },
      });
    writeFileSync(path.join(root, "package.json"), pkg("^1.0.0"));
    writeFileSync(
      path.join(root, "package-lock.json"),
      JSON.stringify({ lockfileVersion: 3, packages: {} }),
    );
    execFileSync("mkdir", ["-p", path.join(root, "__tests__")]);
    writeFileSync(
      path.join(root, "__tests__", "policy.test.js"),
      "process.exit(0);\n",
    );
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "base"]);
    git(root, ["remote", "add", "origin", root]);
    git(root, ["fetch", "-q", "origin", "main"]);
    git(root, ["switch", "-q", "-c", "feature"]);

    writeFileSync(path.join(root, "package.json"), pkg("^1.3.0"));
    writeFileSync(
      path.join(root, "package-lock.json"),
      JSON.stringify({ lockfileVersion: 3, packages: { "": {} } }),
    );
    writeFileSync(
      path.join(root, "__tests__", "policy.test.js"),
      "// touched alongside the bump\nprocess.exit(0);\n",
    );
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "chore: bump left-pad"]);

    const manifest = execFileSync(
      "node",
      [INVOCATION, "create", "--repo", root, "--base-ref", "origin/main"],
      { cwd: root, encoding: "utf8" },
    ).trim();
    execFileSync(
      "node",
      [
        INVOCATION,
        "risk",
        manifest,
        "--tier",
        "high",
        "--task-type",
        "feature",
        "--score",
        "50",
        "--agents",
        "2",
        "--codex-depth",
        "high",
        "--codex-rounds",
        "1",
      ],
      { cwd: root },
    );

    // package.json must NOT be promoted — reverting it would change the very
    // test command the sandbox runs. With the manifest excluded and a changed
    // test present, nothing is promoted and nothing is skipped: the gate fails
    // closed, which is the correct conservative outcome for an ambiguous diff
    // (consistent with the BUI-483 finding that changed tests must not be
    // waved through). The assertion pins the reason, not merely the throw.
    expect(() => runMutation(root, manifest)).toThrow(
      /no changed executable source file can be reverted/,
    );
    const state = JSON.parse(readFileSync(manifest, "utf8"));
    expect(state.mutation).toBeNull();
  });

  it("still runs the gate when the diff changes only test files", () => {
    // The candidate filter drops test paths, so a test-only diff also yields
    // zero candidates. It must NOT be waved through as "no mutable source" —
    // otherwise weakening a test would bypass mutation verification.
    const root = mkdtempSync(path.join(tmpdir(), "quality-mutation-testonly-"));
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["config", "user.name", "Quality Test"]);
    git(root, ["config", "user.email", "quality@example.com"]);
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: {
          lint: "true",
          test: "node __tests__/logic.test.js",
          "security:audit": "true",
        },
      }),
    );
    writeFileSync(
      path.join(root, "logic.js"),
      "exports.isAllowed = () => 1;\n",
    );
    execFileSync("mkdir", ["-p", path.join(root, "__tests__")]);
    writeFileSync(
      path.join(root, "__tests__", "logic.test.js"),
      "require('../logic');\n",
    );
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "base"]);
    git(root, ["remote", "add", "origin", root]);
    git(root, ["fetch", "-q", "origin", "main"]);
    git(root, ["switch", "-q", "-c", "feature"]);

    writeFileSync(
      path.join(root, "__tests__", "logic.test.js"),
      "const { isAllowed } = require('../logic');\nif (!isAllowed()) process.exit(1);\n",
    );
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "test: tighten logic coverage"]);

    const manifest = execFileSync(
      "node",
      [INVOCATION, "create", "--repo", root, "--base-ref", "origin/main"],
      { cwd: root, encoding: "utf8" },
    ).trim();
    execFileSync(
      "node",
      [
        INVOCATION,
        "risk",
        manifest,
        "--tier",
        "high",
        "--task-type",
        "feature",
        "--score",
        "50",
        "--agents",
        "2",
        "--codex-depth",
        "high",
        "--codex-rounds",
        "1",
      ],
      { cwd: root },
    );

    expect(() => runMutation(root, manifest)).toThrow();

    const state = JSON.parse(readFileSync(manifest, "utf8"));
    expect(state.mutation).toBeNull();
  });

  it("still runs the gate when a manifest change also touches source", () => {
    const root = mkdtempSync(path.join(tmpdir(), "quality-mutation-mixed-"));
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["config", "user.name", "Quality Test"]);
    git(root, ["config", "user.email", "quality@example.com"]);
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: { lint: "true", test: "true", "security:audit": "true" },
      }),
    );
    writeFileSync(path.join(root, "index.js"), "exports.add = (a, b) => a;\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "base"]);
    git(root, ["remote", "add", "origin", root]);
    git(root, ["fetch", "-q", "origin", "main"]);
    git(root, ["switch", "-q", "-c", "feature"]);

    // Manifest churn alongside a real source change must NOT be waved through
    // as "no mutable source" — the vacuous test here has to fail the gate.
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: { lint: "true", test: "true", "security:audit": "true" },
        devDependencies: { "left-pad": "^1.3.0" },
      }),
    );
    writeFileSync(
      path.join(root, "index.js"),
      "exports.add = (a, b) => a + b;\n",
    );
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "fix: correct add and bump deps"]);

    const manifest = execFileSync(
      "node",
      [INVOCATION, "create", "--repo", root, "--base-ref", "origin/main"],
      { cwd: root, encoding: "utf8" },
    ).trim();
    execFileSync(
      "node",
      [
        INVOCATION,
        "risk",
        manifest,
        "--tier",
        "critical",
        "--task-type",
        "bugfix",
        "--score",
        "100",
        "--agents",
        "2",
        "--codex-depth",
        "xhigh",
        "--codex-rounds",
        "1",
      ],
      { cwd: root },
    );

    expect(() => runMutation(root, manifest)).toThrow();

    const state = JSON.parse(readFileSync(manifest, "utf8"));
    expect(state.mutation).toBeNull();
  });

  it("does not abort on a diff with zero added/modified entries", () => {
    const root = mkdtempSync(path.join(tmpdir(), "quality-mutation-delonly-"));
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["config", "user.name", "Quality Test"]);
    git(root, ["config", "user.email", "quality@example.com"]);
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: { lint: "true", test: "true", "security:audit": "true" },
      }),
    );
    writeFileSync(path.join(root, "obsolete.js"), "exports.x = 1;\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "base"]);
    git(root, ["remote", "add", "origin", root]);
    git(root, ["fetch", "-q", "origin", "main"]);
    git(root, ["switch", "-q", "-c", "feature"]);
    git(root, ["rm", "-q", "obsolete.js"]);
    git(root, ["commit", "-qm", "chore: remove obsolete.js"]);

    const manifest = execFileSync(
      "node",
      [INVOCATION, "create", "--repo", root, "--base-ref", "origin/main"],
      { cwd: root, encoding: "utf8" },
    ).trim();
    execFileSync(
      "node",
      [
        INVOCATION,
        "risk",
        manifest,
        "--tier",
        "high",
        "--task-type",
        "feature",
        "--score",
        "50",
        "--agents",
        "2",
        "--codex-depth",
        "high",
        "--codex-rounds",
        "1",
      ],
      { cwd: root },
    );

    expect(() => runMutation(root, manifest)).toThrow(
      /no changed executable source file can be reverted/,
    );
  });

  it("rejects a timed-out test instead of recording a hang as red evidence", () => {
    const { root, manifest } = fixture(
      "hang",
      "setInterval(() => {}, 1000);\n",
      // Allow setup of the detached mutation worktree to complete before the
      // test-run cap starts deciding the outcome. A one-second total budget
      // races that setup and can exhaust before the hanging test is launched.
      { checkSeconds: 5 },
    );
    expect(() => runMutation(root, manifest)).toThrow(
      /a hang is not red-capable evidence/,
    );
    const state = JSON.parse(readFileSync(manifest, "utf8"));
    expect(state.mutation).toBeNull();
    expect(state.governor.activeExecution).toBeNull();
    expect(state.governor.gateSecondsUsed).toBe(5);
  });
});
