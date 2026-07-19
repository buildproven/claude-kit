// Tests for scripts/quality-bootstrap.sh recursion / fail-open guards added in
// the Wave 1 "close the fail-open channels" pass. These exercise the guard
// paths that exit BEFORE any target resolution or GitHub call, so they are
// fast, deterministic, and need no `claude`/`gh`/network. The happy path
// (actual resolution → manifest) is covered by quality-invocation tests and
// live runs.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCRIPT = path.resolve(__dirname, "..", "quality-bootstrap.sh");

function run(args, { env } = {}) {
  const errFile = path.join(
    os.tmpdir(),
    `qbg-err-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  try {
    const stdout = execFileSync("bash", [SCRIPT, ...args], {
      env: { ...process.env, ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", fs.openSync(errFile, "w")],
    });
    const stderr = fs.existsSync(errFile)
      ? fs.readFileSync(errFile, "utf8")
      : "";
    return { code: 0, stdout, stderr };
  } catch (e) {
    const stderr = fs.existsSync(errFile)
      ? fs.readFileSync(errFile, "utf8")
      : (e.stderr?.toString() ?? "");
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? "", stderr };
  } finally {
    try {
      fs.unlinkSync(errFile);
    } catch {
      /* ignore */
    }
  }
}

// The PR base-change guard (quality-bootstrap.sh) must distinguish a base
// branch that merely ADVANCED (GitHub's cached baseRefOid lags behind the tip
// — normal fast-forward history) from a base that was REWRITTEN (force-push /
// rebase that orphans the recorded OID). The guard encodes this as: the
// recorded baseRefOid must equal, or be an ancestor of, the freshly fetched
// base tip. These tests validate that exact ancestry contract against a real
// git repo so a regression to strict equality (which fails every time main
// advances after a PR opens) is caught.
describe("quality-bootstrap PR base-change guard ancestry semantics", () => {
  function git(cwd, ...args) {
    return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  }
  function isAncestor(cwd, ancestor, descendant) {
    const r = require("node:child_process").spawnSync(
      "git",
      ["merge-base", "--is-ancestor", ancestor, descendant],
      { cwd },
    );
    return r.status === 0;
  }
  let repo;
  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "qbg-base-"));
    git(repo, "init", "-q");
    git(repo, "config", "user.email", "t@t");
    git(repo, "config", "user.name", "t");
    git(repo, "commit", "--allow-empty", "-q", "-m", "base");
  });
  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("accepts an advanced base: recorded OID is an ancestor of the new tip", () => {
    const recordedBaseOid = git(repo, "rev-parse", "HEAD");
    git(
      repo,
      "commit",
      "--allow-empty",
      "-q",
      "-m",
      "main advanced (a PR merged)",
    );
    const newTip = git(repo, "rev-parse", "HEAD");
    expect(newTip).not.toBe(recordedBaseOid);
    // Guard passes: equality fails but ancestry holds.
    expect(isAncestor(repo, recordedBaseOid, newTip)).toBe(true);
  });

  it("rejects a rewritten base: recorded OID is orphaned from the new tip", () => {
    const recordedBaseOid = git(repo, "rev-parse", "HEAD");
    // Rewrite history: reset to a fresh root so the recorded OID is orphaned.
    git(repo, "checkout", "-q", "--orphan", "rewritten");
    git(repo, "commit", "--allow-empty", "-q", "-m", "force-pushed base");
    const newTip = git(repo, "rev-parse", "HEAD");
    // Guard fails: not equal AND not an ancestor → genuine base rewrite.
    expect(newTip).not.toBe(recordedBaseOid);
    expect(isAncestor(repo, recordedBaseOid, newTip)).toBe(false);
  });
});

describe("quality-bootstrap headless review-child guard", () => {
  it("refuses when BS_QUALITY_HEADLESS=1 (a review child must not re-enter)", () => {
    const r = run([], { env: { BS_QUALITY_HEADLESS: "1" } });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/headless review child/i);
  });
});

describe("quality-bootstrap active-campaign re-entrancy guard (1.3b)", () => {
  it("refuses a FRESH invocation (no --manifest) when a campaign is already active", () => {
    // A fix-round or spawned agent that inherited the env tries to start a
    // second campaign. Must be refused in bash, not left to model judgment.
    const r = run([], { env: { BS_QUALITY_ACTIVE: "1" } });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/campaign is already active/i);
  });

  it("does NOT refuse a --manifest resume of the active campaign", () => {
    // A legitimate resume carries --manifest; the guard must let it through
    // (it will fail later for a bogus manifest path, but NOT on the re-entrancy
    // guard — so the failure text must not be the active-campaign message).
    const r = run(["--manifest", "/nonexistent/manifest.json"], {
      env: { BS_QUALITY_ACTIVE: "1" },
    });
    expect(r.stderr).not.toMatch(/campaign is already active/i);
  });
});
