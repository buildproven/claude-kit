import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const SCRIPT = path.resolve(
  import.meta.dirname,
  "../quality-required-checks.js",
);
const {
  checkState,
  matchingRuns,
  requiredChecks,
} = require("../quality-required-checks.js");

function fakeGh(root, sourceRuns, targetRuns) {
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  const log = path.join(root, "dispatch.log");
  const script = `#!/usr/bin/env bash
set -eu
case "$*" in
  *protection/required_status_checks*) printf '%s\\n' '{"strict":true,"contexts":["quality"],"checks":[{"context":"quality","app_id":15368}]}' ;;
  *rules/branches/main*) printf '%s\\n' '[]' ;;
  *commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/check-runs*) printf '%s\\n' '${JSON.stringify({ check_runs: sourceRuns })}' ;;
  *commits/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/check-runs*) printf '%s\\n' '${JSON.stringify({ check_runs: targetRuns })}' ;;
  *actions/runs/123*) printf '%s\\n' '{"workflow_id":77}' ;;
  *actions/workflows/77/dispatches*) printf '%s\\n' "$*" >> '${log}' ;;
  *) echo "unexpected gh call: $*" >&2; exit 1 ;;
esac
`;
  const executable = path.join(bin, "gh");
  fs.writeFileSync(executable, script, { mode: 0o755 });
  return { bin, log };
}

function run(root, args, fixture) {
  return spawnSync("node", [SCRIPT, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PATH: `${fixture.bin}:${process.env.PATH}` },
  });
}

describe("quality-required-checks", () => {
  it("fails closed when one protection source cannot be read", () => {
    const originalPath = process.env.PATH;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "quality-checks-"));
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    const gh = path.join(bin, "gh");
    fs.writeFileSync(
      gh,
      `#!/usr/bin/env bash
set -eu
case "$*" in
  *protection/required_status_checks*) printf '%s\\n' '{"contexts":["quality"],"checks":[]}' ;;
  *rules/branches/main*) echo 'gh: API rate limit exceeded (HTTP 403)' >&2; exit 1 ;;
  *) exit 1 ;;
esac
`,
      { mode: 0o755 },
    );
    process.env.PATH = `${bin}:${originalPath}`;
    try {
      expect(() => requiredChecks("owner/repo", "main")).toThrow(
        /API rate limit exceeded/,
      );
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("combines classic protection and effective ruleset requirements", () => {
    const calls = [];
    const originalPath = process.env.PATH;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "quality-checks-"));
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    const gh = path.join(bin, "gh");
    fs.writeFileSync(
      gh,
      `#!/usr/bin/env bash
set -eu
case "$*" in
  *protection/required_status_checks*) printf '%s\\n' '{"contexts":[],"checks":[{"context":"quality","app_id":15368}]}' ;;
  *rules/branches/main*) printf '%s\\n' '[{"type":"required_status_checks","parameters":{"required_status_checks":[{"context":"security","integration_id":15368}]}}]' ;;
  *) exit 1 ;;
esac
`,
      { mode: 0o755 },
    );
    process.env.PATH = `${bin}:${originalPath}`;
    try {
      calls.push(...requiredChecks("owner/repo", "main"));
    } finally {
      process.env.PATH = originalPath;
    }
    expect(calls).toEqual([
      { context: "quality", appId: 15368 },
      { context: "security", appId: 15368 },
    ]);
  });

  it("uses only the newest check from the required GitHub App", () => {
    const requirement = { context: "quality", appId: 15368 };
    const runs = [
      {
        id: 4,
        name: "quality",
        status: "completed",
        conclusion: "failure",
        app: { id: 15368 },
      },
      {
        id: 3,
        name: "quality",
        status: "completed",
        conclusion: "success",
        app: { id: 15368 },
      },
      {
        id: 9,
        name: "quality",
        status: "completed",
        conclusion: "success",
        app: { id: 1 },
      },
    ];
    expect(matchingRuns(runs, requirement).map((run) => run.id)).toEqual([
      4, 3,
    ]);
    expect(checkState(runs, requirement)).toMatchObject({ state: "failed" });
  });

  it("dispatches the reviewed-head workflow when an empty stamp has no check", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "quality-checks-"));
    const sourceRuns = [
      {
        id: 1,
        name: "quality",
        status: "completed",
        conclusion: "success",
        app: { id: 15368 },
        details_url: "https://github.com/o/r/actions/runs/123/job/456",
      },
    ];
    const fixture = fakeGh(root, sourceRuns, []);
    const result = run(
      root,
      [
        "ensure",
        "--repo",
        "owner/repo",
        "--base",
        "main",
        "--source-head",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "--head",
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "--head-ref",
        "feature/fix",
      ],
      fixture,
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).dispatched).toEqual([
      { context: "quality", workflowId: 77 },
    ]);
    expect(fs.readFileSync(fixture.log, "utf8")).toContain(
      "actions/workflows/77/dispatches -f ref=feature/fix",
    );
  });

  it("asserts exact-head success without relying on PR check rollups", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "quality-checks-"));
    const targetRuns = [
      {
        id: 2,
        name: "quality",
        status: "completed",
        conclusion: "success",
        app: { id: 15368 },
      },
    ];
    const fixture = fakeGh(root, [], targetRuns);
    const result = run(
      root,
      [
        "assert",
        "--repo",
        "owner/repo",
        "--base",
        "main",
        "--head",
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ],
      fixture,
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)[0]).toMatchObject({
      context: "quality",
      appId: 15368,
      state: "success",
    });
  });
});
