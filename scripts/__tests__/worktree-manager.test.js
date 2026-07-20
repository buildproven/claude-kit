import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const MANAGER = path.join(ROOT, "scripts", "worktree-manager.js");
const temporaryRoots = [];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: "utf8",
  });
  if (options.ok !== false && result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result;
}

function git(repo, ...args) {
  return run("git", ["-C", repo, ...args]).stdout.trim();
}

function fixture(name = "repo") {
  const parent = mkdtempSync(path.join(os.tmpdir(), "wt-manager-"));
  temporaryRoots.push(parent);
  const repo = path.join(parent, name);
  const remote = path.join(parent, "remote.git");
  mkdirSync(repo);
  run("git", ["init", "--initial-branch=main", repo]);
  git(repo, "config", "user.email", "tests@example.com");
  git(repo, "config", "user.name", "Worktree Tests");
  writeFileSync(path.join(repo, "README.md"), "fixture\n");
  git(repo, "add", "README.md");
  git(repo, "commit", "-m", "initial");
  run("git", ["init", "--bare", remote]);
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-u", "origin", "main");
  run("git", ["--git-dir", remote, "symbolic-ref", "HEAD", "refs/heads/main"]);
  git(repo, "fetch", "origin");
  git(repo, "remote", "set-head", "origin", "-a");
  return { parent, remote, repo };
}

function manager(args, options = {}) {
  const result = run("node", [MANAGER, ...args], {
    ...options,
    ok: options.ok,
  });
  const text = result.status === 0 ? result.stdout : result.stderr;
  return { result, json: JSON.parse(text) };
}

function create(repo, branch, extra = []) {
  return manager([
    "create",
    "--repo",
    repo,
    "--branch",
    branch,
    "--creator",
    "test",
    ...extra,
  ]).json;
}

function fakeGh(parent) {
  const bin = path.join(parent, "bin");
  mkdirSync(bin, { recursive: true });
  const gh = path.join(bin, "gh");
  writeFileSync(
    gh,
    `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "gh version test"; exit 0; fi
if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
  case "\${GH_PR_STATE:-NONE}" in
    OPEN) echo '[{"number":17,"state":"OPEN","mergedAt":null,"closedAt":null,"headRefName":"feature/test"}]' ;;
    MERGED) echo '[{"number":17,"state":"MERGED","mergedAt":"2020-01-01T00:00:00Z","closedAt":"2020-01-01T00:00:00Z","headRefName":"feature/test"}]' ;;
    CLOSED) echo '[{"number":17,"state":"CLOSED","mergedAt":null,"closedAt":"2020-01-01T00:00:00Z","headRefName":"feature/test"}]' ;;
    *) echo '[]' ;;
  esac
  exit 0
fi
exit 1
`,
  );
  chmodSync(gh, 0o755);
  return bin;
}

function ghEnv(bin, state) {
  return {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    GH_PR_STATE: state,
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    run("find", [root, "-depth", "-delete"], { ok: false });
  }
});

describe("worktree-manager public CLI", () => {
  it("resolves the canonical sibling path from the primary checkout", () => {
    const { parent, repo } = fixture("life scape");
    const output = manager([
      "resolve",
      "--repo",
      repo,
      "--branch",
      "feature/demo-benefit-clarity",
    ]).json;
    expect(output.repoRoot).toBe(realpathSync(repo));
    expect(output.worktreeRoot).toBe(
      path.join(realpathSync(parent), ".worktrees", "life scape"),
    );
    expect(output.worktreePath).toBe(
      path.join(
        realpathSync(parent),
        ".worktrees",
        "life scape",
        "feature-demo-benefit-clarity",
      ),
    );
  });

  it("resolves from a linked worktree without nesting under the caller", () => {
    const { repo } = fixture();
    const first = create(repo, "feature/first");
    const output = manager([
      "resolve",
      "--repo",
      first.worktreePath,
      "--branch",
      "feature/second",
    ]).json;
    expect(output.repoRoot).toBe(realpathSync(repo));
    expect(path.dirname(output.worktreeRoot)).not.toContain(first.worktreePath);
  });

  it("normalizes separators and adds a stable suffix only for collisions", () => {
    const { repo } = fixture();
    const first = create(repo, "feature/a_b");
    const output = manager([
      "resolve",
      "--repo",
      repo,
      "--branch",
      "test/a.b",
    ]).json;
    expect(first.slug).toBe("feature-a-b");
    expect(output.slug).toMatch(/^test-a-b$/);

    const collision = manager([
      "resolve",
      "--repo",
      repo,
      "--branch",
      "feature/a.b",
    ]).json;
    expect(collision.slug).toMatch(/^feature-a-b-[a-f0-9]{8}$/);
  });

  it.each(["../escape", "/absolute", "feature/%2f/escape"])(
    "rejects unsafe branch input %s",
    (branch) => {
      const { repo } = fixture();
      const { result, json } = manager(
        ["resolve", "--repo", repo, "--branch", branch],
        { ok: false },
      );
      expect(result.status).not.toBe(0);
      expect(["INVALID_BRANCH", "INVALID_SLUG"]).toContain(json.code);
    },
  );

  it("creates once and reuses the registered branch worktree", () => {
    const { repo } = fixture();
    const first = create(repo, "feature/reuse");
    const second = create(repo, "feature/reuse");
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.worktreePath).toBe(first.worktreePath);
  });

  it("refuses an occupied unregistered canonical path", () => {
    const { repo } = fixture();
    const plan = manager([
      "resolve",
      "--repo",
      repo,
      "--branch",
      "feature/occupied",
    ]).json;
    mkdirSync(plan.worktreePath, { recursive: true });
    const { result, json } = manager(
      ["create", "--repo", repo, "--branch", "feature/occupied"],
      { ok: false },
    );
    expect(result.status).not.toBe(0);
    expect(json.code).toBe("PATH_OCCUPIED");
  });

  it("removes a clean merged local-only worktree without force", () => {
    const { repo } = fixture();
    const worktree = create(repo, "feature/clean-remove");
    const output = manager([
      "remove",
      "--repo",
      repo,
      "--branch",
      "feature/clean-remove",
      "--delete-branch",
    ]).json;
    expect(output.removedPath).toBe(worktree.worktreePath);
    expect(output.branchDeleted).toBe(true);
    expect(existsSync(worktree.worktreePath)).toBe(false);
  });

  it("refuses dirty worktrees", () => {
    const { repo } = fixture();
    const worktree = create(repo, "feature/dirty");
    writeFileSync(path.join(worktree.worktreePath, "dirty.txt"), "dirty\n");
    const { json } = manager(
      ["remove", "--repo", repo, "--branch", "feature/dirty"],
      { ok: false },
    );
    expect(json.code).toBe("DIRTY");
  });

  it("requires exact ownership and recovery to remove a locked worktree", () => {
    const { repo } = fixture();
    create(repo, "feature/locked", ["--lock-reason", "owner-17"]);
    expect(
      manager(["remove", "--repo", repo, "--branch", "feature/locked"], {
        ok: false,
      }).json.code,
    ).toBe("LOCKED");
    expect(
      manager(
        [
          "remove",
          "--repo",
          repo,
          "--branch",
          "feature/locked",
          "--recover",
          "--owner",
          "wrong",
        ],
        { ok: false },
      ).json.code,
    ).toBe("LOCKED");
  });

  it("transfers a lock only when the prior ownership identity is exact", () => {
    const { repo } = fixture();
    create(repo, "feature/handoff", ["--lock-reason", "bs:dev/run-1"]);
    expect(
      manager(
        [
          "lock",
          "--repo",
          repo,
          "--branch",
          "feature/handoff",
          "--reason",
          "bs:quality/run-2",
          "--takeover-owner",
          "wrong",
        ],
        { ok: false },
      ).json.code,
    ).toBe("LOCKED");
    const transferred = manager([
      "lock",
      "--repo",
      repo,
      "--branch",
      "feature/handoff",
      "--reason",
      "bs:quality/run-2",
      "--takeover-owner",
      "bs:dev/run-1",
    ]).json;
    expect(transferred.lockReason).toBe("bs:quality/run-2");
  });

  it("refuses a clean branch with unpushed commits", () => {
    const { repo } = fixture();
    const worktree = create(repo, "feature/unpushed");
    writeFileSync(path.join(worktree.worktreePath, "change.txt"), "change\n");
    git(worktree.worktreePath, "add", "change.txt");
    git(worktree.worktreePath, "commit", "-m", "change");
    const { json } = manager(
      ["remove", "--repo", repo, "--branch", "feature/unpushed"],
      { ok: false },
    );
    expect(json.code).toBe("UNPUSHED");
  });

  it("retains worktrees with open PRs", () => {
    const { parent, repo } = fixture();
    const bin = fakeGh(parent);
    const worktree = create(repo, "feature/test");
    git(worktree.worktreePath, "push", "-u", "origin", "feature/test");
    const { json } = manager(
      ["remove", "--repo", repo, "--branch", "feature/test"],
      { ok: false, env: ghEnv(bin, "OPEN") },
    );
    expect(json.code).toBe("OPEN_PR");
  });

  it("reconciles a clean merged PR, including a manual/admin merge", () => {
    const { parent, repo } = fixture();
    const bin = fakeGh(parent);
    const worktree = create(repo, "feature/test");
    writeFileSync(path.join(worktree.worktreePath, "merged.txt"), "merged\n");
    git(worktree.worktreePath, "add", "merged.txt");
    git(worktree.worktreePath, "commit", "-m", "merged change");
    git(worktree.worktreePath, "push", "-u", "origin", "feature/test");
    git(repo, "merge", "--ff-only", "feature/test");
    git(repo, "push", "origin", "main");

    const output = manager(
      [
        "reconcile",
        "--repo",
        repo,
        "--apply",
        "--grace-hours",
        "0",
        "--recent-minutes",
        "0",
      ],
      { env: ghEnv(bin, "MERGED") },
    ).json;
    expect(output.worktrees[0].classification).toBe("clean with merged PR");
    expect(output.worktrees[0].action).toBe("removed");
    expect(existsSync(worktree.worktreePath)).toBe(false);
  });

  it("prunes stale registrations only on explicit repair", () => {
    const { repo } = fixture();
    const worktree = create(repo, "feature/stale");
    renameSync(worktree.worktreePath, `${worktree.worktreePath}-missing`);
    const output = manager([
      "reconcile",
      "--repo",
      repo,
      "--repair-stale",
    ]).json;
    expect(output.worktrees[0].classification).toBe("stale/missing path");
    expect(output.worktrees[0].action).toBe("pruned stale metadata");
  });

  it("resolves a moved primary checkout from its new filesystem location", () => {
    const { parent, repo } = fixture("before-move");
    const moved = path.join(parent, "after move");
    renameSync(repo, moved);
    const output = manager([
      "resolve",
      "--repo",
      moved,
      "--branch",
      "feature/moved-primary",
    ]).json;
    expect(output.repoRoot).toBe(realpathSync(moved));
    expect(output.worktreeRoot).toBe(
      path.join(realpathSync(parent), ".worktrees", "after move"),
    );
  });

  it("repairs a renamed repository container without losing dirty work", () => {
    const { parent, repo } = fixture("old-name");
    const worktree = create(repo, "feature/rename-repair");
    writeFileSync(
      path.join(worktree.worktreePath, "preserved.txt"),
      "keep me\n",
    );
    const renamed = path.join(parent, "new-name");
    renameSync(repo, renamed);

    const preview = manager([
      "repair",
      "--repo",
      renamed,
      "--old-repo-name",
      "old-name",
    ]).json;
    expect(preview.worktrees[0].action).toBe("would move");

    const repaired = manager([
      "repair",
      "--repo",
      renamed,
      "--old-repo-name",
      "old-name",
      "--apply",
    ]).json;
    expect(repaired.worktrees[0].action).toBe("moved and repaired");
    expect(repaired.worktrees[0].destination).toContain(
      `${path.sep}.worktrees${path.sep}new-name${path.sep}`,
    );
    expect(
      readFileSync(
        path.join(repaired.worktrees[0].destination, "preserved.txt"),
        "utf8",
      ),
    ).toBe("keep me\n");
    expect(
      git(repaired.worktrees[0].destination, "branch", "--show-current"),
    ).toBe("feature/rename-repair");
  });

  it("serializes concurrent creation attempts without duplicate worktrees", () => {
    const { repo } = fixture();
    const args = [
      MANAGER,
      "create",
      "--repo",
      repo,
      "--branch",
      "feature/concurrent",
    ];
    const first = spawnSync("node", args, { encoding: "utf8" });
    const second = spawnSync("node", args, { encoding: "utf8" });
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    const count = git(repo, "worktree", "list", "--porcelain")
      .split("\n")
      .filter((line) => line === "branch refs/heads/feature/concurrent").length;
    expect(count).toBe(1);
  });

  it("dry-runs legacy migration and applies only clean unlocked worktrees", () => {
    const { parent, repo } = fixture();
    const legacy = path.join(parent, "repo-wt-legacy");
    git(repo, "worktree", "add", "-b", "feature/legacy", legacy, "main");
    const dry = manager(["migrate", "--repo", repo, "--dry-run"]).json;
    expect(dry.applied).toBe(false);
    expect(dry.worktrees[0]).toMatchObject({
      currentPath: realpathSync(legacy),
      branch: "feature/legacy",
      safe: true,
      action: "report",
    });
    const applied = manager(["migrate", "--repo", repo, "--apply"]).json;
    expect(applied.worktrees[0].action).toBe("moved");
    expect(applied.worktrees[0].proposedPath).toContain(
      `${path.sep}.worktrees${path.sep}repo${path.sep}`,
    );
  });
});

describe("canonical-source contract", () => {
  it("keeps path construction and destructive worktree operations in the manager", () => {
    const files = run(
      "rg",
      [
        "-l",
        "--hidden",
        "--glob",
        "!.git/**",
        "--glob",
        "!scripts/__tests__/**",
        "--glob",
        "!CHANGELOG.md",
        "git worktree add|git worktree remove|-[Ww][Tt]-|-worktrees/",
        ".",
      ],
      { cwd: ROOT, ok: false },
    )
      .stdout.trim()
      .split("\n")
      .filter(Boolean);
    expect(files).toEqual([]);
  });

  it("contains no force worktree removal, recursive deletion, or force branch deletion", () => {
    const source = readFileSync(MANAGER, "utf8");
    expect(source).not.toMatch(/worktree["',\s]+remove["',\s]+--force/);
    expect(source).not.toContain("rm -rf");
    expect(source).not.toMatch(/branch["',\s]+-D/);
  });
});
