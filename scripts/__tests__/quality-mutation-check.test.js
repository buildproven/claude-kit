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

function runMutation(root, manifest) {
  try {
    return execFileSync("bash", [MUTATION, "--manifest", manifest], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(error.stderr.toString(), { cause: error });
  }
}

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
      { checkSeconds: 1 },
    );
    expect(() => runMutation(root, manifest)).toThrow(
      /a hang is not red-capable evidence/,
    );
    const state = JSON.parse(readFileSync(manifest, "utf8"));
    expect(state.mutation).toBeNull();
    expect(state.governor.activeExecution).toBeNull();
    expect(state.governor.gateSecondsUsed).toBe(1);
  });
});
