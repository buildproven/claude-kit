// Regression coverage for BUI-444: the curl|bash installer must be able to
// upgrade a pre-existing checkout that predates claude-link-manifest.sh
// (claude-kit PR #149 / BUI-413). Before the fix, install.sh unconditionally
// sourced scripts/claude-link-manifest.sh; a checkout cloned before that file
// existed had no way to gain it (re-running the installer only re-downloads
// install.sh itself, it never updates PROJECT_DIR), so `source` failed and
// set -euo pipefail aborted the whole install.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const INSTALL_SCRIPT = path.join(REPO_ROOT, "install.sh");

/** A throwaway HOME + PROJECT_DIR pair, isolated from the real filesystem. */
function sandbox() {
  const root = mkdtempSync(path.join(tmpdir(), "kit-install-upgrade-"));
  return {
    home: path.join(root, "home"),
    projectDir: path.join(root, "claude-kit"),
  };
}

/**
 * Seed PROJECT_DIR as a checkout that predates claude-link-manifest.sh: a
 * full copy of the real repo with that one file (and any .git metadata)
 * removed, so install.sh has nothing to source and nothing to fast-forward.
 */
function seedPreManifestCheckout(projectDir) {
  cpSync(REPO_ROOT, projectDir, {
    recursive: true,
    filter: (src) =>
      !src.includes(`${path.sep}.git${path.sep}`) &&
      !src.endsWith(`${path.sep}.git`),
  });
  rmSync(path.join(projectDir, "scripts", "claude-link-manifest.sh"), {
    force: true,
  });
}

function run({ home, projectDir }) {
  const env = {
    ...process.env,
    HOME: home,
    CLAUDE_KIT_DIR: projectDir,
  };
  try {
    const stdout = execFileSync("bash", [INSTALL_SCRIPT], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout };
  } catch (e) {
    return {
      code: e.status,
      stdout: (e.stdout ?? "") + (e.stderr ?? ""),
    };
  }
}

describe("install.sh upgrade path (BUI-444)", () => {
  it("does not abort when PROJECT_DIR has no .git and no manifest — falls back", () => {
    const { home, projectDir } = sandbox();
    seedPreManifestCheckout(projectDir);
    expect(existsSync(path.join(projectDir, ".git"))).toBe(false);
    expect(
      existsSync(path.join(projectDir, "scripts", "claude-link-manifest.sh")),
    ).toBe(false);

    const { code, stdout } = run({ home, projectDir });

    expect(code).toBe(0);
    expect(stdout).toMatch(/built-in fallback link list/);
    for (const d of ["commands", "skills", "agents", "scripts"]) {
      expect(readlinkSync(path.join(home, ".claude", d))).toBe(
        path.join(projectDir, d),
      );
    }
    expect(
      existsSync(path.join(home, ".claude", "scripts", "block-push-main.sh")),
    ).toBe(true);
  });

  it("self-heals by pulling when PROJECT_DIR is a real git checkout missing the manifest", () => {
    const { home, projectDir } = sandbox();

    // Bare "origin" seeded from the pre-manifest commit (parent of #149),
    // and a shallow local clone of it standing in for the user's stale
    // checkout — exactly what re-running curl|bash against an old `git
    // clone`d install looks like.
    const bareRemote = `${projectDir}-origin.git`;
    const preManifestRef = execFileSync(
      "git",
      [
        "-C",
        REPO_ROOT,
        "log",
        "--format=%H",
        "-1",
        "--follow",
        "--diff-filter=A",
        "--",
        "scripts/claude-link-manifest.sh",
      ],
      { encoding: "utf8" },
    ).trim();
    const parentRef = execFileSync(
      "git",
      ["-C", REPO_ROOT, "rev-parse", `${preManifestRef}^`],
      { encoding: "utf8" },
    ).trim();

    execFileSync("git", [
      "clone",
      "--no-local",
      REPO_ROOT,
      bareRemote,
      "--bare",
    ]);
    execFileSync("git", ["clone", bareRemote, projectDir]);
    // Rewind the local branch to the pre-manifest commit but keep it
    // tracking origin/main, exactly like a stale `git clone`d checkout that
    // simply hasn't been pulled since before PR #149 landed.
    execFileSync("git", ["-C", projectDir, "reset", "--hard", parentRef]);

    expect(
      existsSync(path.join(projectDir, "scripts", "claude-link-manifest.sh")),
    ).toBe(false);

    const { code, stdout } = run({ home, projectDir });

    expect(code).toBe(0);
    // Pulled to a commit that has the manifest — fallback path not needed.
    expect(stdout).not.toMatch(/built-in fallback link list/);
    expect(
      existsSync(path.join(projectDir, "scripts", "claude-link-manifest.sh")),
    ).toBe(true);
    for (const d of ["commands", "skills", "agents", "scripts"]) {
      expect(readlinkSync(path.join(home, ".claude", d))).toBe(
        path.join(projectDir, d),
      );
    }
  });
});
