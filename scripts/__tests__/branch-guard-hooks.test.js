// Behavioral contract tests for the two branch-protection PreToolUse hooks.
//
// Both hooks document `Exit codes: 0 = allow, 2 = deny with message`. Anything
// else — notably a non-zero exit that is not 2 — is a crash that Claude Code
// treats as non-blocking, so the protection silently disappears. These hooks
// previously died at their `git -C` extraction under `set -euo pipefail`
// (grep exits 1 when the command has no `-C`, which is the common case), so
// `git push origin main` was never actually blocked. Assert the exit-code
// contract directly rather than merely asserting the scripts are installed.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPTS = path.resolve(import.meta.dirname, "..");
const PUSH_HOOK = path.join(SCRIPTS, "block-push-main.sh");
const DRIFT_HOOK = path.join(SCRIPTS, "branch-drift-guard.sh");

let repo;
let worktree;

/** Run a hook with a Bash tool payload; return its raw exit code and output. */
function runHook(hook, command, { cwd = repo, env = {} } = {}) {
  const payload = JSON.stringify({ tool_input: { command } });
  try {
    const stdout = execFileSync("bash", [hook], {
      input: payload,
      cwd,
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, output: stdout };
  } catch (error) {
    return {
      code: error.status,
      output: (error.stdout ?? "") + (error.stderr ?? ""),
    };
  }
}

const git = (args, cwd = repo) =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

beforeAll(() => {
  repo = mkdtempSync(path.join(tmpdir(), "branch-guard-"));
  git(["init", "--initial-branch=main"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  writeFileSync(path.join(repo, "file.txt"), "seed\n");
  git(["add", "."]);
  git(["commit", "-m", "seed"]);
});

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

describe("block-push-main.sh", () => {
  // The regression that motivated this file: no `-C` in the command.
  it("denies an explicit push to main (no -C flag)", () => {
    const { code, output } = runHook(PUSH_HOOK, "git push origin main");
    expect(code).toBe(2);
    expect(output).toMatch(/direct push to main/i);
  });

  it("denies an explicit push to master (no -C flag)", () => {
    expect(runHook(PUSH_HOOK, "git push origin master").code).toBe(2);
  });

  it("denies a bare 'git push' while on main", () => {
    const { code, output } = runHook(PUSH_HOOK, "git push");
    expect(code).toBe(2);
    expect(output).toMatch(/main/i);
  });

  it("denies a push to main with extra whitespace", () => {
    expect(runHook(PUSH_HOOK, "git   push   origin   main").code).toBe(2);
  });

  it("still denies a push to main routed through -C", () => {
    expect(runHook(PUSH_HOOK, `git -C "${repo}" push origin main`).code).toBe(
      2,
    );
  });

  it("still denies a push through a quoted -C path containing spaces", () => {
    expect(
      runHook(PUSH_HOOK, 'git -C "/tmp/repo with spaces" push origin main')
        .code,
    ).toBe(2);
  });

  it.each([
    "git push origin HEAD:main",
    "git push origin HEAD:refs/heads/main",
    "git push origin origin/main",
    "git push origin +HEAD:master",
  ])("denies protected branch refspec %s", (command) => {
    expect(runHook(PUSH_HOOK, command).code).toBe(2);
  });

  it("does not treat path or option substrings as force/delete flags", () => {
    expect(
      runHook(PUSH_HOOK, `git -C "/tmp/-final" push origin main`).code,
    ).toBe(2);
    expect(runHook(PUSH_HOOK, "git push origin main --foo").code).toBe(2);
  });

  it.each([
    "git push --force origin main",
    "git push --force-with-lease origin main",
    "git push --delete origin main",
  ])("preserves the explicit protected-push override %s", (command) => {
    expect(runHook(PUSH_HOOK, command).code).toBe(0);
  });

  it("allows pushing a feature branch", () => {
    expect(runHook(PUSH_HOOK, "git push origin feat/x").code).toBe(0);
  });

  it("allows a non-git command", () => {
    expect(runHook(PUSH_HOOK, "ls -la").code).toBe(0);
  });

  // Guards the contract itself: only 0 and 2 are meaningful to Claude Code.
  it("never exits with a code outside the documented 0/2 contract", () => {
    for (const command of [
      "git push origin main",
      "git push",
      "git status",
      "ls",
      "echo hi",
      "git push origin feat/x",
    ]) {
      expect([0, 2]).toContain(runHook(PUSH_HOOK, command).code);
    }
  });
});

describe("branch-drift-guard.sh", () => {
  it("allows an ordinary command without crashing (no -C flag)", () => {
    expect(
      runHook(DRIFT_HOOK, "git status", { env: { SESSION_ID: "s1" } }).code,
    ).toBe(0);
  });

  it("allows a non-git command without crashing", () => {
    expect(runHook(DRIFT_HOOK, "ls", { env: { SESSION_ID: "s2" } }).code).toBe(
      0,
    );
  });

  it("blocks a commit after another tab switched branches", () => {
    const env = { SESSION_ID: "drift" };
    // First git operation records the current branch (main).
    expect(runHook(DRIFT_HOOK, "git add .", { env }).code).toBe(0);
    // Another tab switches the checkout out from under this session.
    git(["checkout", "-q", "-b", "feat/other"]);
    const { code, output } = runHook(DRIFT_HOOK, "git commit -m x", { env });
    git(["checkout", "-q", "main"]);
    expect(code).toBe(2);
    expect(output).toMatch(/BRANCH DRIFT/i);
  });

  it("never exits with a code outside the documented 0/2 contract", () => {
    for (const command of [
      "git status",
      "git commit -m x",
      "git add .",
      "ls",
      "git push origin main",
    ]) {
      expect([0, 2]).toContain(
        runHook(DRIFT_HOOK, command, { env: { SESSION_ID: "contract" } }).code,
      );
    }
  });

  // In a linked worktree `.git` is a FILE pointing at the real git dir, so
  // `mkdir -p "$root/.git/claude-sessions"` failed with "Not a directory" and
  // `set -e` killed the hook. Worktrees are the documented development
  // workflow for this repo, so the guard was dead exactly where it is most
  // needed.
  describe("inside a linked git worktree", () => {
    beforeAll(() => {
      worktree = path.join(path.dirname(repo), `${path.basename(repo)}-wt`);
      git(["worktree", "add", "-q", "-b", "wt/probe", worktree]);
    });

    afterAll(() => {
      if (!worktree) return;
      git(["worktree", "remove", "--force", worktree]);
      rmSync(worktree, { recursive: true, force: true });
    });

    it("tracks drift without crashing on the worktree's .git file", () => {
      const opts = { cwd: worktree, env: { SESSION_ID: "wt-session" } };
      expect(runHook(DRIFT_HOOK, "git add .", opts).code).toBe(0);
      expect(runHook(DRIFT_HOOK, "git status", opts).code).toBe(0);
    });

    it("honors the 0/2 contract from inside a worktree", () => {
      for (const command of ["ls", "git status", "git commit -m x"]) {
        expect([0, 2]).toContain(
          runHook(DRIFT_HOOK, command, {
            cwd: worktree,
            env: { SESSION_ID: "wt-contract" },
          }).code,
        );
      }
    });
  });
});
