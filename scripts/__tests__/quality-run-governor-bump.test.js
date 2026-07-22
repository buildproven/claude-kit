const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { bumpRound } = require("../quality-run-governor");

/**
 * bumpRound is what actually terminates the fix -> re-review loop. Before it
 * existed the cap was a sentence of prose in SKILL.md, and because the MODEL
 * drives that loop, prose is not a cap at all — runs reached 128 and 167 minutes.
 *
 * Its safety property is that it fails CLOSED: an unreadable or malformed
 * sentinel must HALT the loop, never wave it through. A governor that fails open
 * is worse than none, because it reads as protection that isn't there. None of
 * that behavior was covered.
 */
const sentinel = (state) => {
  const p = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "gov-")),
    "run-state.json",
  );
  if (state !== undefined) fs.writeFileSync(p, JSON.stringify(state));
  return p;
};

// The fix-commit budget is measured against the repo's commit count at run start,
// via `git rev-list --count HEAD` in cwd — so the baseline has to be the real one.
// Seeding it at 0 makes every run look like it has already spent thousands of
// fix-commits, which is what a naive fixture gets wrong.
const startCommits = () =>
  Number(
    require("node:child_process")
      .execFileSync("git", ["rev-list", "--count", "HEAD"], {
        cwd: process.cwd(),
        encoding: "utf8",
      })
      .trim(),
  );

const healthy = (over = {}) => {
  const start_epoch = Math.floor(Date.now() / 1000);
  return {
    start_epoch,
    deadline_epoch: start_epoch + 3600,
    start_commit_count: startCommits(),
    max_fix_commits: 10,
    max_wall_seconds: 3600,
    max_review_rounds: 3,
    rounds_used: 0,
    ...over,
  };
};

describe("bumpRound — the round cap that stops runaway review loops", () => {
  afterEach(() => vi.restoreAllMocks());

  it("allows a round while inside budget, and records it", () => {
    const p = sentinel(healthy());
    expect(bumpRound(p, process.cwd())).toBe(0);
    expect(JSON.parse(fs.readFileSync(p, "utf8")).rounds_used).toBe(1);
  });

  it("increments across successive rounds rather than resetting", () => {
    const p = sentinel(healthy());
    bumpRound(p, process.cwd());
    const afterFirst = JSON.parse(fs.readFileSync(p, "utf8"));
    afterFirst.authorized_attempts[0].consumedAt = new Date().toISOString();
    fs.writeFileSync(p, JSON.stringify(afterFirst));
    bumpRound(p, process.cwd());
    expect(JSON.parse(fs.readFileSync(p, "utf8")).rounds_used).toBe(2);
  });

  it("HALTS once the round cap is reached", () => {
    const p = sentinel(healthy({ rounds_used: 3 })); // cap is 3
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(bumpRound(p, process.cwd())).toBe(1);
  });

  it("fails CLOSED when the sentinel does not exist", () => {
    const p = sentinel(undefined); // never written
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    // A missing sentinel must not read as "no limits yet".
    expect(bumpRound(p, process.cwd())).toBe(1);
  });

  it("fails CLOSED when the sentinel is unparseable", () => {
    const p = sentinel(healthy());
    fs.writeFileSync(p, "{ not json");
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(bumpRound(p, process.cwd())).toBe(1);
  });

  it("fails CLOSED when required budget fields are missing", () => {
    // Parses, but carries no limits — that is not a licence to run forever.
    const p = sentinel({ rounds_used: 0 });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(bumpRound(p, process.cwd())).toBe(1);
  });

  it("HALTS when the fix-commit budget is spent after the initial review", () => {
    // Pretend the run started far enough back that the repo's current commit
    // count already exceeds the allowed fix-commits.
    const p = sentinel(
      healthy({
        start_commit_count: startCommits() - 50,
        max_fix_commits: 5,
        rounds_used: 1,
      }),
    );
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(bumpRound(p, process.cwd())).toBe(1);
  });

  it("HALTS when the wall-clock budget is spent, even on round 1", () => {
    const p = sentinel(
      healthy({
        start_epoch: Math.floor(Date.now() / 1000) - 7200, // started 2h ago
        deadline_epoch: Math.floor(Date.now() / 1000) - 7140,
        max_wall_seconds: 60,
      }),
    );
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(bumpRound(p, process.cwd())).toBe(1);
  });
});
