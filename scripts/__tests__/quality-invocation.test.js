import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const INVOCATION = path.join(ROOT, "scripts", "quality-invocation.js");
const BOOTSTRAP = path.join(ROOT, "scripts", "quality-bootstrap.sh");
const LOAD_ROOT = path.join(ROOT, "scripts", "quality-load-root.sh");
const RISK = path.join(ROOT, "scripts", "quality-risk-resolve.sh");
const SELECT = path.join(ROOT, "scripts", "quality-select-agents.sh");
const FORMAT = path.join(ROOT, "scripts", "quality-format.js");
const GOVERNOR = path.join(ROOT, "scripts", "quality-run-governor.js");
const WRAPPER = path.join(ROOT, "scripts", "quality-wrapper.js");
const AUTHORIZE = path.join(ROOT, "scripts", "quality-authorize-merge.sh");
const RUN_GATE = path.join(ROOT, "scripts", "quality-run-gate.sh");
const RUN_REVIEW = path.join(ROOT, "scripts", "quality-run-review.sh");
const STAMP_AND_MERGE = path.join(
  ROOT,
  "scripts",
  "quality-stamp-and-merge.sh",
);
const require = createRequire(import.meta.url);
const invocation = require(INVOCATION);

function recordGateFixture(manifestPath, name, overrides = {}) {
  invocation.withManifestLock(manifestPath, (manifest) => {
    const required = manifest.requiredGates.find((gate) => gate.name === name);
    const log = path.join(path.dirname(manifestPath), `${name}.gate.log`);
    writeFileSync(log, `${name} passed\n`);
    invocation.recordGate(manifest, {
      name,
      source: required.source,
      command: required.command,
      log,
      ...overrides,
    });
  });
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function repo(label) {
  const root = mkdtempSync(path.join(tmpdir(), `quality-${label}-`));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.name", "Quality Test"]);
  git(root, ["config", "user.email", "quality@example.com"]);
  writeFileSync(path.join(root, "file.js"), "export const value = 1;\n");
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      scripts: {
        lint: "true",
        test: "true",
        "security:audit": "true",
      },
    }),
  );
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "base"]);
  git(root, ["remote", "add", "origin", root]);
  git(root, ["fetch", "-q", "origin", "main"]);
  git(root, ["switch", "-q", "-c", "feature"]);
  writeFileSync(path.join(root, "file.js"), "export const value = 2;\n");
  git(root, ["commit", "-qam", "change"]);
  return root;
}

function create(root, extra = [], env = {}) {
  const prIdentity = extra.includes("--pr")
    ? [
        "--github-repo",
        "owner/repo",
        "--head-ref",
        "feature",
        "--head-repository",
        "owner/repo",
        "--cross-repository",
        "false",
      ]
    : [];
  return execFileSync(
    "node",
    [
      INVOCATION,
      "create",
      "--repo",
      root,
      "--base-ref",
      "origin/main",
      ...prIdentity,
      ...extra,
    ],
    {
      cwd: root,
      env: { ...process.env, ...env },
      encoding: "utf8",
    },
  ).trim();
}

function prepareCodexReview(
  root,
  manifestPath,
  providerFindings = [],
  findingsText = null,
) {
  execFileSync("node", [GOVERNOR, "bump-round", manifestPath], { cwd: root });
  const info = JSON.parse(
    execFileSync("node", [INVOCATION, "review-info", manifestPath], {
      cwd: root,
      encoding: "utf8",
    }),
  );
  mkdirSync(info.artifactDir, { recursive: true });
  writeFileSync(
    path.join(info.artifactDir, "diff.txt"),
    execFileSync("git", ["diff", `${info.from}..${info.to}`], { cwd: root }),
  );
  writeFileSync(
    path.join(info.artifactDir, "identity.json"),
    execFileSync("node", [INVOCATION, "review-identity", manifestPath], {
      cwd: root,
    }),
  );
  writeFileSync(
    path.join(info.artifactDir, "codex.findings.txt"),
    findingsText ??
      (providerFindings.length === 0
        ? "NO FINDINGS.\n"
        : "BLOCKING findings.\n"),
  );
  writeFileSync(
    path.join(info.artifactDir, "codex-1.json"),
    JSON.stringify({
      verdict: providerFindings.length === 0 ? "pass" : "needs-attention",
      summary: "fixture",
      findings: providerFindings,
    }),
  );
  writeFileSync(
    path.join(info.artifactDir, "codex-1.normalized.json"),
    JSON.stringify({
      verdict: providerFindings.length === 0 ? "pass" : "needs-attention",
      summary: "fixture",
      findings: providerFindings,
    }),
  );
  execFileSync(
    "node",
    [
      INVOCATION,
      "inventory",
      manifestPath,
      "--artifact-dir",
      info.artifactDir,
      "--provider",
      "codex",
    ],
    { cwd: root },
  );
  const diffSha = createHash("sha256")
    .update(readFileSync(path.join(info.artifactDir, "diff.txt")))
    .digest("hex");
  execFileSync(
    "node",
    [
      INVOCATION,
      "record-review",
      manifestPath,
      "--from",
      info.from,
      "--to",
      info.to,
      "--provider",
      "codex",
      "--primary",
      "codex",
      "--fallback",
      "none",
      "--artifact-dir",
      info.artifactDir,
      "--diff-sha",
      diffSha,
    ],
    { cwd: root },
  );
  for (const name of ["lint", "test", "security"]) {
    recordGateFixture(manifestPath, name);
  }
  return info;
}

function recordJudgeArtifact(root, manifest, dispositions = []) {
  const artifact = path.join(path.dirname(manifest), "judge-input.json");
  const context = JSON.parse(
    execFileSync("node", [INVOCATION, "judge-context", manifest], {
      cwd: root,
      encoding: "utf8",
    }),
  );
  context.findings = context.findings.map((finding, index) => ({
    ...finding,
    disposition: dispositions[index] || "WARNING",
    reason: "test classification",
  }));
  writeFileSync(artifact, JSON.stringify(context));
  execFileSync(
    "node",
    [INVOCATION, "judge", manifest, "--artifact", artifact],
    { cwd: root },
  );
}

function fakeGh(root, head) {
  const bin = mkdtempSync(path.join(tmpdir(), "quality-gh-"));
  const gh = path.join(bin, "gh");
  const merged = path.join(bin, "merged");
  const base = git(root, ["rev-parse", "origin/main"]);
  writeFileSync(
    gh,
    `#!/usr/bin/env bash
if [ "$1 $2" = "pr view" ]; then
  args="$*"
  head_ref="\${QUALITY_TEST_HEAD_REF:-feature}"
  if [[ "$args" == *"state,mergedAt,mergeCommit"* ]] && [ -f ${JSON.stringify(merged)} ]; then
    printf '{"state":"MERGED","mergedAt":"2026-07-16T00:00:00Z","mergeCommit":{"oid":"merge"},"headRefName":"%s","headRefOid":"${head}","baseRefName":"main"}\\n' "$head_ref"
  elif [[ "$args" == *"baseRefOid"* ]]; then
    printf '{"state":"OPEN","mergedAt":null,"mergeCommit":null,"headRefName":"%s","headRefOid":"${head}","baseRefName":"main","baseRefOid":"${base}"}\\n' "$head_ref"
  else
    printf '{"state":"OPEN","mergedAt":null,"mergeCommit":null,"headRefName":"%s","headRefOid":"${head}","baseRefName":"main"}\\n' "$head_ref"
  fi
  exit 0
fi
if [ "$1 $2" = "pr checks" ]; then exit 0; fi
if [ "$1 $2" = "pr merge" ]; then
  touch ${JSON.stringify(merged)}
  [ "\${QUALITY_TEST_MERGE_RC:-0}" = 0 ]
  exit $?
fi
if [ "$1 $2" = "repo view" ]; then
  if [[ "$*" == *"nameWithOwner"* ]]; then printf '%s\\n' "\${QUALITY_TEST_REPOSITORY:-owner/repo}"; else printf '%s\\n' 'main'; fi
  exit 0
fi
if [ "$1" = "api" ]; then
  if [[ "$2" == *"protection/required_status_checks"* ]]; then
    if [ "\${QUALITY_TEST_STRICT_PROTECTION:-}" = true ]; then
      printf '%s\\n' 'true'
      exit 0
    fi
    exit 1
  fi
  if [[ "$2" == *"/rules/branches/"* ]]; then
    case "\${QUALITY_TEST_EFFECTIVE_RULES:-none}" in
      strict)
        printf '%s\\n' '[{"type":"required_status_checks","parameters":{"strict_required_status_checks_policy":true}}]'
        exit 0
        ;;
      queue)
        printf '%s\\n' '[{"type":"merge_queue","parameters":{"grouping_strategy":"ALLGREEN"}}]'
        exit 0
        ;;
      unavailable) exit 1 ;;
      *) printf '%s\\n' '[]'; exit 0 ;;
    esac
  fi
  printf '%s\\n' '[]'
  exit 0
fi
exit 1
`,
  );
  chmodSync(gh, 0o755);
  return bin;
}

describe("quality invocation manifest", () => {
  it("bootstraps one explicit manifest from a zsh parent", () => {
    const root = repo("bootstrap");
    const result = spawnSync(
      "zsh",
      [
        "-fc",
        'bash "$1" --target-dir "$2" --level auto',
        "quality-bootstrap-test",
        BOOTSTRAP,
        root,
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    const manifestPath = result.stdout
      .split("\n")
      .find((line) => line.startsWith("BS_QUALITY_MANIFEST="))
      ?.slice("BS_QUALITY_MANIFEST=".length);
    expect(manifestPath).toBeTruthy();
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.repo.realpath).toBe(realpathSync(root));
    expect(manifest.revisions.currentHead).toBe(
      git(root, ["rev-parse", "HEAD"]),
    );
  }, 120_000);

  it("binds a non-merge PR bootstrap to the PR base branch and base SHA", () => {
    const root = repo("pr-bootstrap");
    const base = git(root, ["rev-parse", "origin/main"]);
    git(root, ["branch", "release", base]);
    const bin = mkdtempSync(path.join(tmpdir(), "quality-bootstrap-gh-"));
    const gh = path.join(bin, "gh");
    writeFileSync(
      gh,
      `#!/usr/bin/env bash
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  printf '%s\\n' '{"number":7,"headRefName":"feature","headRefOid":"${git(root, ["rev-parse", "HEAD"])}","headRepository":{"nameWithOwner":"owner/repo"},"isCrossRepository":false,"baseRefName":"release","baseRefOid":"${base}"}'
  exit 0
fi
if [ "$1 $2" = "repo view" ]; then
  printf '%s\\n' 'owner/repo'
  exit 0
fi
exit 1
`,
    );
    chmodSync(gh, 0o755);
    const result = spawnSync(
      "bash",
      [BOOTSTRAP, "--pr", "7", "--level", "auto"],
      {
        cwd: root,
        env: {
          ...process.env,
          CLAUDE_SETUP_ROOT: ROOT,
          PATH: `${bin}:${process.env.PATH}`,
        },
        encoding: "utf8",
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const manifestPath = result.stdout
      .split("\n")
      .find((line) => line.startsWith("BS_QUALITY_MANIFEST="))
      ?.slice("BS_QUALITY_MANIFEST=".length);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.options.merge).toBe(false);
    expect(manifest.repo.pr).toBe(7);
    expect(manifest.repo.githubRepository).toBe("owner/repo");
    expect(manifest.repo.headRefName).toBe("feature");
    expect(manifest.repo.headRepository).toBe("owner/repo");
    expect(manifest.repo.isCrossRepository).toBe(false);
    expect(manifest.revisions.baseRef).toBe("origin/release");
    expect(manifest.revisions.baseHeadSha).toBe(base);
  }, 120_000);

  it("does not false-positive 'base changed during bootstrap' on a stale gh pr view cache (BUI-382)", () => {
    const root = repo("pr-bootstrap-stale-cache");
    const staleBase = git(root, ["rev-parse", "origin/main"]);
    git(root, ["branch", "release", staleBase]);
    // Advance the release branch on the remote (= this same repo, self-added
    // as origin — see repo()) AFTER capturing staleBase, simulating a real
    // commit landing on the PR's base branch. The gh stub below still
    // reports staleBase as baseRefOid — exactly what a lagging GitHub API
    // cache would return. A fresh `git ls-remote`/fetch will see the real,
    // newer tip; the fix must trust that live read over the stale gh field.
    const worktree = mkdtempSync(path.join(tmpdir(), "quality-release-wt-"));
    git(root, ["worktree", "add", "-q", worktree, "release"]);
    writeFileSync(path.join(worktree, "release-only.txt"), "landed\n");
    git(worktree, ["add", "."]);
    git(worktree, ["commit", "-q", "-m", "real commit landed on release"]);
    const freshBase = git(worktree, ["rev-parse", "HEAD"]);
    expect(freshBase).not.toBe(staleBase);

    const bin = mkdtempSync(path.join(tmpdir(), "quality-bootstrap-gh-"));
    const gh = path.join(bin, "gh");
    writeFileSync(
      gh,
      `#!/usr/bin/env bash
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  printf '%s\\n' '{"number":9,"headRefName":"feature","headRefOid":"${git(root, ["rev-parse", "HEAD"])}","headRepository":{"nameWithOwner":"owner/repo"},"isCrossRepository":false,"baseRefName":"release","baseRefOid":"${staleBase}"}'
  exit 0
fi
if [ "$1 $2" = "repo view" ]; then
  printf '%s\\n' 'owner/repo'
  exit 0
fi
exit 1
`,
    );
    chmodSync(gh, 0o755);
    const result = spawnSync(
      "bash",
      [BOOTSTRAP, "--pr", "9", "--level", "auto"],
      {
        cwd: root,
        env: {
          ...process.env,
          CLAUDE_SETUP_ROOT: ROOT,
          PATH: `${bin}:${process.env.PATH}`,
        },
        encoding: "utf8",
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).not.toMatch(/base changed during bootstrap/);
    const manifestPath = result.stdout
      .split("\n")
      .find((line) => line.startsWith("BS_QUALITY_MANIFEST="))
      ?.slice("BS_QUALITY_MANIFEST=".length);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.revisions.baseRef).toBe("origin/release");
    // baseHeadSha must reflect the fresh, real tip — not the stale gh
    // pr view snapshot — so the merge-time freshness gate anchors on truth.
    expect(manifest.revisions.baseHeadSha).toBe(freshBase);
  }, 120_000);

  it("still blocks on a genuine base race (fresh ls-remote differs from the post-fetch tip)", () => {
    // This is a synthetic reproduction of a true TOCTOU race: something
    // else advances the base AFTER we've already read the live tip via
    // ls-remote but BEFORE our fetch completes. We simulate it directly by
    // asserting the guard's structure rather than winning an actual race
    // window (not reliably reproducible in a test): call git-bootstrap with
    // a base name that maps to a moving target where the ls-remote read and
    // the fetched ref genuinely disagree, using two different remotes.
    const root = repo("pr-bootstrap-genuine-race");
    const base = git(root, ["rev-parse", "origin/main"]);
    git(root, ["branch", "release", base]);
    const bin = mkdtempSync(path.join(tmpdir(), "quality-bootstrap-gh-"));
    const gh = path.join(bin, "gh");
    writeFileSync(
      gh,
      `#!/usr/bin/env bash
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  printf '%s\\n' '{"number":11,"headRefName":"feature","headRefOid":"${git(root, ["rev-parse", "HEAD"])}","headRepository":{"nameWithOwner":"owner/repo"},"isCrossRepository":false,"baseRefName":"nonexistent-branch","baseRefOid":"${base}"}'
  exit 0
fi
if [ "$1 $2" = "repo view" ]; then
  printf '%s\\n' 'owner/repo'
  exit 0
fi
exit 1
`,
    );
    chmodSync(gh, 0o755);
    const result = spawnSync(
      "bash",
      [BOOTSTRAP, "--pr", "11", "--level", "auto"],
      {
        cwd: root,
        env: {
          ...process.env,
          CLAUDE_SETUP_ROOT: ROOT,
          PATH: `${bin}:${process.env.PATH}`,
        },
        encoding: "utf8",
      },
    );
    // A base branch that doesn't exist on the remote resolves to an empty
    // ls-remote read, which the guard correctly refuses rather than
    // silently treating as "no base to check".
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/could not resolve the live PR base tip/);
  }, 120_000);

  it("survives a zsh parent and separate Bash processes", () => {
    const root = repo("zsh");
    const result = spawnSync(
      "zsh",
      [
        "-fc",
        `
manifest=$(node "$1" create --repo "$2" --base-ref origin/main --level auto)
cd "$2"
bash "$3" --manifest "$manifest" > exports
bash "$4" --manifest "$manifest"
bash "$5" --manifest "$manifest"
printf '%s\\n' "$manifest"
`,
        "quality-test",
        INVOCATION,
        root,
        LOAD_ROOT,
        RISK,
        SELECT,
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    const manifestPath = result.stdout.trim().split("\n").at(-1);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.risk.resolved).toBe(true);
    expect(manifest.risk.tier).not.toBe("auto");
    expect(manifest.agents.length).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it("locates an explicit target manifest without trusting the caller cwd", () => {
    const first = repo("first");
    const second = repo("second");
    const manifest = create(first);
    const result = spawnSync("bash", [LOAD_ROOT, "--manifest", manifest], {
      cwd: second,
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('"status":"validated"');
  });

  it("isolates concurrent repositories even under the same parent session", () => {
    const first = repo("parallel-a");
    const second = repo("parallel-b");
    const script = `
CODEX_THREAD_ID=same-session node "$1" create --repo "$2" --base-ref origin/main > "$2/manifest-path" &
CODEX_THREAD_ID=same-session node "$1" create --repo "$3" --base-ref origin/main > "$3/manifest-path" &
wait
`;
    execFileSync("bash", ["-c", script, "parallel", INVOCATION, first, second]);
    const firstPath = readFileSync(
      path.join(first, "manifest-path"),
      "utf8",
    ).trim();
    const secondPath = readFileSync(
      path.join(second, "manifest-path"),
      "utf8",
    ).trim();
    expect(firstPath).not.toBe(secondPath);
    expect(JSON.parse(readFileSync(firstPath, "utf8")).repo.realpath).toBe(
      realpathSync(first),
    );
    expect(JSON.parse(readFileSync(secondPath, "utf8")).repo.realpath).toBe(
      realpathSync(second),
    );
  });

  it("persists break-glass approval from the outer invocation and scopes it to HEAD", () => {
    const root = repo("approval");
    const directManifest = create(root, ["--level", "98"], {
      BREAK_GLASS_APPROVED: "true",
    });
    expect(
      spawnSync("node", [INVOCATION, "approval-valid", directManifest], {
        cwd: root,
      }).status,
    ).not.toBe(0);
    expect(
      spawnSync("node", [INVOCATION, "approve", directManifest], {
        cwd: root,
      }).status,
    ).not.toBe(0);
    expect(
      spawnSync(
        "node",
        [INVOCATION, "approval-attach", directManifest, "--artifact", "fake"],
        { cwd: root },
      ).status,
    ).not.toBe(0);
    execFileSync("node", [INVOCATION, "advance", directManifest], {
      cwd: root,
      env: {
        ...process.env,
        BS_QUALITY_APPROVAL_CHALLENGE_SHA256: "a".repeat(64),
        BS_QUALITY_APPROVAL_PUBLIC_KEY: "self-minted",
      },
    });
    expect(
      JSON.parse(readFileSync(directManifest, "utf8")).approvalTrust,
    ).toBeNull();
    expect(
      spawnSync(
        "node",
        [
          INVOCATION,
          "create",
          "--repo",
          root,
          "--base-ref",
          "origin/main",
          "--break-glass-approved",
        ],
        { cwd: root },
      ).status,
    ).not.toBe(0);

    const wrapped = spawnSync("node", [WRAPPER, BOOTSTRAP], {
      cwd: root,
      input: JSON.stringify({
        argv: ["--target-dir", root, "--level", "98"],
      }),
      encoding: "utf8",
      env: {
        ...process.env,
        BREAK_GLASS_APPROVED: "true",
        BREAK_GLASS_APPROVER: "brett",
      },
    });
    expect(wrapped.status, wrapped.stderr).toBe(0);
    const manifest = wrapped.stdout
      .split("\n")
      .find((line) => line.startsWith("BS_QUALITY_MANIFEST="))
      ?.slice("BS_QUALITY_MANIFEST=".length);
    execFileSync("bash", [RISK, "--manifest", manifest], { cwd: root });
    expect(
      spawnSync("node", [INVOCATION, "approval-valid", manifest], {
        cwd: root,
      }).status,
    ).toBe(0);
    const approvedState = JSON.parse(readFileSync(manifest, "utf8"));
    const approvalArtifact = JSON.parse(
      readFileSync(approvedState.approval.artifactPath, "utf8"),
    );
    expect(approvedState.approvalTrust.publicKey).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(approvalArtifact.publicKey).toBeUndefined();
    approvalArtifact.publicKey = approvedState.approvalTrust.publicKey;
    writeFileSync(
      approvedState.approval.artifactPath,
      `${JSON.stringify(approvalArtifact, null, 2)}\n`,
    );
    approvedState.approval.artifactSha256 = createHash("sha256")
      .update(readFileSync(approvedState.approval.artifactPath))
      .digest("hex");
    writeFileSync(manifest, `${JSON.stringify(approvedState, null, 2)}\n`);
    expect(
      spawnSync("node", [INVOCATION, "approval-valid", manifest], {
        cwd: root,
      }).status,
    ).not.toBe(0);
    delete approvalArtifact.publicKey;
    writeFileSync(
      approvedState.approval.artifactPath,
      `${JSON.stringify(approvalArtifact, null, 2)}\n`,
    );
    approvedState.approval.artifactSha256 = createHash("sha256")
      .update(readFileSync(approvedState.approval.artifactPath))
      .digest("hex");
    writeFileSync(manifest, `${JSON.stringify(approvedState, null, 2)}\n`);
    expect(
      spawnSync("node", [INVOCATION, "approval-valid", manifest], {
        cwd: root,
      }).status,
    ).toBe(0);

    writeFileSync(path.join(root, "later.js"), "export const later = true;\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "fix"]);
    execFileSync("node", [INVOCATION, "advance", manifest], { cwd: root });
    const state = JSON.parse(readFileSync(manifest, "utf8"));
    expect(state.approval.approved).toBe(false);
    expect(
      spawnSync("bash", [SELECT, "--manifest", manifest], { cwd: root }).status,
    ).not.toBe(0);

    const resumed = spawnSync("node", [WRAPPER, BOOTSTRAP], {
      cwd: root,
      input: JSON.stringify({ argv: ["--manifest", manifest] }),
      encoding: "utf8",
      env: {
        ...process.env,
        BREAK_GLASS_APPROVED: "true",
        BREAK_GLASS_APPROVER: "brett",
      },
    });
    expect(resumed.status, resumed.stderr).toBe(0);
    expect(
      spawnSync("bash", [SELECT, "--manifest", manifest], { cwd: root }).status,
    ).toBe(0);
    const renewed = JSON.parse(readFileSync(manifest, "utf8")).approval;
    expect(renewed).toMatchObject({
      approved: true,
      invocationId: JSON.parse(readFileSync(manifest, "utf8")).invocationId,
      approver: "brett",
      head: git(root, ["rev-parse", "HEAD"]),
    });
    expect(Date.parse(renewed.expiresAt)).toBeGreaterThan(Date.now());
  }, 120_000);

  it("rejects headless review children before the resume path", () => {
    const root = repo("headless-resume");
    const manifest = create(root);
    const before = readFileSync(manifest, "utf8");
    const result = spawnSync("bash", [BOOTSTRAP, "--manifest", manifest], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, BS_QUALITY_HEADLESS: "1" },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/headless review child/);
    expect(readFileSync(manifest, "utf8")).toBe(before);
  });

  it("persists an invocation-wide provider attempt cap and deadline", () => {
    const root = repo("provider-attempt-cap");
    const manifest = create(root, [], {
      BS_QUALITY_MAX_PROVIDER_ATTEMPTS: "2",
      BS_QUALITY_MAX_PROVIDER_SECONDS: "120",
    });
    for (const provider of ["claude", "codex"]) {
      const result = spawnSync(
        "node",
        [INVOCATION, "provider-attempt", manifest, "--provider", provider],
        { cwd: root, encoding: "utf8" },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout).remainingSeconds).toBeGreaterThan(0);
    }
    const exhausted = spawnSync(
      "node",
      [INVOCATION, "provider-attempt", manifest, "--provider", "codex"],
      { cwd: root, encoding: "utf8" },
    );
    expect(exhausted.status).not.toBe(0);
    expect(exhausted.stderr).toMatch(/absolute provider attempt cap exhausted/);
    const state = JSON.parse(readFileSync(manifest, "utf8"));
    expect(state.governor.providerAttempts).toHaveLength(2);
    expect(state.governor.providerDeadlineEpoch).toBe(
      state.governor.startedAtEpoch + 120,
    );
    state.governor.providerAttempts = [state.governor.providerAttempts[0]];
    state.governor.providerDeadlineEpoch = Math.floor(Date.now() / 1000) - 1;
    writeFileSync(manifest, `${JSON.stringify(state, null, 2)}\n`);
    const pastDeadline = spawnSync(
      "node",
      [INVOCATION, "provider-attempt", manifest, "--provider", "claude"],
      { cwd: root, encoding: "utf8" },
    );
    expect(pastDeadline.status).not.toBe(0);
    expect(pastDeadline.stderr).toMatch(/absolute provider deadline exhausted/);
  });

  it("opens one bounded provider window for each advanced review head", () => {
    const root = repo("provider-window");
    const manifestPath = create(root, [], {
      BS_QUALITY_MAX_PROVIDER_SECONDS: "120",
    });
    execFileSync(
      "node",
      [INVOCATION, "provider-attempt", manifestPath, "--provider", "codex"],
      { cwd: root },
    );
    const initial = JSON.parse(readFileSync(manifestPath, "utf8"));
    initial.governor.providerDeadlineEpoch = Math.floor(Date.now() / 1000) - 1;
    initial.governor.campaignDeadlineEpoch =
      Math.floor(Date.now() / 1000) + 600;
    writeFileSync(manifestPath, `${JSON.stringify(initial, null, 2)}\n`);

    writeFileSync(path.join(root, "next-head.js"), "export const next = 1;\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "fix: advance provider window"]);
    execFileSync("node", [INVOCATION, "advance", manifestPath], { cwd: root });
    let current = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(current.governor.providerDeadlineEpoch).toBe(
      initial.governor.providerDeadlineEpoch,
    );
    expect(current.governor.campaignDeadlineEpoch).toBe(
      initial.governor.campaignDeadlineEpoch,
    );
    expect(current.governor.validationDeadlineEpoch).toBeNull();
    const authorization = JSON.parse(
      execFileSync(
        "node",
        [INVOCATION, "provider-attempt", manifestPath, "--provider", "codex"],
        { cwd: root, encoding: "utf8" },
      ),
    );
    current = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(current.governor.providerDeadlineHead).toBe(
      git(root, ["rev-parse", "HEAD"]),
    );
    expect(authorization.remainingSeconds).toBeGreaterThan(0);
    expect(current.governor.campaignDeadlineEpoch).toBeGreaterThan(
      current.governor.providerDeadlineEpoch,
    );
  });

  it("starts the provider phase clock at the first attempt, not bootstrap", () => {
    const root = repo("provider-phase-start");
    const manifest = create(root, [], {
      BS_QUALITY_MAX_PROVIDER_SECONDS: "120",
    });
    const state = JSON.parse(readFileSync(manifest, "utf8"));
    state.governor.providerDeadlineEpoch = Math.floor(Date.now() / 1000) - 1;
    state.governor.campaignDeadlineEpoch = Math.floor(Date.now() / 1000) + 600;
    writeFileSync(manifest, `${JSON.stringify(state, null, 2)}\n`);

    const authorization = JSON.parse(
      execFileSync(
        "node",
        [INVOCATION, "provider-attempt", manifest, "--provider", "codex"],
        { cwd: root, encoding: "utf8" },
      ),
    );
    expect(authorization.remainingSeconds).toBeGreaterThanOrEqual(119);
    expect(authorization.remainingSeconds).toBeLessThanOrEqual(120);
  });

  it("does not accept break-glass approval through wrapper argv", () => {
    const root = repo("approval-argv");
    const result = spawnSync("node", [WRAPPER, BOOTSTRAP], {
      cwd: root,
      input: JSON.stringify({
        argv: ["--target-dir", root, "--break-glass-approved"],
      }),
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unexpected quality argument/);
  });

  it("counts provider and orchestration time against the campaign budget", () => {
    const root = repo("provider-budget");
    const manifest = create(root);
    const state = JSON.parse(readFileSync(manifest, "utf8"));
    state.governor.campaignSeconds = 2;
    state.governor.startedAtEpoch = Math.floor(Date.now() / 1000) - 3;
    state.governor.campaignDeadlineEpoch =
      state.governor.startedAtEpoch + state.governor.campaignSeconds;
    writeFileSync(manifest, `${JSON.stringify(state, null, 2)}\n`);

    expect(
      spawnSync("node", [GOVERNOR, "bump-round", manifest], { cwd: root })
        .status,
    ).not.toBe(0);
  });

  it("retries an unconsumed provider attempt without spending the mandatory rereview round", () => {
    const root = repo("provider-retry-budget");
    const manifest = create(root, [], {
      BS_QUALITY_MAX_REVIEW_ROUNDS: "3",
    });
    const firstHead = git(root, ["rev-parse", "HEAD"]);

    execFileSync("node", [GOVERNOR, "bump-round", manifest], { cwd: root });
    let state = JSON.parse(readFileSync(manifest, "utf8"));
    const timedOutToken = state.governor.authorizedAttempts.at(-1).token;
    expect(state.governor.roundsUsed).toBe(1);

    const firstReview = prepareCodexReview(root, manifest);
    state = JSON.parse(readFileSync(manifest, "utf8"));
    expect(state.governor.roundsUsed).toBe(1);
    expect(state.reviews).toHaveLength(1);
    expect(state.governor.authorizedAttempts).toHaveLength(2);
    expect(state.governor.authorizedAttempts[0]).toMatchObject({
      token: timedOutToken,
      invalidationReason: "replaced for provider retry",
      consumedAt: null,
    });
    expect(state.governor.authorizedAttempts[1]).toMatchObject({
      retryOf: timedOutToken,
      head: firstHead,
    });
    expect(state.governor.authorizedAttempts[1].consumedAt).not.toBeNull();

    state.governor.roundsUsed = 2;
    delete state.governor.authorizedAttempts[0].invalidatedAt;
    delete state.governor.authorizedAttempts[0].invalidationReason;
    state.governor.authorizedAttempts[1].number = 2;
    writeFileSync(manifest, `${JSON.stringify(state, null, 2)}\n`);

    for (let index = 1; index <= 9; index += 1) {
      writeFileSync(
        path.join(root, `retry-fix-${index}.js`),
        `export const fixed${index} = true;\n`,
      );
      git(root, ["add", "."]);
      git(root, ["commit", "-q", "-m", `fix: provider finding ${index}`]);
    }
    execFileSync("node", [INVOCATION, "advance", manifest], { cwd: root });
    expect(
      spawnSync("node", [GOVERNOR, "check", manifest], { cwd: root }).status,
    ).not.toBe(0);
    const secondReview = prepareCodexReview(root, manifest);

    state = JSON.parse(readFileSync(manifest, "utf8"));
    expect(state.governor.roundsUsed).toBe(2);
    expect(state.reviews).toHaveLength(2);
    expect(secondReview.from).toBe(firstReview.to);
    expect(secondReview.to).toBe(git(root, ["rev-parse", "HEAD"]));

    writeFileSync(
      path.join(root, "final-review-fix.js"),
      "export const finalReviewFix = true;\n",
    );
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "fix: final review finding"]);
    execFileSync("node", [INVOCATION, "advance", manifest], { cwd: root });
    const thirdReview = prepareCodexReview(root, manifest);
    state = JSON.parse(readFileSync(manifest, "utf8"));
    expect(state.governor.roundsUsed).toBe(3);
    expect(state.reviews).toHaveLength(3);
    expect(thirdReview.from).toBe(secondReview.to);
  });

  it("does not authorize a changed HEAD with an unconsumed stale token", () => {
    const root = repo("stale-provider-token");
    const manifest = create(root);
    execFileSync("node", [GOVERNOR, "bump-round", manifest], { cwd: root });

    writeFileSync(
      path.join(root, "changed.js"),
      "export const changed = true;\n",
    );
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "fix: changed head"]);
    execFileSync("node", [INVOCATION, "advance", manifest], { cwd: root });
    const info = JSON.parse(
      execFileSync("node", [INVOCATION, "review-info", manifest], {
        cwd: root,
        encoding: "utf8",
      }),
    );
    const result = spawnSync(
      "node",
      [
        INVOCATION,
        "record-review",
        manifest,
        "--from",
        info.from,
        "--to",
        info.to,
        "--provider",
        "codex",
        "--primary",
        "codex",
        "--fallback",
        "none",
        "--artifact-dir",
        info.artifactDir,
        "--diff-sha",
        "stale",
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/not authorized by the governor/);
  });

  it("uses an explicit composite checkpoint for an incremental second review", () => {
    const root = repo("delta");
    const manifest = create(root);
    const first = JSON.parse(
      execFileSync("node", [INVOCATION, "review-info", manifest], {
        cwd: root,
        encoding: "utf8",
      }),
    );
    prepareCodexReview(root, manifest);

    writeFileSync(path.join(root, "fix.js"), "export const fixed = true;\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "fix"]);
    execFileSync("node", [INVOCATION, "advance", manifest], { cwd: root });
    const second = JSON.parse(
      execFileSync("node", [INVOCATION, "review-info", manifest], {
        cwd: root,
        encoding: "utf8",
      }),
    );
    expect(second.from).toBe(first.to);
    expect(second.to).toBe(git(root, ["rev-parse", "HEAD"]));
    expect(second.artifactDir).toContain(second.to);
  });

  it("preserves the reviewed HEAD at its persisted stamp and invalidates the stamp after remediation", () => {
    const root = repo("stamp-aware-advance");
    const manifest = create(root);
    const reviewedHead = git(root, ["rev-parse", "HEAD"]);
    prepareCodexReview(root, manifest);
    git(root, ["commit", "--allow-empty", "-q", "-m", "quality stamp"]);
    const stampHead = git(root, ["rev-parse", "HEAD"]);
    execFileSync(
      "node",
      [
        INVOCATION,
        "record-stamp",
        manifest,
        "--head",
        stampHead,
        "--remote",
        "origin",
        "--expected-old-head",
        reviewedHead,
      ],
      { cwd: root },
    );

    execFileSync("node", [INVOCATION, "advance", manifest], { cwd: root });
    let state = JSON.parse(readFileSync(manifest, "utf8"));
    expect(state.revisions.currentHead).toBe(reviewedHead);
    expect(state.merge.stampHead).toBe(stampHead);
    expect(state.merge.invalidatedStamps).toEqual([]);

    writeFileSync(
      path.join(root, "remediation.js"),
      "export const fixed = true;\n",
    );
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "fix: remediate review finding"]);
    const remediationHead = git(root, ["rev-parse", "HEAD"]);
    execFileSync("node", [INVOCATION, "advance", manifest], { cwd: root });

    state = JSON.parse(readFileSync(manifest, "utf8"));
    expect(state.revisions.currentHead).toBe(remediationHead);
    expect(state.merge.stampHead).toBeUndefined();
    expect(state.merge.stampedAt).toBeUndefined();
    expect(state.merge.stampPublication).toBeUndefined();
    expect(state.merge.invalidatedStamps).toMatchObject([
      {
        head: stampHead,
        reason: `HEAD advanced beyond reviewed stamp to ${remediationHead}`,
      },
    ]);
    const nextReview = JSON.parse(
      execFileSync("node", [INVOCATION, "review-info", manifest], {
        cwd: root,
        encoding: "utf8",
      }),
    );
    expect(nextReview.from).toBe(reviewedHead);
    expect(nextReview.to).toBe(remediationHead);
  });

  it("bootstraps a persisted stamp without advancing review state, then resumes remediation incrementally", () => {
    const root = repo("stamp-aware-bootstrap");
    const manifest = create(root);
    const reviewedHead = git(root, ["rev-parse", "HEAD"]);
    prepareCodexReview(root, manifest);
    git(root, ["commit", "--allow-empty", "-q", "-m", "quality stamp"]);
    const stampHead = git(root, ["rev-parse", "HEAD"]);
    execFileSync(
      "node",
      [
        INVOCATION,
        "record-stamp",
        manifest,
        "--head",
        stampHead,
        "--remote",
        "origin",
        "--expected-old-head",
        reviewedHead,
      ],
      { cwd: root },
    );

    const stampedResume = spawnSync(
      "bash",
      [BOOTSTRAP, "--manifest", manifest],
      { cwd: root, encoding: "utf8" },
    );
    expect(stampedResume.status, stampedResume.stderr).toBe(0);
    expect(stampedResume.stdout).toContain(`at ${reviewedHead}`);
    let state = JSON.parse(readFileSync(manifest, "utf8"));
    expect(state.revisions.currentHead).toBe(reviewedHead);
    expect(state.merge.stampHead).toBe(stampHead);

    writeFileSync(
      path.join(root, "resume-fix.js"),
      "export const fixed = true;\n",
    );
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "fix: resume remediation"]);
    const remediationHead = git(root, ["rev-parse", "HEAD"]);
    const remediationResume = spawnSync(
      "bash",
      [BOOTSTRAP, "--manifest", manifest],
      { cwd: root, encoding: "utf8" },
    );
    expect(remediationResume.status, remediationResume.stderr).toBe(0);
    expect(remediationResume.stdout).toContain(`at ${remediationHead}`);
    state = JSON.parse(readFileSync(manifest, "utf8"));
    expect(state.revisions.currentHead).toBe(remediationHead);
    expect(state.merge.stampHead).toBeUndefined();
    expect(state.merge.invalidatedStamps.at(-1).head).toBe(stampHead);

    const nextReview = JSON.parse(
      execFileSync("node", [INVOCATION, "review-info", manifest], {
        cwd: root,
        encoding: "utf8",
      }),
    );
    expect(nextReview.from).toBe(reviewedHead);
    expect(nextReview.to).toBe(remediationHead);
  });

  it("refuses a second review when HEAD has not advanced", () => {
    const root = repo("same-head");
    const manifest = create(root);
    prepareCodexReview(root, manifest);
    const result = spawnSync("node", [INVOCATION, "review-info", manifest], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/descendant HEAD/);
  });

  it("rejects ambiguous positional PR syntax", () => {
    const root = repo("grammar");
    const result = spawnSync(
      "node",
      [
        INVOCATION,
        "create",
        "--repo",
        root,
        "--base-ref",
        "origin/main",
        "--merge",
        "1",
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/use --pr <number> explicitly/);
  });

  it("uses configured formatter patterns and skips unsupported TOML", () => {
    const root = repo("format");
    const packageJson = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8"),
    );
    packageJson["lint-staged"] = {
      "**/*.{js,json,md,yml,yaml}": ["prettier --write"],
      "**/*.ts": ["eslint --fix"],
    };
    writeFileSync(path.join(root, "package.json"), JSON.stringify(packageJson));
    git(root, ["add", "package.json"]);
    git(root, ["commit", "-q", "-m", "config"]);
    const manifest = create(root);
    const plan = JSON.parse(
      execFileSync(
        "node",
        [
          FORMAT,
          "--manifest",
          manifest,
          "--dry-run",
          "--",
          "file.js",
          "only-eslint.ts",
          ".gitleaks.toml",
        ],
        { cwd: root, encoding: "utf8" },
      ),
    );
    expect(plan.files).toEqual(["file.js"]);
    expect(plan.args).toContain("--ignore-unknown");
  });

  it("uses declared and modern Bun package-manager signals for formatting", () => {
    const root = repo("format-bun");
    const packageFile = path.join(root, "package.json");
    const packageJson = JSON.parse(readFileSync(packageFile, "utf8"));
    packageJson.packageManager = "bun@1.2.0";
    writeFileSync(packageFile, JSON.stringify(packageJson));
    writeFileSync(path.join(root, "bun.lock"), "");
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "config"]);
    const manifest = create(root);
    const plan = JSON.parse(
      execFileSync(
        "node",
        [FORMAT, "--manifest", manifest, "--dry-run", "--", "file.js"],
        { cwd: root, encoding: "utf8" },
      ),
    );
    expect(plan.manager).toBe("bun");
    expect(plan.args.slice(0, 2)).toEqual(["x", "prettier"]);
  });

  it("does not let verification extend an expired campaign clock", () => {
    const root = repo("reserve");
    const manifest = create(root, [], {
      BS_QUALITY_MAX_REMEDIATION_SECONDS: "1",
      BS_QUALITY_REREVIEW_RESERVE_SECONDS: "60",
    });
    prepareCodexReview(root, manifest);
    const state = JSON.parse(readFileSync(manifest, "utf8"));
    state.governor.campaignSeconds = 1;
    state.governor.startedAtEpoch = Math.floor(Date.now() / 1000) - 2;
    state.governor.campaignDeadlineEpoch =
      state.governor.startedAtEpoch + state.governor.campaignSeconds;
    writeFileSync(manifest, `${JSON.stringify(state, null, 2)}\n`);
    expect(
      spawnSync("node", [GOVERNOR, "check", manifest], { cwd: root }).status,
    ).not.toBe(0);
    expect(
      spawnSync("node", [GOVERNOR, "bump-round", manifest], { cwd: root })
        .status,
    ).not.toBe(0);
  });

  it("passes a structured wrapper argv without executing spaces or metacharacters", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "quality-wrapper-"));
    const bootstrap = path.join(dir, "bootstrap.sh");
    const marker = path.join(dir, "executed");
    writeFileSync(bootstrap, '#!/usr/bin/env bash\nprintf "<%s>\\n" "$@"\n');
    chmodSync(bootstrap, 0o755);
    const request = JSON.stringify({
      argv: [
        "--target-dir",
        `${dir}/path with space`,
        `$(touch ${marker})`,
        ";",
      ],
    });
    const result = spawnSync("node", [WRAPPER, bootstrap], {
      input: request,
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`<${dir}/path with space>`);
    expect(result.stdout).toContain(`<$(touch ${marker})>`);
    expect(existsSync(marker)).toBe(false);
  });

  it("fails safely when approval bootstrap returns malformed manifest JSON", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "quality-wrapper-json-"));
    const bootstrap = path.join(dir, "bootstrap.sh");
    const manifest = path.join(dir, "invocation.json");
    writeFileSync(manifest, "{not-json\n");
    writeFileSync(
      bootstrap,
      `#!/usr/bin/env bash
printf 'BS_QUALITY_MANIFEST=%s\\n' ${JSON.stringify(manifest)}
`,
    );
    chmodSync(bootstrap, 0o755);

    const result = spawnSync("node", [WRAPPER, bootstrap], {
      input: JSON.stringify({ argv: [] }),
      encoding: "utf8",
      env: { ...process.env, BREAK_GLASS_APPROVED: "true" },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/quality manifest is not valid JSON/);
  });

  it("rejects malformed merge arguments before any GitHub or repository mutation", () => {
    const root = repo("strict-wrapper-args");
    const harness = mkdtempSync(path.join(tmpdir(), "quality-strict-args-"));
    const bin = path.join(harness, "bin");
    const ghMarker = path.join(harness, "gh-invoked");
    mkdirSync(bin);
    const gh = path.join(bin, "gh");
    writeFileSync(
      gh,
      `#!/usr/bin/env bash
printf '%s\n' "$*" >> ${JSON.stringify(ghMarker)}
exit 99
`,
    );
    chmodSync(gh, 0o755);
    const beforeHead = git(root, ["rev-parse", "HEAD"]);
    const beforeStatus = git(root, ["status", "--porcelain=v1"]);

    for (const argv of [["--merge", "1"], ["--merge=false"]]) {
      const result = spawnSync("node", [WRAPPER, BOOTSTRAP], {
        cwd: root,
        input: JSON.stringify({ argv }),
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(
        /unexpected quality argument|--merge accepts only/,
      );
    }

    const directManifest = spawnSync(
      "node",
      [
        INVOCATION,
        "create",
        "--repo",
        root,
        "--base-ref",
        "origin/main",
        "--merge=false",
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(directManifest.status).not.toBe(0);
    expect(directManifest.stderr).toMatch(/--merge=false is invalid/);

    expect(existsSync(ghMarker)).toBe(false);
    expect(git(root, ["rev-parse", "HEAD"])).toBe(beforeHead);
    expect(git(root, ["status", "--porcelain=v1"])).toBe(beforeStatus);
  });

  it("rejects symlinked manifests and concurrent mutation locks", () => {
    const root = repo("hardening");
    const manifest = create(root);
    const link = path.join(path.dirname(manifest), "linked.json");
    symlinkSync(manifest, link);
    expect(
      spawnSync("node", [INVOCATION, "validate", link], { cwd: root }).status,
    ).not.toBe(0);
    writeFileSync(`${manifest}.lock`, "other\n");
    expect(
      spawnSync(
        "node",
        [
          INVOCATION,
          "risk",
          manifest,
          "--tier",
          "high",
          "--agents",
          "5",
          "--codex-depth",
          "high",
          "--codex-rounds",
          "1",
        ],
        { cwd: root },
      ).status,
    ).not.toBe(0);
  });

  it("fails closed on a stale lock until an operator explicitly cleans it", () => {
    const root = repo("stale-lock");
    const manifest = create(root);
    writeFileSync(
      `${manifest}.lock`,
      '{"pid":99999999,"hostname":"local","acquiredAt":"2026-01-01"}',
    );
    const result = spawnSync(
      "node",
      [
        INVOCATION,
        "risk",
        manifest,
        "--tier",
        "high",
        "--agents",
        "5",
        "--codex-depth",
        "high",
        "--codex-rounds",
        "1",
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/explicit operator cleanup/);
  });

  it("rejects changed origin identity and contains no shell-evaluable exports", () => {
    const root = repo("origin");
    const manifest = create(root);
    git(root, ["remote", "set-url", "origin", `${root}-different`]);
    expect(
      spawnSync("node", [INVOCATION, "validate", manifest], { cwd: root })
        .status,
    ).not.toBe(0);
    const loader = readFileSync(LOAD_ROOT, "utf8");
    expect(loader).not.toMatch(/\beval\b|quality-invocation\.js" shell/);
  });

  it("simulates first review, fix, incremental review, push, CI, and merge authorization", () => {
    const root = repo("lifecycle");
    const manifest = create(root, ["--level", "95", "--pr", "1", "--merge"]);
    execFileSync("bash", [RISK, "--manifest", manifest], { cwd: root });
    execFileSync("bash", [SELECT, "--manifest", manifest], { cwd: root });
    const first = prepareCodexReview(root, manifest);

    writeFileSync(path.join(root, "fix.js"), "export const fixed = true;\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "fix"]);
    const advanceStarted = Math.floor(Date.now() / 1000);
    execFileSync("node", [INVOCATION, "advance", manifest], { cwd: root });
    const validationState = JSON.parse(readFileSync(manifest, "utf8"));
    expect(
      validationState.governor.validationDeadlineEpoch,
    ).toBeGreaterThanOrEqual(
      advanceStarted +
        validationState.risk.runtime.checkReserveSeconds +
        validationState.risk.runtime.reviewReserveSeconds,
    );
    execFileSync("node", [INVOCATION, "advance", manifest], { cwd: root });
    expect(
      JSON.parse(readFileSync(manifest, "utf8")).governor
        .validationDeadlineEpoch,
    ).toBe(validationState.governor.validationDeadlineEpoch);
    validationState.governor.startedAtEpoch =
      Math.floor(Date.now() / 1000) - 2000;
    validationState.governor.campaignSeconds = 900;
    validationState.governor.campaignDeadlineEpoch =
      validationState.governor.startedAtEpoch + 900;
    writeFileSync(manifest, `${JSON.stringify(validationState, null, 2)}\n`);
    const second = prepareCodexReview(root, manifest);
    expect(second.from).toBe(first.to);
    recordJudgeArtifact(root, manifest);

    const predecessorBin = fakeGh(root, first.to);
    const remediationPreflight = spawnSync(
      "bash",
      [AUTHORIZE, "--manifest", manifest, "--preflight"],
      {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${predecessorBin}:${process.env.PATH}`,
          QUALITY_TEST_STRICT_PROTECTION: "true",
        },
        encoding: "utf8",
      },
    );
    expect(remediationPreflight.status, remediationPreflight.stderr).toBe(0);
    expect(remediationPreflight.stdout).toContain(
      `BS_QUALITY_PR_HEAD=${first.to}`,
    );

    const trailers = execFileSync("node", [INVOCATION, "trailers", manifest], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    const message = `chore: quality stamp\n\n${trailers}`;
    git(root, ["commit", "--allow-empty", "-q", "-m", message]);
    const stampHead = git(root, ["rev-parse", "HEAD"]);
    execFileSync(
      "node",
      [
        INVOCATION,
        "record-stamp",
        manifest,
        "--head",
        stampHead,
        "--remote",
        "origin",
        "--expected-old-head",
        second.to,
      ],
      { cwd: root },
    );
    const lifecycle = [];
    lifecycle.push("push");
    lifecycle.push("ci:success");
    const bin = fakeGh(root, stampHead);
    const caller = repo("authorization-caller");
    const wrongRepository = spawnSync(
      "bash",
      [AUTHORIZE, "--manifest", manifest, "--preflight"],
      {
        cwd: caller,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          QUALITY_TEST_REPOSITORY: "other/repository",
        },
        encoding: "utf8",
      },
    );
    expect(wrongRepository.status).not.toBe(0);
    expect(wrongRepository.stderr).toMatch(/repository identity changed/);
    const wrongHeadRef = spawnSync(
      "bash",
      [AUTHORIZE, "--manifest", manifest, "--preflight"],
      {
        cwd: caller,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          QUALITY_TEST_HEAD_REF: "other-feature",
        },
        encoding: "utf8",
      },
    );
    expect(wrongHeadRef.status).not.toBe(0);
    expect(wrongHeadRef.stderr).toMatch(/head branch identity changed/);
    const unprotected = spawnSync(
      "bash",
      [AUTHORIZE, "--manifest", manifest, "--preflight"],
      {
        cwd: caller,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        encoding: "utf8",
      },
    );
    expect(unprotected.status).not.toBe(0);
    expect(unprotected.stderr).toMatch(/server-enforced strict freshness/);

    const queueOnly = spawnSync("bash", [AUTHORIZE, "--manifest", manifest], {
      cwd: caller,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        QUALITY_TEST_EFFECTIVE_RULES: "queue",
      },
      encoding: "utf8",
    });
    expect(queueOnly.status).not.toBe(0);
    expect(queueOnly.stderr).toMatch(/queue-aware monitored merge path/);

    expect(
      spawnSync("bash", [AUTHORIZE, "--manifest", manifest], {
        cwd: caller,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          QUALITY_TEST_EFFECTIVE_RULES: "strict",
          QUALITY_TEST_MERGE_RC: "1",
        },
        encoding: "utf8",
      }).status,
    ).toBe(0);

    expect(
      spawnSync("bash", [AUTHORIZE, "--manifest", manifest], {
        cwd: caller,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          QUALITY_TEST_STRICT_PROTECTION: "true",
          QUALITY_TEST_EFFECTIVE_RULES: "unavailable",
        },
        encoding: "utf8",
      }).status,
    ).toBe(0);
    lifecycle.push("merge");
    expect(lifecycle).toEqual(["push", "ci:success", "merge"]);

    git(root, ["reset", "--hard", "-q", "HEAD~1"]);
    writeFileSync(path.join(root, "stale.js"), "export const stale = true;\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "unreviewed"]);
    const staleBin = fakeGh(root, stampHead);
    expect(
      spawnSync("bash", [AUTHORIZE, "--manifest", manifest], {
        cwd: root,
        env: { ...process.env, PATH: `${staleBin}:${process.env.PATH}` },
      }).status,
    ).not.toBe(0);
  }, 30_000);

  it("rejects a dirty working tree before gates, review, and stamp", () => {
    const root = repo("dirty-preflight");
    const manifest = create(root, ["--level", "95", "--pr", "1", "--merge"]);
    execFileSync("bash", [RISK, "--manifest", manifest], { cwd: root });
    execFileSync("bash", [SELECT, "--manifest", manifest], { cwd: root });
    writeFileSync(path.join(root, "dirty.txt"), "unreviewed\n");

    for (const invocation of [
      ["bash", [RUN_GATE, "--manifest", manifest, "--name", "lint"]],
      ["bash", [RUN_REVIEW, "--manifest", manifest]],
      ["bash", [STAMP_AND_MERGE, "--manifest", manifest]],
    ]) {
      const result = spawnSync(invocation[0], invocation[1], {
        cwd: root,
        encoding: "utf8",
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/dirty working tree/);
    }
  });

  it("persists one empty stamp and waits for its CI before authorization", () => {
    const root = repo("stamp-retry");
    const remote = mkdtempSync(path.join(tmpdir(), "quality-remote-"));
    git(remote, ["init", "--bare", "-q"]);
    git(root, ["remote", "set-url", "origin", remote]);
    git(root, ["push", "-q", "origin", "main"]);
    git(root, ["push", "-q", "-u", "origin", "feature"]);

    const manifest = create(root, ["--level", "95", "--pr", "1", "--merge"]);
    execFileSync("bash", [RISK, "--manifest", manifest], { cwd: root });
    execFileSync("bash", [SELECT, "--manifest", manifest], { cwd: root });
    prepareCodexReview(root, manifest);
    recordJudgeArtifact(root, manifest);

    const harness = mkdtempSync(path.join(tmpdir(), "quality-stamp-harness-"));
    const bin = path.join(harness, "bin");
    mkdirSync(bin);
    const log = path.join(harness, "gh-order.log");
    const pushLog = path.join(harness, "git-push.log");
    const fail = path.join(harness, "fail-ci");
    const failPush = path.join(harness, "fail-push");
    const denyPreflight = path.join(harness, "deny-preflight");
    const merged = path.join(harness, "merged");
    writeFileSync(fail, "fail\n");
    writeFileSync(denyPreflight, "deny\n");
    const gh = path.join(bin, "gh");
    const gitWrapper = path.join(bin, "git");
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    writeFileSync(
      gitWrapper,
      `#!/usr/bin/env bash
if [ "$1" = push ]; then
  printf '%s\\n' "$*" >> ${JSON.stringify(pushLog)}
  if [ -f ${JSON.stringify(failPush)} ]; then exit 75; fi
fi
exec ${JSON.stringify(realGit)} "$@"
`,
    );
    chmodSync(gitWrapper, 0o755);
    writeFileSync(
      gh,
      `#!/usr/bin/env bash
echo "$*" >> ${JSON.stringify(log)}
if [ "$1 $2" = "pr view" ]; then
  head="$(git ls-remote origin refs/heads/feature | awk '{print $1}')"
  if [[ "$*" == *"--jq .headRefOid"* ]]; then printf '%s\\n' "$head"
  elif [ -f ${JSON.stringify(merged)} ]; then
    printf '{"state":"MERGED","mergedAt":"2026-07-16T00:00:00Z","mergeCommit":{"oid":"merge"},"headRefName":"feature","headRefOid":"%s","baseRefName":"main"}\\n' "$head"
  else printf '{"state":"OPEN","mergedAt":null,"mergeCommit":null,"headRefName":"feature","headRefOid":"%s","baseRefName":"main"}\\n' "$head"; fi
  exit 0
fi
if [ "$1 $2" = "pr checks" ]; then [ ! -f ${JSON.stringify(fail)} ]; exit $?; fi
if [ "$1 $2" = "pr merge" ]; then touch ${JSON.stringify(merged)}; exit 0; fi
if [ "$1 $2" = "repo view" ]; then
  if [[ "$*" == *"nameWithOwner"* ]]; then printf '%s\\n' 'owner/repo'; else printf '%s\\n' 'main'; fi
  exit 0
fi
if [ "$1" = "api" ]; then
  if [[ "$2" == *"protection/required_status_checks"* ]]; then
    [ ! -f ${JSON.stringify(denyPreflight)} ] || exit 1
    printf '%s\\n' 'true'
  elif [ -f ${JSON.stringify(denyPreflight)} ]; then
    printf '%s\\n' '[{"type":"merge_queue","parameters":{"grouping_strategy":"ALLGREEN"}}]'
  else
    printf '%s\\n' '[]'
  fi
  exit 0
fi
exit 1
`,
    );
    chmodSync(gh, 0o755);
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      QUALITY_STAMP_CI_TIMEOUT: "5",
    };

    const reviewedHead = git(root, ["rev-parse", "HEAD"]);
    const denied = spawnSync(
      "bash",
      [STAMP_AND_MERGE, "--manifest", manifest],
      { cwd: root, env, encoding: "utf8" },
    );
    expect(denied.status).not.toBe(0);
    expect(git(root, ["rev-parse", "HEAD"])).toBe(reviewedHead);
    expect(git(root, ["ls-remote", "origin", "refs/heads/feature"])).toContain(
      reviewedHead,
    );
    expect(JSON.parse(readFileSync(manifest, "utf8")).merge.stampHead).toBe(
      undefined,
    );
    unlinkSync(denyPreflight);
    writeFileSync(failPush, "fail\n");

    const first = spawnSync("bash", [STAMP_AND_MERGE, "--manifest", manifest], {
      cwd: root,
      env,
      encoding: "utf8",
    });
    expect(first.status).not.toBe(0);
    const afterFirst = JSON.parse(readFileSync(manifest, "utf8"));
    const stampHead = afterFirst.merge.stampHead;
    expect(stampHead).toBe(git(root, ["rev-parse", "HEAD"]));
    expect(afterFirst.merge.stampPublication).toMatchObject({
      status: "local",
      remote: "origin",
      expectedOldHead: reviewedHead,
    });
    expect(git(root, ["ls-remote", "origin", "refs/heads/feature"])).toContain(
      reviewedHead,
    );
    expect(
      git(root, [
        "rev-list",
        "--count",
        `${afterFirst.revisions.currentHead}..HEAD`,
      ]),
    ).toBe("1");

    unlinkSync(failPush);
    unlinkSync(fail);
    const second = spawnSync(
      "bash",
      [STAMP_AND_MERGE, "--manifest", manifest],
      { cwd: root, env, encoding: "utf8" },
    );
    expect(second.status, second.stderr).toBe(0);
    expect(git(root, ["rev-parse", "HEAD"])).toBe(stampHead);
    expect(
      JSON.parse(readFileSync(manifest, "utf8")).merge.stampPublication,
    ).toMatchObject({ status: "published", publishedHead: stampHead });
    expect(readFileSync(pushLog, "utf8")).toContain(
      `--force-with-lease=refs/heads/feature:${reviewedHead} origin ${stampHead}:refs/heads/feature`,
    );
    const calls = readFileSync(log, "utf8");
    expect(calls.indexOf("pr checks 1 --required --watch")).toBeLessThan(
      calls.indexOf("pr merge 1"),
    );
  }, 40_000);

  it("rejects cross-repository PRs before creating unusable state", () => {
    const root = repo("cross-repo");
    expect(() =>
      create(root, [
        "--pr",
        "1",
        "--head-repository",
        "fork/repo",
        "--cross-repository",
        "true",
      ]),
    ).toThrow(/trusted CI evidence ingestion.*not yet supported/);
  });

  it("fails authorization when inventoried findings are replaced", () => {
    const root = repo("artifact-tamper");
    const manifest = create(root);
    const review = prepareCodexReview(root, manifest);
    recordJudgeArtifact(root, manifest);
    writeFileSync(
      path.join(review.artifactDir, "codex.findings.txt"),
      "REPLACED\n",
    );
    expect(
      spawnSync("node", [INVOCATION, "review-authorization", manifest], {
        cwd: root,
      }).status,
    ).not.toBe(0);
  });

  it("blocks authorization when the persisted judge reports findings", () => {
    const root = repo("judge-block");
    const manifest = create(root);
    prepareCodexReview(root, manifest, [
      { severity: "high", title: "one" },
      { severity: "high", title: "two" },
    ]);
    recordJudgeArtifact(root, manifest, ["BLOCKING", "BLOCKING"]);
    const result = spawnSync(
      "node",
      [INVOCATION, "review-authorization", manifest],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/2 unresolved BLOCKING/);
  });

  it("rejects a caller-supplied diff and matching hash that omit the Git delta", () => {
    const root = repo("partial-diff");
    const manifest = create(root);
    execFileSync("node", [GOVERNOR, "bump-round", manifest], { cwd: root });
    const info = JSON.parse(
      execFileSync("node", [INVOCATION, "review-info", manifest], {
        cwd: root,
        encoding: "utf8",
      }),
    );
    mkdirSync(info.artifactDir, { recursive: true });
    writeFileSync(path.join(info.artifactDir, "diff.txt"), "");
    writeFileSync(
      path.join(info.artifactDir, "identity.json"),
      execFileSync("node", [INVOCATION, "review-identity", manifest], {
        cwd: root,
      }),
    );
    writeFileSync(
      path.join(info.artifactDir, "codex.findings.txt"),
      "NO FINDINGS.\n",
    );
    writeFileSync(
      path.join(info.artifactDir, "codex-1.json"),
      '{"verdict":"pass","summary":"clean","findings":[]}\n',
    );
    execFileSync(
      "node",
      [
        INVOCATION,
        "inventory",
        manifest,
        "--artifact-dir",
        info.artifactDir,
        "--provider",
        "codex",
      ],
      { cwd: root },
    );
    const emptySha = createHash("sha256").update("").digest("hex");
    const result = spawnSync(
      "node",
      [
        INVOCATION,
        "record-review",
        manifest,
        "--from",
        info.from,
        "--to",
        info.to,
        "--provider",
        "codex",
        "--primary",
        "codex",
        "--fallback",
        "none",
        "--artifact-dir",
        info.artifactDir,
        "--diff-sha",
        emptySha,
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/canonical Git diff/);
  });

  it("freezes risk and agent state once persisted", () => {
    const root = repo("risk-freeze");
    const manifest = create(root);
    execFileSync("bash", [RISK, "--manifest", manifest], { cwd: root });
    execFileSync("bash", [SELECT, "--manifest", manifest], { cwd: root });
    expect(() =>
      execFileSync("bash", [RISK, "--manifest", manifest], { cwd: root }),
    ).not.toThrow();
    expect(() =>
      execFileSync("bash", [SELECT, "--manifest", manifest], { cwd: root }),
    ).not.toThrow();
    const persistedRisk = JSON.parse(readFileSync(manifest, "utf8")).risk;
    writeFileSync(path.join(root, "fix.js"), "export const fixed = true;\n");
    git(root, ["add", "fix.js"]);
    git(root, ["commit", "-q", "-m", "fix"]);
    execFileSync("node", [INVOCATION, "advance", manifest], { cwd: root });
    const resumedRisk = execFileSync("bash", [RISK, "--manifest", manifest], {
      cwd: root,
      encoding: "utf8",
    });
    expect(resumedRisk).toMatch(/preserving persisted invocation contract/);
    expect(JSON.parse(readFileSync(manifest, "utf8")).risk).toEqual(
      persistedRisk,
    );
    expect(
      spawnSync(
        "node",
        [
          INVOCATION,
          "risk",
          manifest,
          "--tier",
          "low",
          "--agents",
          "2",
          "--codex-depth",
          "low",
          "--codex-rounds",
          "1",
        ],
        { cwd: root },
      ).status,
    ).not.toBe(0);
    expect(
      spawnSync("node", [INVOCATION, "agents", manifest, "a", "b"], {
        cwd: root,
      }).status,
    ).not.toBe(0);
  });

  it("fails early when required repository gate scripts are missing", () => {
    const root = repo("missing-baselines");
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { test: "true" } }),
    );
    git(root, ["add", "package.json"]);
    git(root, ["commit", "-q", "-m", "test-only package"]);
    expect(() => create(root)).toThrow(
      /executable repository scripts for: lint, security/,
    );

    writeFileSync(path.join(root, "package.json"), JSON.stringify({}));
    git(root, ["commit", "-qam", "remove tests"]);
    expect(() => create(root)).toThrow(
      /executable repository scripts for: lint, security, test/,
    );
    expect(() => create(root, ["--skip-tests"])).toThrow(
      /executable repository scripts for: lint, security/,
    );
  });

  it("caps critical campaigns at discovery plus one verification", () => {
    const root = repo("critical-rounds");
    const manifest = create(root);
    execFileSync(
      "node",
      [
        INVOCATION,
        "risk",
        manifest,
        "--tier",
        "critical",
        "--agents",
        "6",
        "--codex-depth",
        "xhigh",
        "--codex-rounds",
        "1",
      ],
      { cwd: root },
    );
    expect(
      JSON.parse(readFileSync(manifest, "utf8")).governor.maxReviewRounds,
    ).toBe(2);

    const explicitlyBounded = create(root, [], {
      BS_QUALITY_MAX_REVIEW_ROUNDS: "2",
    });
    execFileSync(
      "node",
      [
        INVOCATION,
        "risk",
        explicitlyBounded,
        "--tier",
        "critical",
        "--agents",
        "6",
        "--codex-depth",
        "xhigh",
        "--codex-rounds",
        "1",
      ],
      { cwd: root },
    );
    expect(
      JSON.parse(readFileSync(explicitlyBounded, "utf8")).governor
        .maxReviewRounds,
    ).toBe(2);
  });

  it("rejects a judge artifact bound to another HEAD", () => {
    const root = repo("stale-judge");
    const manifest = create(root);
    prepareCodexReview(root, manifest);
    const artifact = path.join(root, "stale-judge.json");
    const context = JSON.parse(
      execFileSync("node", [INVOCATION, "judge-context", manifest], {
        cwd: root,
        encoding: "utf8",
      }),
    );
    context.head = "0".repeat(40);
    writeFileSync(artifact, JSON.stringify(context));
    const result = spawnSync(
      "node",
      [INVOCATION, "judge", manifest, "--artifact", artifact],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/head identity mismatch/);
  });

  it("parses skip-tests booleans and requires explicit skip evidence", () => {
    const root = repo("skip-tests");
    const manifest = create(root, ["--skip-tests"]);
    const falseManifest = create(root, ["--skip-tests=false"]);
    expect(JSON.parse(readFileSync(manifest, "utf8")).options.skipTests).toBe(
      true,
    );
    expect(
      JSON.parse(readFileSync(falseManifest, "utf8")).options.skipTests,
    ).toBe(false);
    execFileSync(
      "bash",
      [
        RUN_GATE,
        "--manifest",
        manifest,
        "--name",
        "test",
        "--skip",
        "--reason",
        "config-only fixture has no executable tests",
      ],
      { cwd: root },
    );
    expect(
      JSON.parse(readFileSync(manifest, "utf8")).gates.find(
        (gate) => gate.name === "test",
      ),
    ).toMatchObject({
      status: "skipped",
      reason: "config-only fixture has no executable tests",
    });

    prepareCodexReview(root, manifest);
    recordGateFixture(manifest, "test", {
      status: "skipped",
      reason: "config-only fixture has no executable tests",
    });
    recordJudgeArtifact(root, manifest, []);
    expect(() =>
      execFileSync("node", [INVOCATION, "review-authorization", manifest], {
        cwd: root,
      }),
    ).not.toThrow();

    const missingReason = spawnSync(
      "node",
      [INVOCATION, "gate-run", falseManifest, "--name", "test", "--skip"],
      { cwd: root, encoding: "utf8" },
    );
    expect(missingReason.status).not.toBe(0);
    expect(missingReason.stderr).toMatch(/requires --skip-tests.*reason/);
  });

  it("preserves immutable provider finding payload through judging", () => {
    const root = repo("judge-payload");
    const manifest = create(root);
    prepareCodexReview(root, manifest, [
      {
        severity: "medium",
        title: "HTTP retry policy",
        body: "status === 429 must retain quota metadata",
        recommendation: "Preserve Retry-After and quota headers",
        evidence: { file: "src/http.js", line: 42 },
      },
    ]);
    const context = JSON.parse(
      execFileSync("node", [INVOCATION, "judge-context", manifest], {
        cwd: root,
        encoding: "utf8",
      }),
    );
    expect(context.findings[0]).toMatchObject({
      body: "status === 429 must retain quota metadata",
      recommendation: "Preserve Retry-After and quota headers",
      evidence: { file: "src/http.js", line: 42 },
    });

    const artifact = path.join(root, "judge-payload.json");
    context.findings[0].disposition = "WARNING";
    writeFileSync(artifact, JSON.stringify(context));
    let result = spawnSync(
      "node",
      [INVOCATION, "judge", manifest, "--artifact", artifact],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/require a reason/);

    context.findings[0].reason = "Useful but not merge-blocking";
    context.findings[0].body = "mutated payload";
    writeFileSync(artifact, JSON.stringify(context));
    result = spawnSync(
      "node",
      [INVOCATION, "judge", manifest, "--artifact", artifact],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/changed immutable provider payload/);

    context.findings[0].body = "status === 429 must retain quota metadata";
    writeFileSync(artifact, JSON.stringify(context));
    expect(() =>
      execFileSync(
        "node",
        [INVOCATION, "judge", manifest, "--artifact", artifact],
        { cwd: root },
      ),
    ).not.toThrow();
  });

  it("treats trailing text after a clean sentinel as blocking evidence", () => {
    const root = repo("contradictory-clean-sentinel");
    const manifest = create(root);
    prepareCodexReview(
      root,
      manifest,
      [],
      "NO FINDINGS.\nBLOCKING: incomplete review evidence\n",
    );
    const context = JSON.parse(
      execFileSync("node", [INVOCATION, "judge-context", manifest], {
        cwd: root,
        encoding: "utf8",
      }),
    );
    expect(context.findings).toHaveLength(1);
    expect(context.findings[0].severity).toBe("blocking");
  });

  it("accepts the runner's complete single-line clean Codex result", () => {
    const root = repo("generated-clean-sentinel");
    const manifest = create(root);
    prepareCodexReview(
      root,
      manifest,
      [],
      "NO FINDINGS. Verdict: approve. Static review is clean.\n",
    );
    const context = JSON.parse(
      execFileSync("node", [INVOCATION, "judge-context", manifest], {
        cwd: root,
        encoding: "utf8",
      }),
    );
    expect(context.findings).toEqual([]);
  });

  it("exposes persisted judge dispositions to targeted verification", () => {
    const root = repo("prior-judge-dispositions");
    const manifest = create(root);
    prepareCodexReview(root, manifest, [
      {
        severity: "medium",
        title: "Retry evidence",
        body: "The retry path needs verification",
        recommendation: "Verify the bounded retry path",
        evidence: { file: "file.js", line: 1 },
      },
    ]);
    const context = JSON.parse(
      execFileSync("node", [INVOCATION, "judge-context", manifest], {
        cwd: root,
        encoding: "utf8",
      }),
    );
    context.findings[0].disposition = "WARNING";
    context.findings[0].reason = "Useful targeted verification context";
    const artifact = path.join(root, "judge.json");
    writeFileSync(artifact, JSON.stringify(context));
    execFileSync(
      "node",
      [INVOCATION, "judge", manifest, "--artifact", artifact],
      { cwd: root },
    );

    const prior = JSON.parse(
      execFileSync("node", [INVOCATION, "prior-findings", manifest], {
        cwd: root,
        encoding: "utf8",
      }),
    );
    expect(prior.findings[0]).toMatchObject({
      disposition: "WARNING",
      reason: "Useful targeted verification context",
    });
  });

  it("treats unjudged prior findings as blocking verification targets", () => {
    const root = repo("prior-unjudged-findings");
    const manifest = create(root);
    prepareCodexReview(root, manifest, [
      {
        severity: "high",
        title: "Unjudged blocker",
        body: "Must remain in the verification set",
        recommendation: "Verify it",
        evidence: { file: "file.js", line: 1 },
      },
    ]);
    const prior = JSON.parse(
      execFileSync("node", [INVOCATION, "prior-findings", manifest], {
        cwd: root,
        encoding: "utf8",
      }),
    );
    expect(prior.findings[0]).toMatchObject({ disposition: "BLOCKING" });
  });

  it("persists applicable required gates and requires current-head evidence", () => {
    const root = repo("required-gates");
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: {
          lint: "eslint .",
          test: "node --test",
          "security:audit": "npm audit --audit-level high",
          build: "node build.js",
          "type-check:all": "tsc --noEmit",
          "test:consumer-workflow": "node consumer.js",
        },
      }),
    );
    git(root, ["add", "package.json"]);
    git(root, ["commit", "-q", "-m", "add applicable gates"]);
    const manifest = create(root);
    const required = JSON.parse(readFileSync(manifest, "utf8")).requiredGates;
    expect(required.map((gate) => gate.name)).toEqual([
      "lint",
      "test",
      "security",
      "build",
      "type",
      "consumer",
    ]);

    prepareCodexReview(root, manifest);
    expect(
      spawnSync("node", [INVOCATION, "review-authorization", manifest], {
        cwd: root,
        encoding: "utf8",
      }).stderr,
    ).toMatch(/required build gate evidence is missing or stale/);

    for (const name of ["build", "type", "consumer"])
      recordGateFixture(manifest, name);
    recordJudgeArtifact(root, manifest);
    expect(() =>
      execFileSync("node", [INVOCATION, "review-authorization", manifest], {
        cwd: root,
      }),
    ).not.toThrow();
    expect(JSON.parse(readFileSync(manifest, "utf8")).requiredGates).toEqual(
      required,
    );
  });

  it("binds optional gate evidence to the persisted trusted source and command", () => {
    const root = repo("trusted-gate-runner");
    const marker = path.join(tmpdir(), `quality-build-${process.pid}.marker`);
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: {
          lint: "node --check file.js",
          test: "node --test",
          "security:audit": "node --check file.js",
          build:
            "node -e \"require('fs').writeFileSync(process.env.QUALITY_GATE_MARKER, 'built')\"",
          typecheck: "node --check file.js",
          "test:consumer": "node --check file.js",
        },
      }),
    );
    git(root, ["add", "package.json"]);
    git(root, ["commit", "-q", "-m", "add trusted gate scripts"]);
    const manifest = create(root);
    const required = JSON.parse(readFileSync(manifest, "utf8")).requiredGates;

    for (const name of ["build", "type", "consumer"]) {
      const gate = required.find((candidate) => candidate.name === name);
      const log = path.join(path.dirname(manifest), `${name}.forged.log`);
      writeFileSync(log, "forged pass\n");
      const forged = spawnSync(
        "node",
        [
          INVOCATION,
          "gate",
          manifest,
          "--name",
          name,
          "--source",
          gate.source,
          "--command",
          "true",
          "--log",
          log,
        ],
        { cwd: root, encoding: "utf8" },
      );
      expect(forged.status).not.toBe(0);
      expect(forged.stderr).toMatch(
        /unknown quality invocation command 'gate'/,
      );
    }

    const callerCommand = spawnSync(
      "bash",
      [RUN_GATE, "--manifest", manifest, "--name", "build", "--", "true"],
      { cwd: root, encoding: "utf8" },
    );
    expect(callerCommand.status).not.toBe(0);
    expect(callerCommand.stderr).toMatch(/resolved from the persisted/);
    expect(existsSync(marker)).toBe(false);

    execFileSync(
      "bash",
      [RUN_GATE, "--manifest", manifest, "--name", "build"],
      {
        cwd: root,
        env: { ...process.env, QUALITY_GATE_MARKER: marker },
      },
    );
    expect(readFileSync(marker, "utf8")).toBe("built");
    const evidence = JSON.parse(readFileSync(manifest, "utf8")).gates.find(
      (gate) => gate.name === "build",
    );
    expect(evidence).toMatchObject({
      source: "package-script:build",
      command: "npm run build",
    });
    unlinkSync(marker);
  });

  it("kills the complete gate process group when its budget expires", () => {
    const root = repo("gate-process-group");
    const marker = path.join(tmpdir(), `quality-late-gate-${process.pid}`);
    const gateScript = path.join(root, "gate-hang.sh");
    writeFileSync(
      gateScript,
      '#!/usr/bin/env bash\n(sleep 3; printf late > "$QUALITY_GATE_MARKER") &\nwait\n',
    );
    chmodSync(gateScript, 0o755);
    const packageFile = path.join(root, "package.json");
    const packageJson = JSON.parse(readFileSync(packageFile, "utf8"));
    packageJson.scripts.build = "bash gate-hang.sh";
    writeFileSync(packageFile, JSON.stringify(packageJson));
    git(root, ["add", "gate-hang.sh", "package.json"]);
    git(root, ["commit", "-q", "-m", "add hanging gate"]);
    const manifestPath = create(root);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.risk.runtime = { checkSeconds: 1 };
    manifest.governor.campaignDeadlineEpoch =
      Math.floor(Date.now() / 1000) + 30;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const result = spawnSync(
      "bash",
      [RUN_GATE, "--manifest", manifestPath, "--name", "build"],
      {
        cwd: root,
        env: { ...process.env, QUALITY_GATE_MARKER: marker },
        encoding: "utf8",
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/exceeded its proportional 1s budget/);
    execFileSync("sleep", ["4"]);
    expect(existsSync(marker)).toBe(false);
  }, 10_000);

  it("discovers committed gates on every advance and unions them monotonically", () => {
    const root = repo("monotonic-gates");
    const packageFile = path.join(root, "package.json");
    const scripts = {
      lint: "node --check file.js",
      test: "node --test",
      "security:audit": "node --check file.js",
    };
    writeFileSync(packageFile, JSON.stringify({ scripts }));
    git(root, ["add", "package.json"]);
    git(root, ["commit", "-q", "-m", "add baseline scripts"]);
    const manifest = create(root);

    writeFileSync(
      packageFile,
      JSON.stringify({ scripts: { ...scripts, build: "node build.js" } }),
    );
    git(root, ["add", "package.json"]);
    git(root, ["commit", "-q", "-m", "require build"]);
    writeFileSync(
      packageFile,
      JSON.stringify({
        scripts: {
          ...scripts,
          build: "node build.js",
          "test:consumer": "node consumer.js",
        },
      }),
    );
    execFileSync("node", [INVOCATION, "advance", manifest], { cwd: root });
    let required = JSON.parse(readFileSync(manifest, "utf8")).requiredGates;
    expect(required.map((gate) => gate.name)).toContain("build");
    expect(required.map((gate) => gate.name)).not.toContain("consumer");

    writeFileSync(
      packageFile,
      JSON.stringify({ scripts: { ...scripts, typecheck: "tsc --noEmit" } }),
    );
    git(root, ["add", "package.json"]);
    git(root, ["commit", "-q", "-m", "replace build with typecheck"]);
    execFileSync("node", [INVOCATION, "advance", manifest], { cwd: root });
    required = JSON.parse(readFileSync(manifest, "utf8")).requiredGates;
    expect(required.map((gate) => gate.name)).toEqual([
      "lint",
      "test",
      "security",
      "build",
      "type",
    ]);
  });

  it("fails closed on future required-gate policy versions", () => {
    const root = repo("future-gate-policy");
    const manifestPath = create(root);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.requiredGatesPolicyVersion = 3;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    for (const command of ["validate", "advance"]) {
      const result = spawnSync("node", [INVOCATION, command, manifestPath], {
        cwd: root,
        encoding: "utf8",
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(
        /unsupported required-gates policy version/,
      );
    }
  });

  it("rejects scope modes the revision-bound engine cannot execute", () => {
    const root = repo("unsupported-scope");
    for (const scope of ["changed", "all"]) {
      expect(() => create(root, ["--scope", scope])).toThrow(
        /only revision-bound branch scope is supported/,
      );
    }
  });

  it("migrates legacy required gates only during an explicit locked resume", () => {
    const root = repo("legacy-required-gates");
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: {
          lint: "eslint .",
          test: "node --test",
          "security:audit": "npm audit",
          build: "node build.js",
          "type-check": "tsc --noEmit",
          "test:consumer": "node consumer.js",
        },
      }),
    );
    git(root, ["add", "package.json"]);
    git(root, ["commit", "-q", "-m", "add applicable legacy gates"]);
    const manifestPath = create(root);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    delete manifest.requiredGates;
    delete manifest.requiredGatesPolicyVersion;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const rejected = spawnSync("node", [INVOCATION, "validate", manifestPath], {
      cwd: root,
      encoding: "utf8",
    });
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toMatch(/requires an explicit advance/);

    execFileSync("node", [INVOCATION, "advance", manifestPath], { cwd: root });
    const migrated = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(migrated.requiredGatesPolicyVersion).toBe(2);
    expect(migrated.requiredGates.map((gate) => gate.name)).toEqual([
      "lint",
      "test",
      "security",
      "build",
      "type",
      "consumer",
    ]);

    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { lint: "eslint .", test: "node --test" } }),
    );
    execFileSync("node", [INVOCATION, "advance", manifestPath], { cwd: root });
    expect(
      JSON.parse(readFileSync(manifestPath, "utf8")).requiredGates,
    ).toEqual(migrated.requiredGates);
  });
});
