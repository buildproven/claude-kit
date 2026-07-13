import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPTS = path.resolve(import.meta.dirname, "..");

// A CI runner has no git identity configured, so `git commit` exits 128 there
// while passing locally. Supply one explicitly rather than depending on the host.
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "kit-test",
  GIT_AUTHOR_EMAIL: "kit-test@example.com",
  GIT_COMMITTER_NAME: "kit-test",
  GIT_COMMITTER_EMAIL: "kit-test@example.com",
};

const git = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    env: GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

const sh = (cwd, script, input = "", env = {}) => {
  try {
    const stdout = execFileSync("bash", [path.join(SCRIPTS, script)], {
      cwd,
      input,
      env: { ...GIT_ENV, ...env },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
};

/**
 * These hooks fire on EVERY session start / edit, in WHATEVER repo the user has
 * open. They must never destroy work. `session-start-context.sh` used to run
 * `git branch -D` on branches whose upstream was gone — a force delete that
 * takes unpushed commits with it. `auto-branch-on-main.sh` used to silently
 * `git checkout -b` in the user's tree.
 */
describe("hooks never destroy user work", () => {
  /** A repo with a `: gone]` branch that still holds an unpushed commit. */
  function repoWithGoneBranch() {
    const root = mkdtempSync(path.join(tmpdir(), "kit-hook-"));
    const remote = path.join(root, "remote.git");
    const work = path.join(root, "work");

    git(root, "init", "-q", "--bare", remote);
    git(root, "clone", "-q", remote, work);
    git(work, "checkout", "-q", "-b", "trunk");
    git(work, "commit", "-q", "--allow-empty", "-m", "init");
    git(work, "push", "-q", "origin", "trunk");

    git(work, "checkout", "-q", "-b", "feature");
    git(work, "commit", "-q", "--allow-empty", "-m", "pushed");
    git(work, "push", "-q", "-u", "origin", "feature");
    // The commit that must not be lost — local only.
    git(work, "commit", "-q", "--allow-empty", "-m", "UNPUSHED");
    git(work, "push", "-q", "origin", "--delete", "feature");
    git(work, "fetch", "-q", "--prune");
    git(work, "checkout", "-q", "trunk");

    return work;
  }

  const branches = (cwd) =>
    git(cwd, "branch", "--format=%(refname:short)").split("\n").filter(Boolean);

  it("session-start does not delete a gone-upstream branch holding unpushed work", () => {
    const work = repoWithGoneBranch();
    expect(branches(work)).toContain("feature");

    sh(work, "session-start-context.sh");

    // The whole point: force-deleting this would destroy the UNPUSHED commit.
    expect(branches(work)).toContain("feature");
  });

  it("session-start reports the gone branch instead of silently deleting it", () => {
    const work = repoWithGoneBranch();
    const { out } = sh(work, "session-start-context.sh");
    expect(out).toMatch(/remote is gone/i);
  });

  it("auto-prune stays opt-in (deletes only when explicitly enabled)", () => {
    const work = repoWithGoneBranch();
    sh(work, "session-start-context.sh", "", { CLAUDE_KIT_AUTO_PRUNE: "1" });
    expect(branches(work)).not.toContain("feature");
  });

  it("auto-branch-on-main denies the edit rather than switching the user's branch", () => {
    const root = mkdtempSync(path.join(tmpdir(), "kit-hook-"));
    git(root, "init", "-q", "-b", "main", ".");
    git(root, "commit", "-q", "--allow-empty", "-m", "init");

    const { code, out } = sh(
      root,
      "auto-branch-on-main.sh",
      '{"tool_input":{"file_path":"src/app.js"}}',
    );

    expect(code).toBe(2); // deny, with a message back to Claude
    expect(out).toMatch(/git checkout -b/);
    // It must NOT have moved the user off main itself.
    expect(git(root, "branch", "--show-current").trim()).toBe("main");
    expect(branches(root)).toEqual(["main"]);
  });
});
