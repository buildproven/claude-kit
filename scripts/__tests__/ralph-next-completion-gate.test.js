// Regression tests for ralph-next-run.sh's completion honesty.
//
// The graph loop's IMPLEMENT state is a placeholder — the script contains no
// code-writing, commit, or provider call, because slash-command execution is
// out of scope for a shell script (see its own usage text). It nonetheless ran
// its quality gates against the UNMODIFIED checkout, passed them because the
// repository's own lint passes, scored the pass, and marked items Completed.
//
// Reproduced before the fix: "Implement OAuth login" and "Fix data corruption
// bug" were both moved to the Completed section with `passed: true` evidence
// written to disk, zero commits made, and BACKLOG.md as the only changed file.
//
// Two independent defenses are asserted here, because either alone is thin:
//   1. the runner refuses the whole loop up front (exit 3), and
//   2. if the legacy loop is force-enabled, completion is still gated on proof
//      that the tree actually changed.
//
// ralph-next-run.sh previously had zero test coverage.

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "./helpers/tmp.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const RALPH = path.join(ROOT, "scripts", "ralph-next-run.sh");

const BACKLOG = `# Backlog

## Active

| ID | Description | Type | Priority | Size | Score | Status |
| --- | --- | --- | --- | --- | --- | --- |
| CS-001 | Implement OAuth login | feature | P1 | M | 0.9 | Pending |
| CS-002 | Fix data corruption bug | bug | P0 | S | 0.95 | Pending |

## Completed

| ID | Description | Completed |
| --- | --- | --- |
`;

let repo;

const git = (args, cwd = repo) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

function run(args, env = {}) {
  const result = spawnSync("bash", [RALPH, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    code: result.status,
    output: (result.stdout ?? "") + (result.stderr ?? ""),
  };
}

/** IDs currently listed under the `## Completed` heading. */
function completedIds() {
  const text = readFileSync(path.join(repo, "BACKLOG.md"), "utf8");
  const section = text.slice(text.indexOf("## Completed"));
  return [...section.matchAll(/^\| (CS-\d+) /gm)].map((m) => m[1]);
}

beforeEach(() => {
  repo = makeTempDir("ralph-gate-");
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  // A repo whose quality trivially passes, so the loop's gate is satisfied
  // without any work having been done — the exact false-completion setup.
  writeFileSync(
    path.join(repo, "package.json"),
    '{"scripts":{"lint":"echo lint ok"}}\n',
  );
  writeFileSync(path.join(repo, "BACKLOG.md"), BACKLOG);
  git(["add", "-A"]);
  git(["commit", "-qm", "init"]);
});

afterAll(() => {
  // makeTempDir handles removal; nothing else to clean up.
});

describe("ralph-next-run.sh refuses to implement", () => {
  it("exits non-zero instead of running the placeholder loop", () => {
    const { code, output } = run(["--until", "2 items"]);
    expect(code).toBe(3);
    expect(output).toMatch(/cannot implement/i);
  });

  it("names the supported orchestration path", () => {
    expect(run(["--until", "2 items"]).output).toMatch(/\/bs:ralph/);
  });

  it("still lists the selected items so the run is useful", () => {
    const { output } = run(["--until", "2 items"]);
    expect(output).toMatch(/CS-001/);
    expect(output).toMatch(/CS-002/);
  });

  it("completes nothing and leaves the backlog untouched", () => {
    run(["--until", "2 items"]);
    expect(completedIds()).toEqual([]);
    expect(git(["status", "--porcelain", "BACKLOG.md"])).toBe("");
  });

  it("does not break --dry-run", () => {
    const { code, output } = run(["--dry-run"]);
    expect(code).toBe(0);
    expect(output).toMatch(/CS-001/);
  });
});

describe("legacy loop, when force-enabled, still cannot falsely complete", () => {
  const FORCE = { BS_RALPH_ALLOW_PLACEHOLDER_LOOP: "1" };

  it("blocks items when no code changed since PICK", () => {
    const { output } = run(["--until", "2 items"], FORCE);
    expect(output).toMatch(/no code change since PICK/i);
    expect(completedIds()).toEqual([]);
  });

  it("makes no commits of its own", () => {
    const before = git(["rev-parse", "HEAD"]);
    run(["--until", "2 items"], FORCE);
    expect(git(["rev-parse", "HEAD"])).toBe(before);
  });

  // The gate must not be satisfiable by the runner's own bookkeeping: it
  // rewrites BACKLOG.md when it blocks item 1, and counting that would let
  // item 1 vouch for item 2.
  it("does not let its own BACKLOG.md write satisfy the next item", () => {
    const { output } = run(["--until", "2 items"], FORCE);
    const refusals = output.match(/no code change since PICK/gi) || [];
    expect(refusals.length).toBe(2);
    expect(completedIds()).toEqual([]);
  });
});
