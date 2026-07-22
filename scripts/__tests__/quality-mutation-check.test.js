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

function fixture(label, testBody) {
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
  writeFileSync(
    path.join(root, "logic.js"),
    "exports.isAllowed = () => false;\n",
  );
  writeFileSync(path.join(root, "logic.test.js"), testBody);
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "base"]);
  git(root, ["remote", "add", "origin", root]);
  git(root, ["fetch", "-q", "origin", "main"]);
  git(root, ["switch", "-q", "-c", "feature"]);
  writeFileSync(
    path.join(root, "logic.js"),
    "exports.isAllowed = (role) => role === 'admin';\n",
  );
  git(root, ["commit", "-qam", "feat: authorize admin"]);
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
  });
});
