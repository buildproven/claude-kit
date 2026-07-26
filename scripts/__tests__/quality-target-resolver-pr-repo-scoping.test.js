import { describe, it, expect, afterEach } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  parseArgs,
  resolveTarget,
  parseOwnerRepo,
  expandHome,
} = require("../quality-target-resolver.js");

// BUI-391: resolving `--pr <n>` without `--repo` scoping can silently pick
// the wrong repo when a PR number collides across repos (e.g. PR #141 exists
// in both buildproven/claude-kit and buildproven/claude-setup). These tests
// simulate two different --target-dir checkouts, each with its own origin
// remote, both being asked to resolve "the same" PR number, and assert each
// resolves against ITS OWN repo — never cross-contaminating.

describe("expandHome", () => {
  const originalHome = process.env.HOME;

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  });

  it("expands a leading ~ to HOME", () => {
    process.env.HOME = "/Users/example";
    expect(expandHome("~/repos/claude-kit")).toBe(
      "/Users/example/repos/claude-kit",
    );
    expect(expandHome("~")).toBe("/Users/example");
  });

  it("leaves a bare tilde path unchanged when HOME is unset", () => {
    // Regression: substituting the literal string "~" back in for a missing
    // HOME is a silent no-op that looks like it worked but leaves the path
    // unresolved, causing downstream lookups to fail against a nonexistent
    // literal `~`-prefixed directory.
    delete process.env.HOME;
    expect(expandHome("~/repos/claude-kit")).toBe("~/repos/claude-kit");
  });

  it("does not touch a path without a leading ~", () => {
    process.env.HOME = "/Users/example";
    expect(expandHome("/repos/claude-kit")).toBe("/repos/claude-kit");
  });

  it("does not expand a ~ that isn't at the start of the path", () => {
    process.env.HOME = "/Users/example";
    expect(expandHome("/repos/~claude-kit")).toBe("/repos/~claude-kit");
  });
});

describe("parseOwnerRepo", () => {
  it("parses an https remote URL", () => {
    expect(
      parseOwnerRepo("https://github.com/buildproven/claude-kit.git"),
    ).toBe("buildproven/claude-kit");
  });

  it("parses an https remote URL without a trailing .git", () => {
    expect(parseOwnerRepo("https://github.com/buildproven/claude-setup")).toBe(
      "buildproven/claude-setup",
    );
  });

  it("parses an ssh scp-like remote URL", () => {
    expect(parseOwnerRepo("git@github.com:buildproven/claude-kit.git")).toBe(
      "buildproven/claude-kit",
    );
  });

  it("parses an ssh:// scheme remote URL", () => {
    expect(
      parseOwnerRepo("ssh://git@github.com/buildproven/claude-setup.git"),
    ).toBe("buildproven/claude-setup");
  });

  it("returns null for a malformed or non-URL value", () => {
    expect(parseOwnerRepo("not a url")).toBeNull();
    expect(parseOwnerRepo("")).toBeNull();
    expect(parseOwnerRepo(null)).toBeNull();
    expect(parseOwnerRepo(undefined)).toBeNull();
  });

  it("parses a credential-embedded https github.com URL", () => {
    expect(
      parseOwnerRepo(
        "https://x-access-token:tok@github.com/buildproven/claude-kit.git",
      ),
    ).toBe("buildproven/claude-kit");
  });

  // Regression: the shape `host.tld/owner/repo` matches GitLab, Bitbucket,
  // and self-hosted git servers just as readily as github.com. Accepting any
  // host here would let getRepoForDir resolve a non-GitHub checkout to an
  // `owner/repo` string that then gets fed into `gh pr view --repo`, which
  // always queries GitHub — silently auditing an unrelated same-named repo
  // instead of failing closed as BUI-391 requires.
  it("returns null for a same-shaped URL on a non-github.com host (https)", () => {
    expect(
      parseOwnerRepo("https://gitlab.com/buildproven/claude-kit.git"),
    ).toBeNull();
    expect(
      parseOwnerRepo("https://github.com.attacker.io/buildproven/claude-kit"),
    ).toBeNull();
  });

  it("returns null for a same-shaped URL on a non-github.com host (ssh)", () => {
    expect(
      parseOwnerRepo("git@gitlab.com:buildproven/claude-kit.git"),
    ).toBeNull();
    expect(
      parseOwnerRepo("ssh://git@bitbucket.org/buildproven/claude-kit.git"),
    ).toBeNull();
  });
});

// Simulates two mock repo checkouts with different origin remotes, and a
// `gh pr view` stand-in that returns a DIFFERENT PR for the "same" number
// depending on which --repo it was scoped to — mirroring real collision
// behavior where PR #141 means something different in each repo.
function makeMockRepos() {
  const repos = {
    "/repos/claude-kit": "https://github.com/buildproven/claude-kit.git",
    "/repos/claude-setup": "git@github.com:buildproven/claude-setup.git",
  };

  const prsByRepo = {
    "buildproven/claude-kit": {
      141: {
        headRefName: "fix/kit-thing",
        url: "https://github.com/buildproven/claude-kit/pull/141",
        repo: "buildproven/claude-kit",
      },
    },
    "buildproven/claude-setup": {
      141: {
        headRefName: "fix/setup-thing",
        url: "https://github.com/buildproven/claude-setup/pull/141",
        repo: "buildproven/claude-setup",
      },
    },
  };

  const getRepoForDir = (dir) => {
    const remote = repos[dir];
    return remote ? parseOwnerRepo(remote) : null;
  };

  // Mimics the real CLI lookupPr: when a repo is supplied, scope to it
  // (as `gh pr view --repo <repo>` would); when not supplied, fall back to
  // "ambient" resolution — here modeled as always landing on claude-kit's
  // PR, simulating a `gh` whose ambient cwd/config points at claude-kit
  // regardless of which --target-dir the caller meant.
  const lookupPr = (n, repo) => {
    if (repo) {
      const found = prsByRepo[repo] && prsByRepo[repo][n];
      return found || null;
    }
    return prsByRepo["buildproven/claude-kit"][n] || null;
  };

  return { getRepoForDir, lookupPr, dirExists: () => false };
}

describe("resolveTarget / resolveByPr — cross-repo PR-number collision (BUI-391)", () => {
  it("resolves PR #141 against claude-kit when --target-dir points at claude-kit", () => {
    const { getRepoForDir, lookupPr, dirExists } = makeMockRepos();
    const parsed = parseArgs([
      "--pr",
      "141",
      "--target-dir",
      "/repos/claude-kit",
    ]);
    const result = resolveTarget(parsed, {
      cwd: "/somewhere",
      primaryCheckout: null,
      findWorktreeForBranch: () => null,
      dirExists,
      lookupPr,
      getRepoForDir,
    });

    expect(result.ok).toBe(true);
    expect(result.targetBranch).toBe("fix/kit-thing");
  });

  it("resolves PR #141 against claude-setup when --target-dir points at claude-setup, not claude-kit", () => {
    const { getRepoForDir, lookupPr, dirExists } = makeMockRepos();
    const parsed = parseArgs([
      "--pr",
      "141",
      "--target-dir",
      "/repos/claude-setup",
    ]);
    const result = resolveTarget(parsed, {
      cwd: "/somewhere",
      primaryCheckout: null,
      findWorktreeForBranch: () => null,
      dirExists,
      lookupPr,
      getRepoForDir,
    });

    expect(result.ok).toBe(true);
    expect(result.targetBranch).toBe("fix/setup-thing");
    expect(result.targetBranch).not.toBe("fix/kit-thing");
  });

  it("fails closed when the resolved PR's repo does not match --target-dir's repo", () => {
    // Simulate a lookupPr that ignores the repo hint entirely (e.g. --repo
    // scoping somehow didn't take effect) and always resolves to claude-kit,
    // even when --target-dir named claude-setup. The cross-check must catch
    // this and hard-error rather than silently returning claude-kit's PR.
    const { getRepoForDir, dirExists } = makeMockRepos();
    const brokenLookupPr = () => ({
      headRefName: "fix/kit-thing",
      url: "https://github.com/buildproven/claude-kit/pull/141",
      repo: "buildproven/claude-kit",
    });

    const parsed = parseArgs([
      "--pr",
      "141",
      "--target-dir",
      "/repos/claude-setup",
    ]);
    const result = resolveTarget(parsed, {
      cwd: "/somewhere",
      primaryCheckout: null,
      findWorktreeForBranch: () => null,
      dirExists,
      lookupPr: brokenLookupPr,
      getRepoForDir,
    });

    expect(result.ok).toBe(false);
    expect(result.resolution).toBe("pr");
    expect(result.reason).toMatch(/does not match/i);
    expect(result.reason).toContain("buildproven/claude-kit");
    expect(result.reason).toContain("buildproven/claude-setup");
  });

  it("scopes the lookupPr call itself with the derived repo (--repo semantics)", () => {
    const { getRepoForDir, dirExists } = makeMockRepos();
    const seenRepos = [];
    const scopedLookupPr = (n, repo) => {
      seenRepos.push(repo);
      if (repo === "buildproven/claude-setup") {
        return {
          headRefName: "fix/setup-thing",
          url: "https://github.com/buildproven/claude-setup/pull/141",
          repo: "buildproven/claude-setup",
        };
      }
      return null;
    };

    const parsed = parseArgs([
      "--pr",
      "141",
      "--target-dir",
      "/repos/claude-setup",
    ]);
    resolveTarget(parsed, {
      cwd: "/somewhere",
      primaryCheckout: null,
      findWorktreeForBranch: () => null,
      dirExists,
      lookupPr: scopedLookupPr,
      getRepoForDir,
    });

    expect(seenRepos).toEqual(["buildproven/claude-setup"]);
  });

  it("falls back to ambient (unscoped) lookupPr when --target-dir is not supplied", () => {
    // No --target-dir means there's nothing to cross-check against — current
    // ambient-cwd behavior remains unavoidable and should be unchanged.
    const { lookupPr, dirExists } = makeMockRepos();
    const parsed = parseArgs(["--pr", "141"]);
    const result = resolveTarget(parsed, {
      cwd: "/somewhere",
      primaryCheckout: null,
      findWorktreeForBranch: () => null,
      dirExists,
      lookupPr,
      getRepoForDir: () => null,
    });

    expect(result.ok).toBe(true);
    expect(result.targetBranch).toBe("fix/kit-thing");
  });

  it("does not call getRepoForDir when --pr is supplied without --target-dir", () => {
    const { lookupPr, dirExists } = makeMockRepos();
    let called = false;
    const parsed = parseArgs(["--pr", "141"]);
    resolveTarget(parsed, {
      cwd: "/somewhere",
      primaryCheckout: null,
      findWorktreeForBranch: () => null,
      dirExists,
      lookupPr,
      getRepoForDir: () => {
        called = true;
        return null;
      },
    });

    expect(called).toBe(false);
  });

  it("fails closed when --target-dir is supplied but its repo cannot be determined", () => {
    // getRepoForDir returns null for /repos/no-origin (e.g. a checkout with
    // no origin remote, or a non-GitHub remote URL). The old behavior was to
    // silently fall through to unscoped ambient resolution here — exactly
    // the collision bug BUI-391 exists to prevent. It must now refuse.
    const { lookupPr, dirExists } = makeMockRepos();
    const parsed = parseArgs([
      "--pr",
      "141",
      "--target-dir",
      "/repos/no-origin",
    ]);
    const result = resolveTarget(parsed, {
      cwd: "/somewhere",
      primaryCheckout: null,
      findWorktreeForBranch: () => null,
      dirExists,
      lookupPr,
      getRepoForDir: () => null,
    });

    expect(result.ok).toBe(false);
    expect(result.resolution).toBe("pr");
    expect(result.reason).toMatch(/could not determine.*repository/i);
    expect(result.reason).toContain("/repos/no-origin");
  });

  it("fails closed when --target-dir is supplied but ctx.getRepoForDir is omitted entirely", () => {
    // Regression: `if (parsed.path && getRepoForDir)` used to gate the whole
    // cross-check on getRepoForDir being truthy. A caller (this resolver
    // module is exported and documented to accept an optional
    // ctx.getRepoForDir) that supplies --pr + --target-dir but doesn't wire
    // up getRepoForDir at all — as opposed to wiring it up and having it
    // return null — silently skipped the check and fell through to unscoped
    // resolution, reopening the exact BUI-391 collision. Omitting the
    // function must fail closed identically to it returning null.
    const { lookupPr, dirExists } = makeMockRepos();
    const parsed = parseArgs([
      "--pr",
      "141",
      "--target-dir",
      "/repos/claude-setup",
    ]);
    const result = resolveTarget(parsed, {
      cwd: "/somewhere",
      primaryCheckout: null,
      findWorktreeForBranch: () => null,
      dirExists,
      lookupPr,
      // getRepoForDir intentionally omitted from ctx.
    });

    expect(result.ok).toBe(false);
    expect(result.resolution).toBe("pr");
    expect(result.reason).toMatch(/could not determine.*repository/i);
  });

  it("fails closed when lookupPr cannot independently confirm the resolved repo", () => {
    // Simulates gh returning a PR URL in an unrecognized format (e.g. GitHub
    // Enterprise), so lookupPr reports repo: null instead of echoing back
    // the --repo hint it was scoped with. The cross-check must treat "unknown"
    // as untrustworthy, not as "confirmed same repo".
    const { getRepoForDir, dirExists } = makeMockRepos();
    const unverifiableLookupPr = () => ({
      headRefName: "fix/enterprise-thing",
      url: "https://github.mycompany.com/buildproven/claude-setup/pull/141",
      repo: null,
    });

    const parsed = parseArgs([
      "--pr",
      "141",
      "--target-dir",
      "/repos/claude-setup",
    ]);
    const result = resolveTarget(parsed, {
      cwd: "/somewhere",
      primaryCheckout: null,
      findWorktreeForBranch: () => null,
      dirExists,
      lookupPr: unverifiableLookupPr,
      getRepoForDir,
    });

    expect(result.ok).toBe(false);
    expect(result.resolution).toBe("pr");
    expect(result.reason).toMatch(/not return a verifiable repository/i);
  });
});
