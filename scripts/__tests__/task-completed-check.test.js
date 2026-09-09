import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "./helpers/tmp.js";

const hook = path.resolve(import.meta.dirname, "../task-completed-check.sh");

function fixture() {
  const root = makeTempDir("task-hook-");
  const git = (...args) => execFileSync("git", args, { cwd: root });
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  mkdirSync(path.join(root, ".buildproven"));
  mkdirSync(path.join(root, "fixture-bin"));
  // Supply the old hook's platform dependency so RED proves selection behavior.
  writeFileSync(
    path.join(root, "fixture-bin/timeout"),
    '#!/bin/sh\nshift\nexec "$@"\n',
    { mode: 0o755 },
  );
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      scripts: { test: "node -e 'process.exit(41)'" },
    }),
  );
  writeFileSync(path.join(root, "tracked.js"), "export const value = 1;\n");
  writeFileSync(path.join(root, ".gitignore"), "observed.json\nignored.js\n");
  writeFileSync(
    path.join(root, ".buildproven/test-impact.json"),
    JSON.stringify({
      version: 1,
      jsRunner: "none",
      mappings: [
        {
          paths: ["*.js"],
          commands: [
            {
              executable: process.execPath,
              args: [
                "-e",
                "require('node:fs').writeFileSync('observed.json', JSON.stringify(process.argv.slice(1)))",
                "selected",
              ],
            },
          ],
        },
      ],
    }),
  );
  git("add", ".");
  git("commit", "-qm", "fixture");
  return { root, git };
}

function run(root, input = { cwd: root }) {
  return spawnSync("bash", [hook], {
    cwd: root,
    input: JSON.stringify(input),
    encoding: "utf8",
    timeout: 15_000,
    env: {
      ...process.env,
      PATH: `${path.join(root, "fixture-bin")}:${process.env.PATH}`,
    },
  });
}

describe("task completion affected-test contract", () => {
  it("runs the configured affected command instead of the whole test script", () => {
    const { root } = fixture();
    writeFileSync(path.join(root, "tracked.js"), "export const value = 2;\n");
    const result = run(root);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(
      JSON.parse(readFileSync(path.join(root, "observed.json"), "utf8")),
    ).toEqual(["selected"]);
  });

  it("includes untracked code with spaces and newline characters", () => {
    const { root } = fixture();
    writeFileSync(path.join(root, "new file\npart.js"), "new behavior\n");
    const result = run(root);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(readFileSync(path.join(root, "observed.json"), "utf8")).toBe(
      '["selected"]',
    );
  });

  it("includes staged deletions", () => {
    const { root, git } = fixture();
    unlinkSync(path.join(root, "tracked.js"));
    git("add", "tracked.js");
    const result = run(root);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(readFileSync(path.join(root, "observed.json"), "utf8")).toBe(
      '["selected"]',
    );
  });

  it("reports unmapped executable changes as blocked", () => {
    const { root } = fixture();
    writeFileSync(path.join(root, "new.py"), "print('changed')\n");
    const result = run(root);
    expect(result.status).toBe(2);
    expect(result.stdout + result.stderr).toContain("new.py");
  });

  it("preserves failing selected tests as blocked", () => {
    const { root, git } = fixture();
    const file = path.join(root, ".buildproven/test-impact.json");
    const policy = JSON.parse(readFileSync(file, "utf8"));
    policy.mappings[0].commands[0].args = ["-e", "process.exit(7)"];
    writeFileSync(file, JSON.stringify(policy));
    git("add", ".buildproven/test-impact.json");
    git("commit", "-qm", "failing selection fixture");
    writeFileSync(path.join(root, "tracked.js"), "changed\n");
    const result = run(root);
    expect(result.status).toBe(2);
  });

  it("allows a clean worktree without starting tests", () => {
    const { root } = fixture();
    expect(run(root).status).toBe(0);
  });

  it("does not treat ignored files as pending source changes", () => {
    const { root } = fixture();
    writeFileSync(path.join(root, "ignored.js"), "ignored\n");
    expect(run(root).status).toBe(0);
  });

  it("blocks malformed hook input instead of claiming a pass", () => {
    const { root } = fixture();
    const result = spawnSync("bash", [hook], {
      cwd: root,
      input: "{",
      encoding: "utf8",
    });
    expect(result.status).toBe(2);
  });
});
