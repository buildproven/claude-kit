const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const GOV = path.join(__dirname, "..", "quality-run-governor.js");

/**
 * The quality skill does not import this module — it shells out to it, and
 * branches on the EXIT CODE. So the CLI surface is the real contract, and it was
 * the uncovered half. A bad invocation that exits 0 would read to the skill as
 * "budget fine, carry on", which is precisely the unbounded-loop failure the
 * governor exists to prevent.
 */
const run = (args, cwd = process.cwd()) => {
  try {
    const stdout = execFileSync("node", [GOV, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, QUALITY_CWD: cwd },
    });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
};

const sentinel = (state) => {
  const p = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "gov-cli-")),
    "run-state.json",
  );
  if (state !== undefined) fs.writeFileSync(p, JSON.stringify(state));
  return p;
};

const commitCount = () =>
  Number(
    execFileSync("git", ["rev-list", "--count", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
    }).trim(),
  );

const healthy = (over = {}) => {
  const start_epoch = Math.floor(Date.now() / 1000);
  return {
    start_epoch,
    deadline_epoch: start_epoch + 3600,
    start_commit_count: commitCount(),
    max_fix_commits: 10,
    max_wall_seconds: 3600,
    max_review_rounds: 3,
    rounds_used: 0,
    ...over,
  };
};

describe("quality-run-governor CLI", () => {
  it("exits 2 with usage when called with no arguments", () => {
    const { code, out } = run([]);
    expect(code).toBe(2);
    expect(out).toMatch(/usage:/);
  });

  it("exits 2 when the sentinel path is missing", () => {
    const { code } = run(["bump-round"]);
    expect(code).toBe(2);
  });

  it("exits 2 on an unknown command rather than doing nothing quietly", () => {
    const { code, out } = run(["frobnicate", sentinel(healthy())]);
    expect(code).toBe(2);
    expect(out).toMatch(/unknown command/i);
  });

  it("check: exits 0 while inside budget", () => {
    expect(run(["check", sentinel(healthy())]).code).toBe(0);
  });

  it("check: fails CLOSED on an unreadable sentinel", () => {
    // Must not be mistaken for "no limits configured, proceed".
    expect(run(["check", "/nonexistent/run-state.json"]).code).not.toBe(0);
  });

  it("bump-round: exits 0 and records the round", () => {
    const p = sentinel(healthy());
    expect(run(["bump-round", p]).code).toBe(0);
    expect(JSON.parse(fs.readFileSync(p, "utf8")).rounds_used).toBe(1);
  });

  it("bump-round: exits non-zero once the round cap is hit", () => {
    const p = sentinel(healthy({ rounds_used: 3 })); // cap 3
    const { code, out } = run(["bump-round", p]);
    expect(code).not.toBe(0);
    expect(out).toMatch(/ROUND BUDGET EXHAUSTED/);
  });

  it("status: reports the budget without changing it", () => {
    const p = sentinel(healthy({ rounds_used: 1 }));
    const { code, out } = run(["status", p]);
    expect(code).toBe(0);
    expect(out).toMatch(/review-rounds 1\/3/);
    expect(JSON.parse(fs.readFileSync(p, "utf8")).rounds_used).toBe(1);
  });

  it("remaining: clamps a stage to the absolute deadline", () => {
    const now = Math.floor(Date.now() / 1000);
    const p = sentinel(
      healthy({
        start_epoch: now - 3560,
        deadline_epoch: now + 40,
      }),
    );
    const { code, out } = run([
      "remaining",
      p,
      "--reserve",
      "5",
      "--cap",
      "900",
    ]);
    expect(code).toBe(0);
    expect(Number(out.trim())).toBeGreaterThanOrEqual(34);
    expect(Number(out.trim())).toBeLessThanOrEqual(35);
  });

  it("remaining: fails closed at the exact deadline", () => {
    const now = Math.floor(Date.now() / 1000);
    const p = sentinel(
      healthy({
        start_epoch: now - 3600,
        deadline_epoch: now,
      }),
    );
    const { code, out } = run(["remaining", p]);
    expect(code).not.toBe(0);
    expect(out.trim().split("\n")[0]).toBe("0");
  });

  it("remaining: fails closed without a consistent deadline", () => {
    const state = healthy();
    delete state.deadline_epoch;
    expect(run(["remaining", sentinel(state)]).code).not.toBe(0);
  });

  it("record-finding persists the exact set for targeted verification", () => {
    const p = sentinel(healthy({ rounds_used: 1 }));
    const findings = [{ file: "src/a.js", summary: "missing guard" }];
    expect(run(["record-finding", p, JSON.stringify(findings)]).code).toBe(0);
    const state = JSON.parse(fs.readFileSync(p, "utf8"));
    expect(state.last_findings).toEqual(findings);
    expect(state.last_findings_round).toBe(1);
  });
});
