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

/** Hooks that can block edits must never mutate the user's branch. */
describe("hooks never destroy user work", () => {
  const branches = (cwd) =>
    git(cwd, "branch", "--format=%(refname:short)").split("\n").filter(Boolean);

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
