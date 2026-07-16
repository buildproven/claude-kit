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
  return execFileSync(
    "node",
    [
      INVOCATION,
      "create",
      "--repo",
      root,
      "--base-ref",
      "origin/main",
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
  return info;
}

function recordJudgeArtifact(root, manifest, dispositions = []) {
  const artifact = path.join(root, "judge-input.json");
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
  const bin = path.join(root, "fake-bin");
  mkdirSync(bin);
  const gh = path.join(bin, "gh");
  writeFileSync(
    gh,
    `#!/usr/bin/env bash
if [ "$1 $2" = "pr view" ]; then
  args="$*"
  if [[ "$args" == *"state,mergedAt,mergeCommit"* ]]; then
    printf '%s\\n' '{"state":"MERGED","mergedAt":"2026-07-16T00:00:00Z","mergeCommit":{"oid":"merge"}}'
  elif [[ "$args" == *"headRefOid,baseRefOid"* ]]; then
    printf '%s\\n' '{"headRefOid":"${head}","baseRefName":"main"}'
  else
    printf '%s\\n' '{"headRefOid":"${head}","baseRefName":"main"}'
  fi
  exit 0
fi
if [ "$1 $2" = "pr checks" ]; then exit 0; fi
if [ "$1 $2" = "pr merge" ]; then exit 0; fi
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
  });

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
  });

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
    const manifest = create(root, ["--pr", "1", "--level", "98"], {
      BREAK_GLASS_APPROVED: "true",
      BREAK_GLASS_APPROVER: "brett",
    });
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

    execFileSync(
      "node",
      [
        INVOCATION,
        "approve",
        manifest,
        "--approval-actor",
        "brett",
        "--approval-source",
        "resumed-outer-invocation",
      ],
      { cwd: root },
    );
    expect(
      spawnSync("bash", [SELECT, "--manifest", manifest], { cwd: root }).status,
    ).toBe(0);
  }, 15_000);

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
    const state = JSON.parse(readFileSync(manifest, "utf8"));
    state.governor.remediationStartedAtEpoch =
      Math.floor(Date.now() / 1000) - 2;
    writeFileSync(manifest, `${JSON.stringify(state, null, 2)}\n`);
    expect(
      spawnSync("node", [GOVERNOR, "check", manifest], { cwd: root }).status,
    ).not.toBe(0);
    state.governor.roundsUsed = 1;
    writeFileSync(manifest, `${JSON.stringify(state, null, 2)}\n`);
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
    const manifest = create(root, ["--level", "95", "--pr", "1"]);
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
    const lifecycle = [];
    lifecycle.push("push");
    lifecycle.push("ci:success");
    const bin = fakeGh(root, git(root, ["rev-parse", "HEAD"]));
    const caller = repo("authorization-caller");
    expect(
      spawnSync("bash", [AUTHORIZE, "--manifest", manifest], {
        cwd: caller,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        encoding: "utf8",
      }).status,
    ).toBe(0);
    lifecycle.push("merge");
    expect(lifecycle).toEqual(["push", "ci:success", "merge"]);

    git(root, ["reset", "--hard", "-q", "HEAD~1"]);
    writeFileSync(path.join(root, "stale.js"), "export const stale = true;\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "unreviewed"]);
    expect(
      spawnSync("bash", [AUTHORIZE, "--manifest", manifest], {
        cwd: root,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      }).status,
    ).not.toBe(0);
  }, 15_000);

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
});
