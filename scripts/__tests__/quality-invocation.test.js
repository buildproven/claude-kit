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

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function repo(label) {
  const root = mkdtempSync(path.join(tmpdir(), `quality-${label}-`));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.name", "Quality Test"]);
  git(root, ["config", "user.email", "quality@example.com"]);
  writeFileSync(path.join(root, "file.js"), "export const value = 1;\n");
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
    ? ["--github-repo", "owner/repo", "--head-ref", "feature"]
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

function prepareCodexReview(root, manifestPath, providerFindings = []) {
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
    providerFindings.length === 0 ? "NO FINDINGS.\n" : "BLOCKING findings.\n",
  );
  writeFileSync(
    path.join(info.artifactDir, "codex-1.json"),
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
    const log = path.join(path.dirname(manifestPath), `${name}.gate.log`);
    writeFileSync(log, `${name} passed\n`);
    execFileSync(
      "node",
      [
        INVOCATION,
        "gate",
        manifestPath,
        "--name",
        name,
        "--command",
        `test-${name}`,
        "--log",
        log,
      ],
      { cwd: root },
    );
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
  printf '%s\\n' '{"number":7,"headRefName":"feature","headRefOid":"${git(root, ["rev-parse", "HEAD"])}","baseRefName":"release","baseRefOid":"${base}"}'
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
    expect(manifest.revisions.baseRef).toBe("origin/release");
    expect(manifest.revisions.baseHeadSha).toBe(base);
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

  it("excludes provider time from the remediation budget", () => {
    const root = repo("provider-budget");
    const manifest = create(root, [], {
      BS_QUALITY_MAX_REMEDIATION_SECONDS: "2",
    });
    const state = JSON.parse(readFileSync(manifest, "utf8"));
    state.governor.startedAtEpoch -= 3600;
    writeFileSync(manifest, `${JSON.stringify(state, null, 2)}\n`);

    expect(
      spawnSync("node", [GOVERNOR, "bump-round", manifest], { cwd: root })
        .status,
    ).toBe(0);
    expect(
      spawnSync("node", [GOVERNOR, "check", manifest], { cwd: root }).status,
    ).toBe(0);
    const updated = JSON.parse(readFileSync(manifest, "utf8"));
    expect(updated.governor.remediationStartedAtEpoch).not.toBeNull();
  });

  it("retries an unconsumed provider attempt without spending the mandatory rereview round", () => {
    const root = repo("provider-retry-budget");
    const manifest = create(root, [], {
      BS_QUALITY_MAX_REVIEW_ROUNDS: "2",
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
      [INVOCATION, "record-stamp", manifest, "--head", stampHead],
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
      [INVOCATION, "record-stamp", manifest, "--head", stampHead],
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
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        "lint-staged": {
          "**/*.{js,json,md,yml,yaml}": ["prettier --write"],
          "**/*.ts": ["eslint --fix"],
        },
      }),
    );
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

  it("reserves a mandatory second-review allowance after remediation time", () => {
    const root = repo("reserve");
    const manifest = create(root, [], {
      BS_QUALITY_MAX_REMEDIATION_SECONDS: "1",
      BS_QUALITY_REREVIEW_RESERVE_SECONDS: "60",
    });
    prepareCodexReview(root, manifest);
    const state = JSON.parse(readFileSync(manifest, "utf8"));
    state.governor.remediationStartedAtEpoch =
      Math.floor(Date.now() / 1000) - 2;
    writeFileSync(manifest, `${JSON.stringify(state, null, 2)}\n`);
    expect(
      spawnSync("node", [GOVERNOR, "check", manifest], { cwd: root }).status,
    ).not.toBe(0);
    expect(
      spawnSync("node", [GOVERNOR, "bump-round", manifest], { cwd: root })
        .status,
    ).toBe(0);
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
      input: JSON.stringify({ argv: ["--break-glass-approved"] }),
      encoding: "utf8",
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
    execFileSync("node", [INVOCATION, "advance", manifest], { cwd: root });
    const second = prepareCodexReview(root, manifest);
    expect(second.from).toBe(first.to);
    recordJudgeArtifact(root, manifest);

    const trailers = execFileSync("node", [INVOCATION, "trailers", manifest], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    const message = `chore: quality stamp\n\n${trailers}`;
    git(root, ["commit", "--allow-empty", "-q", "-m", message]);
    const stampHead = git(root, ["rev-parse", "HEAD"]);
    execFileSync(
      "node",
      [INVOCATION, "record-stamp", manifest, "--head", stampHead],
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
    const unprotected = spawnSync("bash", [AUTHORIZE, "--manifest", manifest], {
      cwd: caller,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
    });
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
  }, 15_000);

  it("rejects a dirty working tree before gates, review, and stamp", () => {
    const root = repo("dirty-preflight");
    const manifest = create(root, ["--level", "95", "--pr", "1", "--merge"]);
    execFileSync("bash", [RISK, "--manifest", manifest], { cwd: root });
    execFileSync("bash", [SELECT, "--manifest", manifest], { cwd: root });
    writeFileSync(path.join(root, "dirty.txt"), "unreviewed\n");

    for (const invocation of [
      [
        "bash",
        [RUN_GATE, "--manifest", manifest, "--name", "lint", "--", "true"],
      ],
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
    const fail = path.join(harness, "fail-ci");
    const denyPreflight = path.join(harness, "deny-preflight");
    const merged = path.join(harness, "merged");
    writeFileSync(fail, "fail\n");
    writeFileSync(denyPreflight, "deny\n");
    const gh = path.join(bin, "gh");
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

    const first = spawnSync("bash", [STAMP_AND_MERGE, "--manifest", manifest], {
      cwd: root,
      env,
      encoding: "utf8",
    });
    expect(first.status).not.toBe(0);
    const afterFirst = JSON.parse(readFileSync(manifest, "utf8"));
    const stampHead = afterFirst.merge.stampHead;
    expect(stampHead).toBe(git(root, ["rev-parse", "HEAD"]));
    expect(
      git(root, [
        "rev-list",
        "--count",
        `${afterFirst.revisions.currentHead}..HEAD`,
      ]),
    ).toBe("1");

    unlinkSync(fail);
    const second = spawnSync(
      "bash",
      [STAMP_AND_MERGE, "--manifest", manifest],
      { cwd: root, env, encoding: "utf8" },
    );
    expect(second.status, second.stderr).toBe(0);
    expect(git(root, ["rev-parse", "HEAD"])).toBe(stampHead);
    const calls = readFileSync(log, "utf8");
    expect(calls.indexOf("pr checks 1 --required --watch")).toBeLessThan(
      calls.indexOf("pr merge 1"),
    );
  }, 20_000);

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
    execFileSync(
      "node",
      [
        INVOCATION,
        "gate",
        manifest,
        "--name",
        "test",
        "--status",
        "skipped",
        "--reason",
        "config-only fixture has no executable tests",
        "--command",
        "skip-tests",
        "--log",
        path.join(path.dirname(manifest), "test.gate.log"),
      ],
      { cwd: root },
    );
    recordJudgeArtifact(root, manifest, []);
    expect(() =>
      execFileSync("node", [INVOCATION, "review-authorization", manifest], {
        cwd: root,
      }),
    ).not.toThrow();

    const missingReason = spawnSync(
      "node",
      [
        INVOCATION,
        "gate",
        falseManifest,
        "--name",
        "test",
        "--status",
        "skipped",
        "--command",
        "skip-tests",
        "--log",
        path.join(path.dirname(manifest), "test.gate.log"),
      ],
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

  it("persists applicable required gates and requires current-head evidence", () => {
    const root = repo("required-gates");
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: {
          lint: "eslint .",
          test: "node --test",
          build: "node build.js",
          "type-check:all": "tsc --noEmit",
          "test:consumer-workflow": "node consumer.js",
          "security:audit": "npm audit",
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

    for (const name of ["build", "type", "consumer"]) {
      const log = path.join(path.dirname(manifest), `${name}.gate.log`);
      writeFileSync(log, `${name} passed\n`);
      execFileSync(
        "node",
        [
          INVOCATION,
          "gate",
          manifest,
          "--name",
          name,
          "--command",
          `test-${name}`,
          "--log",
          log,
        ],
        { cwd: root },
      );
    }
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

  it("migrates legacy required gates only during an explicit locked resume", () => {
    const root = repo("legacy-required-gates");
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: {
          lint: "eslint .",
          test: "node --test",
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
    expect(migrated.requiredGatesPolicyVersion).toBe(1);
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
