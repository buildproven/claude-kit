import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { parse } from "yaml";
import { makeTempDir } from "./helpers/tmp.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

describe("quality workflow bootstrap", () => {
  it.each(["Run affected tests", "Run affected tests after merge"])(
    "%s cannot pass a deletion as documentation-only",
    (name) => {
      const root = makeTempDir("ci-deletion-");
      const git = (...args) =>
        execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
      git("init", "-q");
      git("config", "user.name", "Fixture");
      git("config", "user.email", "fixture@example.invalid");
      fs.mkdirSync(path.join(root, ".buildproven"));
      fs.writeFileSync(
        path.join(root, ".buildproven/test-impact.json"),
        JSON.stringify({ version: 1 }),
      );
      fs.writeFileSync(
        path.join(root, "deleted source.js"),
        "export const value = 1;\n",
      );
      fs.writeFileSync(path.join(root, "README.md"), "before\n");
      git("add", ".");
      git("commit", "-qm", "base");
      const base = git("rev-parse", "HEAD");
      fs.unlinkSync(path.join(root, "deleted source.js"));
      fs.writeFileSync(path.join(root, "README.md"), "after\n");
      git("add", ".");
      git("commit", "-qm", "delete source");
      const workflow = parse(
        fs.readFileSync(
          path.join(repoRoot, ".github/workflows/quality.yml"),
          "utf8",
        ),
      );
      const step = Object.values(workflow.jobs)
        .flatMap((job) => job.steps || [])
        .find((candidate) => candidate.name === name);
      expect(step).toBeDefined();
      // Execute the actual Git producer, then pass its NUL-separated result to
      // the public CLI. This also runs on macOS bash 3.2 without mapfile.
      const produced = spawnSync(
        "bash",
        ["-e", "-o", "pipefail", "-c", step.run.split("mapfile -d")[0]],
        {
          cwd: root,
          encoding: "utf8",
          timeout: 10000,
          env: {
            ...process.env,
            BASE_SHA: base,
            HEAD_SHA: git("rev-parse", "HEAD"),
            RUNNER_TEMP: root,
          },
        },
      );
      expect(produced.status, produced.stderr).toBe(0);
      const changed = fs
        .readFileSync(path.join(root, "changed-paths"), "utf8")
        .split("\0")
        .filter(Boolean);
      const result = spawnSync(
        process.execPath,
        [
          path.join(repoRoot, "scripts/test-impact.js"),
          "--execute",
          "--",
          ...changed,
        ],
        { cwd: root, encoding: "utf8" },
      );
      expect(result.status, result.stdout + result.stderr).toBe(2);
      const selection = JSON.parse(result.stdout);
      expect(selection.mode).toBe("unmapped");
      expect(selection.uncovered).toContain("deleted source.js");
      expect(changed).toContain("deleted source.js");
    },
  );
  it("skips an existing zsh and bounds package installation", () => {
    const workflow = fs.readFileSync(
      path.join(repoRoot, ".github/workflows/quality.yml"),
      "utf8",
    );
    const installStep = workflow.match(
      /- name: Install zsh for shell-isolation regressions\n([\s\S]*?)\n\s+- run: npm ci/,
    )?.[1];

    expect(installStep).toBeDefined();
    const stepTimeoutMinutes = Number(
      installStep.match(/timeout-minutes:\s*(\d+)/)?.[1],
    );
    const updateTimeoutSeconds = Number(
      installStep.match(/timeout\s+(\d+)s\s+sudo apt-get update/)?.[1],
    );
    const installTimeoutSeconds = Number(
      installStep.match(/timeout\s+(\d+)s\s+sudo env/)?.[1],
    );

    expect(stepTimeoutMinutes).toBeGreaterThan(0);
    expect(updateTimeoutSeconds).toBeGreaterThan(0);
    expect(installTimeoutSeconds).toBeGreaterThan(0);
    expect(stepTimeoutMinutes * 60).toBeGreaterThan(
      updateTimeoutSeconds + installTimeoutSeconds,
    );
    expect(installStep).toContain("command -v zsh");
    expect(installStep).toContain("timeout 30s sudo apt-get update");
    expect(installStep).toContain(
      "timeout 150s sudo env DEBIAN_FRONTEND=noninteractive apt-get",
    );
    expect(installStep).toContain("-o Acquire::http::Timeout=15");
    expect(installStep).toContain("-o Acquire::https::Timeout=15");
    expect(installStep).toContain("-o Acquire::Retries=3");
    expect(installStep).toContain("install --yes zsh");
  });
});
