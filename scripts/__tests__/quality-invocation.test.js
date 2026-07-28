import { execFileSync, spawn, spawnSync } from "node:child_process";
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

function recordMutationFixture(manifestPath) {
  invocation.withManifestLock(manifestPath, (manifest) => {
    if (!["high", "critical"].includes(manifest.risk?.tier)) return;
    const artifact = path.join(
      path.dirname(manifestPath),
      `${manifest.revisions.currentHead}.mutation.json`,
    );
    writeFileSync(
      artifact,
      JSON.stringify({
        schemaVersion: 1,
        invocationId: manifest.invocationId,
        base: manifest.revisions.baseSha,
        head: manifest.revisions.currentHead,
        tier: manifest.risk.tier,
        method: "revert-diff",
        mutatedPaths: ["file.js"],
        testFailureObserved: true,
      }),
    );
    invocation.recordMutation(manifest, { artifact });
  });
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function withoutAmbientGitHubIdentity(overrides = {}) {
  const env = { ...process.env, ...overrides };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GITHUB_")) delete env[key];
  }
  return env;
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

function createAsync(root) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "node",
      [INVOCATION, "create", "--repo", root, "--base-ref", "origin/main"],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr || `create exited ${code}`));
    });
  });
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
  recordMutationFixture(manifestPath);
  return info;
}

function prepareAdvisoryReview(root, manifestPath, failureCategory) {
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
    path.join(info.artifactDir, "ci-only.findings.txt"),
    "NO FINDINGS. Verdict: pass. AI review unavailable; deterministic gates provide low-risk merge evidence.\n",
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
      "claude",
      "--advisory",
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
      "record-advisory-review",
      manifestPath,
      "--from",
      info.from,
      "--to",
      info.to,
      "--primary",
      "codex",
      "--fallback",
      "claude",
      "--failed-provider",
      "claude",
      "--failure-category",
      failureCategory,
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
  recordMutationFixture(manifest);
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
  it("reuses one durable campaign for the same exact repo, PR, base, HEAD, and options", () => {
    const root = repo("durable-campaign");
    const args = ["--level", "98", "--pr", "7", "--merge"];
    const first = create(root, args);
    execFileSync(
      "node",
      [INVOCATION, "provider-attempt", first, "--provider", "codex"],
      { cwd: root },
    );

    const second = create(root, args);
    expect(second).toBe(first);
    expect(
      JSON.parse(readFileSync(second, "utf8")).governor.providerAttempts,
    ).toHaveLength(1);

    writeFileSync(path.join(root, "next.js"), "export const next = true;\n");
    git(root, ["add", "next.js"]);
    git(root, ["commit", "-q", "-m", "fix: new reviewed head"]);
    expect(create(root, args)).not.toBe(first);
  });

  it("creates active-execution manifests without wall-clock deadlines", () => {
    const root = repo("execution-budget-schema");
    const manifest = JSON.parse(readFileSync(create(root), "utf8"));
    expect(manifest.governor).toMatchObject({
      executionBudgetVersion: 1,
      gateSecondsLimit: 600,
      gateSecondsUsed: 0,
      providerSecondsLimit: 900,
      providerSecondsUsed: 0,
      activeExecution: null,
    });
    expect(manifest.governor).not.toHaveProperty("campaignDeadlineEpoch");
    expect(manifest.governor).not.toHaveProperty("providerDeadlineEpoch");
    expect(manifest.governor).not.toHaveProperty("validationDeadlineEpoch");
  });

  it("records a merge-train lease and refuses provider starts after its shared deadline", () => {
    const root = repo("merge-train-lease");
    const deadline = Math.floor(Date.now() / 1000) + 60;
    const manifestPath = create(root, [], {
      BS_QUALITY_SHARED_DEADLINE_EPOCH: String(deadline),
      BS_QUALITY_TRAIN_RESERVATION_SECONDS: "120",
      BS_QUALITY_MAX_TOTAL_PROVIDER_SECONDS: "300",
    });
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.governor).toMatchObject({
      sharedDeadlineEpoch: deadline,
      trainReservationSeconds: 120,
      providerSecondsLimit: 120,
    });
    manifest.governor.sharedDeadlineEpoch = Math.floor(Date.now() / 1000);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const result = spawnSync(
      "node",
      [INVOCATION, "provider-attempt", manifestPath, "--provider", "codex"],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/shared merge-train deadline has elapsed/);
  });

  it.each([
    [
      "BS_QUALITY_SHARED_DEADLINE_EPOCH",
      String(Math.floor(Date.now() / 1000) + 60),
    ],
    ["BS_QUALITY_TRAIN_RESERVATION_SECONDS", "120"],
  ])("rejects a partial merge-train lease environment: %s", (name, value) => {
    const root = repo(`partial-merge-train-lease-${name}`);
    const result = spawnSync(
      "node",
      [INVOCATION, "create", "--repo", root, "--base-ref", "origin/main"],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, [name]: value },
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(
      /BS_QUALITY_SHARED_DEADLINE_EPOCH and BS_QUALITY_TRAIN_RESERVATION_SECONDS must be set together/,
    );
  });

  it("authorizes Gemini inside the existing provider attempt budget", () => {
    const root = repo("gemini-provider-attempt");
    const manifest = create(root, []);
    const result = JSON.parse(
      execFileSync(
        "node",
        [INVOCATION, "provider-attempt", manifest, "--provider", "gemini"],
        { cwd: root, encoding: "utf8" },
      ),
    );
    expect(result.provider).toBe("gemini");
    expect(result.number).toBe(1);
  });

  it("refuses a fresh same-work campaign created only by swapping provider policy", () => {
    const root = repo("durable-provider-policy");
    create(root, [], {
      BS_QUALITY_PRIMARY: "codex",
      BS_QUALITY_FALLBACK: "claude",
    });

    const changedPolicy = spawnSync(
      "node",
      [INVOCATION, "create", "--repo", root, "--base-ref", "origin/main"],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          BS_QUALITY_PRIMARY: "claude",
          BS_QUALITY_FALLBACK: "codex",
        },
      },
    );
    expect(changedPolicy.status).not.toBe(0);
    expect(changedPolicy.stderr).toMatch(
      /deterministic quality campaign identity collision/,
    );
  });

  it("fails over an exhausted same-head campaign without resetting its budget", () => {
    const root = repo("durable-provider-failover");
    const manifest = create(root, [], {
      BS_QUALITY_PRIMARY: "codex",
      BS_QUALITY_FALLBACK: "claude",
    });
    invocation.withManifestLock(manifest, (state) => {
      state.governor.providerAttempts.push({
        number: 1,
        provider: "claude",
        head: state.revisions.currentHead,
        reviewCount: 0,
        startedAt: new Date().toISOString(),
        timeoutSeconds: 60,
      });
      state.governor.providerSecondsUsed = 60;
    });

    expect(
      create(root, [], {
        BS_QUALITY_PRIMARY: "gemini",
        BS_QUALITY_FALLBACK: "claude",
      }),
    ).toBe(manifest);
    const resumed = JSON.parse(readFileSync(manifest, "utf8"));
    expect(resumed.invocationId).toBe(path.basename(path.dirname(manifest)));
    expect(resumed.governor.providerSecondsUsed).toBe(60);
    expect(resumed.provider.primaryOverride).toBe("gemini");
    expect(resumed.provider.transitions).toHaveLength(1);
    expect(resumed.provider.transitions[0]).toMatchObject({
      from: { primaryOverride: "codex", fallbackOverride: "claude" },
      to: { primaryOverride: "gemini", fallbackOverride: "claude" },
    });
  });

  it("binds review-arm attribution to the assigned primary provider", () => {
    const nativeRoot = repo("native-review-arm");
    const nativeManifest = JSON.parse(
      readFileSync(
        create(nativeRoot, [
          "--primary",
          "codex",
          "--fallback",
          "claude",
          "--review-arm",
          "native",
        ]),
        "utf8",
      ),
    );
    expect(nativeManifest.options.reviewArm).toBe("native");
    expect(nativeManifest.provider.primaryOverride).toBe("codex");

    const bespokeRoot = repo("bespoke-review-arm");
    const bespokeManifest = JSON.parse(
      readFileSync(
        create(bespokeRoot, [
          "--primary",
          "claude",
          "--fallback",
          "codex",
          "--review-arm",
          "bespoke",
        ]),
        "utf8",
      ),
    );
    expect(bespokeManifest.options.reviewArm).toBe("bespoke");
    expect(bespokeManifest.provider.primaryOverride).toBe("claude");
  });

  it("rejects an arm label that conflicts with its primary provider", () => {
    const root = repo("conflicting-review-arm");
    expect(() =>
      create(root, [
        "--primary",
        "codex",
        "--fallback",
        "claude",
        "--review-arm",
        "bespoke",
      ]),
    ).toThrow(/review arm 'bespoke' conflicts with primary provider 'codex'/);
  });

  it("rejects an explicit experiment arm without a bound primary provider", () => {
    const root = repo("unbound-review-arm");
    expect(() => create(root, ["--review-arm", "native"])).toThrow(
      /explicit review arm requires a primary provider/,
    );
  });

  it("does not turn an ordinary provider override into an experiment assignment", () => {
    const root = repo("ordinary-provider-attribution");
    const manifest = JSON.parse(
      readFileSync(
        create(root, ["--primary", "codex", "--fallback", "claude"]),
        "utf8",
      ),
    );
    expect(manifest.options.reviewArm).toBeNull();
    expect(manifest.provider.primaryOverride).toBe("codex");
  });

  it("resumes after review without treating provider evidence as configuration drift", () => {
    const root = repo("reviewed-provider-identity");
    const env = {
      BS_QUALITY_PRIMARY: "gemini",
      BS_QUALITY_FALLBACK: "none",
    };
    const manifest = create(root, [], env);
    const body = JSON.parse(readFileSync(manifest, "utf8"));
    body.provider = {
      ...body.provider,
      primary: "gemini",
      fallback: "none",
      reviewer: "gemini",
    };
    writeFileSync(manifest, `${JSON.stringify(body, null, 2)}\n`);

    expect(create(root, [], env)).toBe(manifest);
  });

  it("refuses caller-selected invocation ids that would reset a campaign", () => {
    const root = repo("durable-explicit-id");
    expect(() =>
      create(root, ["--invocation-id", "11111111-1111-4111-8111-111111111111"]),
    ).toThrow(/deterministic.*cannot be overridden/);
  });

  it("atomically converges concurrent creators on one durable manifest", async () => {
    const root = repo("durable-concurrent-create");
    const manifests = await Promise.all([
      createAsync(root),
      createAsync(root),
      createAsync(root),
      createAsync(root),
    ]);
    expect(new Set(manifests).size).toBe(1);
    expect(JSON.parse(readFileSync(manifests[0], "utf8")).invocationId).toBe(
      path.basename(path.dirname(manifests[0])),
    );
  });

  it("cannot reset the same campaign from another linked worktree", () => {
    const root = repo("durable-linked-worktree");
    create(root);
    const linked = mkdtempSync(path.join(tmpdir(), "quality-linked-"));
    git(root, ["worktree", "add", "--detach", linked, "HEAD"]);
    expect(() => create(linked)).toThrow(
      /deterministic quality campaign identity collision/,
    );
  });

  it("namespaces independent clones by their Git common directory", () => {
    const root = repo("durable-independent-clone");
    const original = create(root);
    const clone = mkdtempSync(path.join(tmpdir(), "quality-clone-"));
    execFileSync("git", ["clone", "-q", root, clone]);
    git(clone, ["fetch", "-q", "origin", "main"]);
    const independent = create(clone);
    expect(independent).not.toBe(original);
  });

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
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          BS_QUALITY_PRIMARY: "codex",
          BS_QUALITY_FALLBACK: "claude",
        },
      },
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
    expect(manifest.options.reviewArm).toBeNull();
    expect(manifest.provider.primaryOverride).toBe("codex");
    expect(manifest.provider.fallbackOverride).toBe("claude");
  }, 120_000);

  it("routes an explicit bespoke experiment arm through the companion provider", () => {
    const root = repo("bootstrap-bespoke-arm");
    const result = spawnSync(
      "bash",
      [
        BOOTSTRAP,
        "--target-dir",
        root,
        "--level",
        "auto",
        "--review-arm",
        "bespoke",
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    const manifestPath = result.stdout
      .split("\n")
      .find((line) => line.startsWith("BS_QUALITY_MANIFEST="))
      ?.slice("BS_QUALITY_MANIFEST=".length);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.options.reviewArm).toBe("bespoke");
    expect(manifest.provider.primaryOverride).toBe("claude");
    expect(manifest.provider.fallbackOverride).toBe("codex");
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
    git(root, ["commit", "--amend", "-q", "-m", "fix: correct value"]);
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
    expect(manifest.risk.mergeAuthority).toBe("autonomous");
    expect(manifest.risk.taskType).toBe("bugfix");
    expect(manifest.risk.score).toBeGreaterThanOrEqual(35);
    expect(manifest.risk.score).toBeLessThan(60);
    expect(manifest.agents.length).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it("persists an explicit human-required policy in the immutable risk contract", () => {
    const root = repo("human-required-authority");
    writeFileSync(
      path.join(root, "harness-config.json"),
      JSON.stringify({ scorePolicy: { mergeAuthority: "human-required" } }),
    );
    git(root, ["add", "harness-config.json"]);
    git(root, ["commit", "-qm", "configure manual governance"]);
    const manifestPath = create(root);
    const result = spawnSync("bash", [RISK, "--manifest", manifestPath], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.risk.mergeAuthority).toBe("human-required");
  });

  it("fails closed to human-required when a direct risk write omits authority", () => {
    const root = repo("legacy-risk-authority");
    const manifestPath = create(root);
    invocation.withManifestLock(manifestPath, (manifest) => {
      invocation.setRisk(manifest, {
        tier: "high",
        taskType: "bugfix",
        score: 60,
        agents: 2,
        "codex-depth": "high",
        "codex-rounds": 1,
      });
    });
    expect(
      invocation.loadManifest(manifestPath).manifest.risk.mergeAuthority,
    ).toBe("human-required");
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
    // Advancing HEAD invalidates the HEAD-bound approval.
    expect(state.approval.approved).toBe(false);
    // Phase 0 contract: select-agents no longer HARD-BLOCKS critical when the
    // approval is absent — it defers so the full critical review runs, and the
    // human-capability decision moves to quality-authorize-merge.sh (which knows
    // repo enforceability). So select-agents succeeds even with approval void…
    expect(
      spawnSync("bash", [SELECT, "--manifest", manifest], { cwd: root }).status,
    ).toBe(0);
    // …but the invalidated approval must remain invalid, which is what keeps the
    // authoritative merge gate correct until re-approval.
    expect(
      spawnSync("node", [INVOCATION, "approval-valid", manifest], { cwd: root })
        .status,
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

  it("supports one explicit approve command bound to PR and exact HEAD", () => {
    const root = repo("approval-command");
    const head = git(root, ["rev-parse", "HEAD"]);
    const base = git(root, ["rev-parse", "origin/main"]);
    const bin = mkdtempSync(path.join(tmpdir(), "quality-approve-gh-"));
    const gh = path.join(bin, "gh");
    writeFileSync(
      gh,
      `#!/usr/bin/env bash
if [ "$1 $2" = "pr view" ]; then
  printf '%s\\n' '{"number":14,"headRefName":"feature","headRefOid":"${head}","headRepository":{"nameWithOwner":"owner/repo"},"isCrossRepository":false,"baseRefName":"main","baseRefOid":"${base}","url":"https://github.com/owner/repo/pull/14"}'
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
    // quality-target-resolver.js's getRepoForDir requires a GitHub-shaped
    // origin remote to resolve --target-dir's repo (BUI-391 fail-closed
    // cross-check). The repo() fixture's real origin is a local filesystem
    // path (so bootstrap's own fetch/ls-remote against it keep working); this
    // `git` shim intercepts only `remote get-url origin` and reports a
    // GitHub-shaped URL matching the mock `gh`'s repo, forwarding every other
    // subcommand straight through to the real `git` on $PATH.
    const gitShim = path.join(bin, "git");
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    writeFileSync(
      gitShim,
      `#!/usr/bin/env bash
# quality-target-resolver.js calls: git -C <dir> remote get-url origin
if [ "$1" = "-C" ] && [ "$3 $4 $5" = "remote get-url origin" ]; then
  printf '%s\\n' "https://github.com/owner/repo.git"
  exit 0
fi
exec "${realGit}" "$@"
`,
    );
    chmodSync(gitShim, 0o755);
    const result = spawnSync("node", [WRAPPER, BOOTSTRAP], {
      cwd: root,
      input: JSON.stringify({
        argv: [
          "approve",
          "--target-dir",
          root,
          "--pr",
          "14",
          "--head",
          head,
          "--level",
          "98",
        ],
      }),
      encoding: "utf8",
      env: withoutAmbientGitHubIdentity({
        BREAK_GLASS_APPROVER: "brett",
        CLAUDE_SETUP_ROOT: ROOT,
        PATH: `${bin}:${process.env.PATH}`,
      }),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("PR: 14");
    expect(result.stdout).toContain(`HEAD: ${head}`);
    expect(result.stdout).toContain("Approver: brett");
    expect(result.stdout).toMatch(/Expires: \d{4}-\d{2}-\d{2}T/);
    const manifest = result.stdout
      .split("\n")
      .find((line) => line.startsWith("BS_QUALITY_MANIFEST="))
      ?.slice("BS_QUALITY_MANIFEST=".length);
    expect(
      spawnSync("node", [INVOCATION, "approval-valid", manifest], {
        cwd: root,
      }).status,
    ).toBe(0);
  });

  it("carries a valid break-glass approval across a rebase-only HEAD change with no new diff (BUI-380)", () => {
    const root = repo("approval-rebase-carry");
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
    expect(
      spawnSync("node", [INVOCATION, "approval-valid", manifest], {
        cwd: root,
      }).status,
    ).toBe(0);
    const beforeState = JSON.parse(readFileSync(manifest, "utf8"));
    const priorHead = beforeState.revisions.currentHead;

    // Advance main with an unrelated commit, then rebase the feature branch
    // onto it. This rewrites the feature commit (new SHA, new parent) but
    // the diff content (file.js: 1 -> 2) is byte-identical.
    git(root, ["switch", "-q", "main"]);
    writeFileSync(path.join(root, "unrelated.js"), "export const u = 1;\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "unrelated main change"]);
    git(root, ["push", "-q", "origin", "main"]);
    git(root, ["switch", "-q", "feature"]);
    git(root, ["fetch", "-q", "origin", "main"]);
    git(root, ["rebase", "-q", "origin/main"]);
    const rebasedHead = git(root, ["rev-parse", "HEAD"]);
    expect(rebasedHead).not.toBe(priorHead);
    expect(
      spawnSync(
        "git",
        ["merge-base", "--is-ancestor", priorHead, rebasedHead],
        {
          cwd: root,
        },
      ).status,
    ).not.toBe(0); // confirm this is a real rewrite, not a fast-forward

    execFileSync("node", [INVOCATION, "advance", manifest], { cwd: root });
    const afterState = JSON.parse(readFileSync(manifest, "utf8"));
    expect(afterState.revisions.currentHead).toBe(rebasedHead);
    expect(afterState.approval.approved).toBe(true);
    expect(afterState.approval.rebaseCarriedHead).toBe(rebasedHead);
    expect(
      spawnSync("node", [INVOCATION, "approval-valid", manifest], {
        cwd: root,
      }).status,
    ).toBe(0);

    // baseHeadSha (quality-authorize-merge.sh's live-freshness anchor at
    // merge time, EXPECTED_BASE_OID) must advance with the rebase too, or
    // merge authorization would keep comparing against the pre-rebase base
    // forever and wrongly block an up-to-date branch with "PR base changed
    // after review" even though nothing unreviewed landed.
    const newMainHead = git(root, ["rev-parse", "origin/main"]);
    expect(afterState.revisions.baseHeadSha).toBe(newMainHead);
    expect(afterState.revisions.baseRebaseCarry).toMatchObject({
      head: rebasedHead,
      baseSha: newMainHead,
    });
    expect(
      spawnSync(
        "git",
        [
          "merge-base",
          "--is-ancestor",
          afterState.revisions.baseHeadSha,
          rebasedHead,
        ],
        { cwd: root },
      ).status,
    ).toBe(0);

    // A genuine new content change after the rebase must still invalidate
    // the carried approval — rebase tolerance must never become a blanket
    // pass.
    writeFileSync(path.join(root, "file.js"), "export const value = 3;\n");
    git(root, ["commit", "-qam", "real content change"]);
    execFileSync("node", [INVOCATION, "advance", manifest], { cwd: root });
    const finalState = JSON.parse(readFileSync(manifest, "utf8"));
    expect(finalState.approval.approved).toBe(false);
    expect(
      spawnSync("node", [INVOCATION, "approval-valid", manifest], {
        cwd: root,
      }).status,
    ).not.toBe(0);
  }, 120_000);

  it("never carries a non-string-patchId approval across a rebase-only HEAD change", () => {
    // invalidateOrCarryApproval() now guards manifest.approval.patchId with
    // typeof === "string" before comparing to currentPatchId(), mirroring
    // the sibling approvalHeadCarriedByRebase() guard, instead of relying
    // on plain `===` to fail safe by accident of JS equality (null !==
    // "realhash"). Locks in that a missing/non-string recorded patchId is
    // never treated as a proven patch-id match, even across a genuine
    // rebase-only replay.
    const root = repo("approval-null-patchid");
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
    const priorHead = JSON.parse(readFileSync(manifest, "utf8")).revisions
      .currentHead;

    // Simulate an approval record that never got a patchId (e.g. from a
    // pre-BUI-380 signer): null it out before the rebase.
    invocation.withManifestLock(manifest, (state) => {
      state.approval.patchId = null;
    });

    // Genuine rebase-only replay: rewrite history via an unrelated main
    // commit + rebase, same as the BUI-380 carry test above.
    git(root, ["switch", "-q", "main"]);
    writeFileSync(path.join(root, "unrelated.js"), "export const u = 1;\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "unrelated main change"]);
    git(root, ["push", "-q", "origin", "main"]);
    git(root, ["switch", "-q", "feature"]);
    git(root, ["fetch", "-q", "origin", "main"]);
    git(root, ["rebase", "-q", "origin/main"]);
    const rebasedHead = git(root, ["rev-parse", "HEAD"]);
    expect(rebasedHead).not.toBe(priorHead);

    execFileSync("node", [INVOCATION, "advance", manifest], { cwd: root });
    const afterState = JSON.parse(readFileSync(manifest, "utf8"));
    expect(afterState.revisions.currentHead).toBe(rebasedHead);
    // A non-string patchId must never be treated as a proven patch-id
    // match: the approval must be invalidated, not silently carried.
    expect(afterState.approval.approved).toBe(false);
    expect(afterState.approval.rebaseCarriedHead).toBeUndefined();
  });

  it("rejects approve commands from nested or headless quality children", () => {
    const root = repo("approval-command-child");
    const head = git(root, ["rev-parse", "HEAD"]);
    for (const guard of ["BS_QUALITY_HEADLESS", "BS_QUALITY_ACTIVE"]) {
      const result = spawnSync("node", [WRAPPER, BOOTSTRAP], {
        cwd: root,
        input: JSON.stringify({
          argv: ["approve", "--pr", "14", "--head", head],
        }),
        encoding: "utf8",
        env: { ...process.env, [guard]: "1" },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/outer quality invocation/i);
    }
  });

  it("also rejects legacy environment approval from nested quality children", () => {
    const root = repo("approval-environment-child");
    const result = spawnSync("node", [WRAPPER, BOOTSTRAP], {
      cwd: root,
      input: JSON.stringify({ argv: ["--level", "98"] }),
      encoding: "utf8",
      env: {
        ...process.env,
        BREAK_GLASS_APPROVED: "true",
        BS_QUALITY_ACTIVE: "1",
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/outer quality invocation/i);
  });

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

  it("persists provider attempt and cumulative execution caps", () => {
    const root = repo("provider-attempt-cap");
    const manifest = create(root, [], {
      BS_QUALITY_MAX_PROVIDER_ATTEMPTS: "2",
      BS_QUALITY_MAX_TOTAL_PROVIDER_SECONDS: "120",
    });
    for (const provider of ["claude", "codex"]) {
      const result = spawnSync(
        "node",
        [INVOCATION, "provider-attempt", manifest, "--provider", provider],
        { cwd: root, encoding: "utf8" },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout).remainingSeconds).toBeGreaterThan(0);
      execFileSync(
        "node",
        [INVOCATION, "provider-complete", manifest, "--provider", provider],
        { cwd: root },
      );
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
    expect(state.governor.providerSecondsLimit).toBe(120);
    state.governor.providerAttempts = [state.governor.providerAttempts[0]];
    state.governor.activeExecution = null;
    state.governor.providerSecondsUsed = 120;
    writeFileSync(manifest, `${JSON.stringify(state, null, 2)}\n`);
    const pastDeadline = spawnSync(
      "node",
      [INVOCATION, "provider-attempt", manifest, "--provider", "claude"],
      { cwd: root, encoding: "utf8" },
    );
    expect(pastDeadline.status).not.toBe(0);
    expect(pastDeadline.stderr).toMatch(
      /provider execution budget is exhausted/,
    );
  });

  it("rejects overlapping execution and reconciles an abandoned timeout", () => {
    const root = repo("provider-active-state");
    const manifestPath = create(root, [], {
      BS_QUALITY_MAX_TOTAL_PROVIDER_SECONDS: "120",
    });
    execFileSync(
      "node",
      [
        INVOCATION,
        "provider-attempt",
        manifestPath,
        "--provider",
        "codex",
        "--requested-timeout",
        "60",
      ],
      { cwd: root },
    );

    const overlapping = spawnSync(
      "node",
      [INVOCATION, "provider-attempt", manifestPath, "--provider", "claude"],
      { cwd: root, encoding: "utf8" },
    );
    expect(overlapping.status).not.toBe(0);
    expect(overlapping.stderr).toMatch(
      /provider execution 'codex' is already active/,
    );

    const abandoned = JSON.parse(readFileSync(manifestPath, "utf8"));
    abandoned.governor.activeExecution.startedAt = new Date(
      Date.now() - 61_000,
    ).toISOString();
    writeFileSync(manifestPath, `${JSON.stringify(abandoned, null, 2)}\n`);
    const resumed = JSON.parse(
      execFileSync(
        "node",
        [INVOCATION, "provider-attempt", manifestPath, "--provider", "claude"],
        { cwd: root, encoding: "utf8" },
      ),
    );
    expect(resumed.remainingSeconds).toBe(60);
    const state = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(state.governor.providerSecondsUsed).toBe(60);
    expect(state.governor.activeExecution.name).toBe("claude");
  });

  it("does not reset provider execution usage when the review head advances", () => {
    const root = repo("provider-window");
    const manifestPath = create(root, [], {
      BS_QUALITY_MAX_TOTAL_PROVIDER_SECONDS: "120",
    });
    execFileSync(
      "node",
      [INVOCATION, "provider-attempt", manifestPath, "--provider", "codex"],
      { cwd: root },
    );
    execFileSync(
      "node",
      [INVOCATION, "provider-complete", manifestPath, "--provider", "codex"],
      { cwd: root },
    );
    const usedBeforeAdvance = JSON.parse(readFileSync(manifestPath, "utf8"))
      .governor.providerSecondsUsed;

    writeFileSync(path.join(root, "next-head.js"), "export const next = 1;\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "fix: advance provider window"]);
    execFileSync("bash", [BOOTSTRAP, "--manifest", manifestPath], {
      cwd: root,
    });
    const current = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(current.governor.providerSecondsUsed).toBe(usedBeforeAdvance);
    expect(current.governor.providerSecondsLimit).toBe(120);
    const authorization = JSON.parse(
      execFileSync(
        "node",
        [INVOCATION, "provider-attempt", manifestPath, "--provider", "codex"],
        { cwd: root, encoding: "utf8" },
      ),
    );
    expect(authorization.remainingSeconds).toBeGreaterThan(0);
    expect(authorization.remainingSeconds).toBeLessThan(120);
  });

  it("shares cumulative execution time across fallback providers", () => {
    const root = repo("provider-fallback-window");
    const manifest = create(root, [], {
      BS_QUALITY_MAX_PROVIDER_SECONDS: "120",
      BS_QUALITY_MAX_TOTAL_PROVIDER_SECONDS: "120",
    });
    execFileSync(
      "node",
      [INVOCATION, "provider-attempt", manifest, "--provider", "codex"],
      { cwd: root },
    );
    execFileSync(
      "node",
      [INVOCATION, "provider-complete", manifest, "--provider", "codex"],
      { cwd: root },
    );

    const fallback = spawnSync(
      "node",
      [INVOCATION, "provider-attempt", manifest, "--provider", "claude"],
      { cwd: root, encoding: "utf8" },
    );
    expect(fallback.status, fallback.stderr).toBe(0);
    expect(JSON.parse(fallback.stdout).remainingSeconds).toBeGreaterThan(0);
    expect(JSON.parse(fallback.stdout).remainingSeconds).toBeLessThan(120);
  });

  it("reports exact-head successful gate evidence as reusable", () => {
    const root = repo("gate-reuse");
    const manifest = create(root);
    recordGateFixture(manifest, "lint");

    expect(
      spawnSync(
        "node",
        [INVOCATION, "gate-satisfied", manifest, "--name", "lint"],
        { cwd: root },
      ).status,
    ).toBe(0);
    expect(
      spawnSync(
        "node",
        [INVOCATION, "gate-satisfied", manifest, "--name", "test"],
        { cwd: root },
      ).status,
    ).toBe(1);

    const state = JSON.parse(readFileSync(manifest, "utf8"));
    const lint = state.gates.find((gate) => gate.name === "lint");
    writeFileSync(lint.log, "tampered\n");
    expect(
      spawnSync(
        "node",
        [INVOCATION, "gate-satisfied", manifest, "--name", "lint"],
        { cwd: root },
      ).status,
    ).toBe(1);
  });

  it("does not charge idle time before the first provider attempt", () => {
    const root = repo("provider-phase-start");
    const manifest = create(root, [], {
      BS_QUALITY_MAX_PROVIDER_SECONDS: "120",
    });
    const state = JSON.parse(readFileSync(manifest, "utf8"));
    state.governor.startedAtEpoch = Math.floor(Date.now() / 1000) - 600;
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

  it("stops review when cumulative provider execution is exhausted", () => {
    const root = repo("provider-budget");
    const manifest = create(root);
    const state = JSON.parse(readFileSync(manifest, "utf8"));
    state.governor.providerSecondsLimit = 2;
    state.governor.providerSecondsUsed = 2;
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

  it("does not charge an expired legacy campaign clock to execution", () => {
    const root = repo("reserve");
    const manifest = create(root, [], {
      BS_QUALITY_MAX_REMEDIATION_SECONDS: "1",
      BS_QUALITY_REREVIEW_RESERVE_SECONDS: "60",
    });
    prepareCodexReview(root, manifest);
    writeFileSync(path.join(root, "fix.js"), "export const fixed = true;\n");
    git(root, ["add", "fix.js"]);
    git(root, ["commit", "-q", "-m", "fix: verification head"]);
    execFileSync("node", [INVOCATION, "advance", manifest], { cwd: root });
    const state = JSON.parse(readFileSync(manifest, "utf8"));
    state.governor.campaignSeconds = 1;
    state.governor.startedAtEpoch = Math.floor(Date.now() / 1000) - 2;
    state.governor.campaignDeadlineEpoch =
      state.governor.startedAtEpoch + state.governor.campaignSeconds;
    state.governor.validationDeadlineEpoch = Math.floor(Date.now() / 1000) + 60;
    writeFileSync(manifest, `${JSON.stringify(state, null, 2)}\n`);
    expect(
      spawnSync("node", [GOVERNOR, "check", manifest], { cwd: root }).status,
    ).toBe(0);
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
    execFileSync("node", [INVOCATION, "advance", manifest], { cwd: root });
    const validationState = JSON.parse(readFileSync(manifest, "utf8"));
    expect(validationState.governor.gateSecondsUsed).toBe(0);
    expect(validationState.governor.providerSecondsUsed).toBe(0);
    expect(validationState.governor.gateSecondsLimit).toBe(600);
    expect(validationState.governor.providerSecondsLimit).toBe(900);
    execFileSync("node", [INVOCATION, "advance", manifest], { cwd: root });
    expect(
      JSON.parse(readFileSync(manifest, "utf8")).governor.providerSecondsUsed,
    ).toBe(validationState.governor.providerSecondsUsed);
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
  }, 90_000);

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
  }, 90_000);

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

  it("authorizes typed unavailable AI review as CI-only coverage at low risk", () => {
    const root = repo("low-risk-advisory-review");
    git(root, ["reset", "--hard", "-q", "origin/main"]);
    writeFileSync(path.join(root, "README.md"), "# Documentation\n");
    git(root, ["add", "README.md"]);
    git(root, ["commit", "-q", "-m", "docs: update readme"]);
    const manifest = create(root);
    invocation.withManifestLock(manifest, (loaded) => {
      invocation.setRisk(loaded, {
        tier: "low",
        taskType: "docs",
        score: 5,
        agents: 2,
        "codex-depth": "low",
        "codex-rounds": 1,
      });
      invocation.setAgents(loaded, ["reviewer-a", "reviewer-b"]);
    });
    prepareAdvisoryReview(root, manifest, "provider-unavailable");
    recordJudgeArtifact(root, manifest);

    expect(() =>
      execFileSync("node", [INVOCATION, "review-authorization", manifest], {
        cwd: root,
      }),
    ).not.toThrow();
    const saved = invocation.loadManifest(manifest).manifest;
    expect(saved.reviews).toEqual([
      expect.objectContaining({
        status: "advisory",
        provider: "ci-only",
        failureCategory: "provider-unavailable",
      }),
    ]);
  });

  it("BUI-454: CI-only advisory authorization stamps a distinct Quality-Reviewer trailer value", () => {
    // Merge evidence must record which authorization path produced a merge
    // (full AI review vs CI-only advisory) so it's queryable via a plain
    // `git log --grep` over trailers without a new telemetry subsystem.
    const root = repo("advisory-trailer-value");
    git(root, ["reset", "--hard", "-q", "origin/main"]);
    writeFileSync(path.join(root, "README.md"), "# Documentation\n");
    git(root, ["add", "README.md"]);
    git(root, ["commit", "-q", "-m", "docs: update readme"]);
    const manifest = create(root);
    invocation.withManifestLock(manifest, (loaded) => {
      invocation.setRisk(loaded, {
        tier: "low",
        taskType: "docs",
        score: 5,
        agents: 2,
        "codex-depth": "low",
        "codex-rounds": 1,
      });
      invocation.setAgents(loaded, ["reviewer-a", "reviewer-b"]);
    });
    for (const name of ["lint", "test", "security"]) {
      recordGateFixture(manifest, name);
    }
    prepareAdvisoryReview(root, manifest, "provider-unavailable");
    recordJudgeArtifact(root, manifest);

    const trailers = execFileSync("node", [INVOCATION, "trailers", manifest], {
      cwd: root,
      encoding: "utf8",
    });
    expect(trailers).toMatch(/^Quality-Reviewer: ci-only$/m);
    expect(trailers).not.toMatch(/^Quality-Reviewer: (claude|codex|gemini)$/m);
  });

  it("rejects advisory review coverage above the low risk tier", () => {
    const root = repo("high-risk-advisory-review");
    const manifest = create(root);
    invocation.withManifestLock(manifest, (loaded) => {
      invocation.setRisk(loaded, {
        tier: "high",
        taskType: "bugfix",
        score: 60,
        agents: 2,
        "codex-depth": "high",
        "codex-rounds": 1,
      });
      invocation.setAgents(loaded, ["reviewer-a", "reviewer-b"]);
    });
    const result = spawnSync(
      "node",
      [
        INVOCATION,
        "record-advisory-review",
        manifest,
        "--failure-category",
        "provider-unavailable",
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/only at the low risk tier/);
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

  it("resolves named high review level accepted by manifest creation", () => {
    const root = repo("named-high-level");
    const manifest = create(root, ["--level", "high"]);

    expect(() =>
      execFileSync("bash", [RISK, "--manifest", manifest], { cwd: root }),
    ).not.toThrow();

    const risk = JSON.parse(readFileSync(manifest, "utf8")).risk;
    expect(risk).toMatchObject({
      requestedLevel: "high",
      resolved: true,
      tier: "high",
    });
  });

  it("records a deliberately reduced panel as incomplete and never authorizes it as full coverage", () => {
    const root = repo("reduced-panel");
    const manifestPath = create(root);
    invocation.withManifestLock(manifestPath, (manifest) => {
      invocation.setRisk(manifest, {
        tier: "high",
        taskType: "bugfix",
        score: 60,
        agents: 4,
        "codex-depth": "high",
        "codex-rounds": 1,
      });
      invocation.setAgents(manifest, ["reviewer-a", "reviewer-b"], {
        incomplete: true,
      });
    });

    prepareCodexReview(root, manifestPath);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const inventory = JSON.parse(
      readFileSync(
        path.join(manifest.reviews[0].artifactDir, "artifact-inventory.json"),
        "utf8",
      ),
    );
    expect(manifest.panel).toEqual({
      requiredAgents: 4,
      selectedAgents: 2,
      incomplete: true,
    });
    expect(manifest.reviews[0].incompletePanel).toBe(true);
    expect(inventory.panel).toEqual(manifest.panel);
    expect(() => invocation.reviewAuthorization(manifest)).toThrow(
      /incomplete reduced panel cannot satisfy merge review coverage/,
    );
  });

  it("persists a merge-train panel cap visibly through the selector seam", () => {
    const root = repo("reduced-panel-selector");
    const manifestPath = create(root);
    invocation.withManifestLock(manifestPath, (manifest) => {
      invocation.setRisk(manifest, {
        tier: "high",
        taskType: "bugfix",
        score: 60,
        agents: 4,
        "codex-depth": "high",
        "codex-rounds": 1,
      });
    });
    execFileSync("bash", [SELECT, "--manifest", manifestPath], {
      cwd: root,
      env: { ...process.env, BS_QUALITY_PANEL_AGENTS: "2" },
    });
    expect(JSON.parse(readFileSync(manifestPath, "utf8")).panel).toEqual({
      requiredAgents: 4,
      selectedAgents: 2,
      incomplete: true,
    });
  });

  it("refuses to reduce a critical panel through the selector seam", () => {
    const root = repo("critical-panel-selector");
    const manifestPath = create(root);
    invocation.withManifestLock(manifestPath, (manifest) => {
      invocation.setRisk(manifest, {
        tier: "critical",
        taskType: "bugfix",
        score: 80,
        agents: 4,
        "codex-depth": "xhigh",
        "codex-rounds": 1,
      });
    });
    const result = spawnSync("bash", [SELECT, "--manifest", manifestPath], {
      cwd: root,
      env: { ...process.env, BS_QUALITY_PANEL_AGENTS: "2" },
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(
      /critical reviews require the full 4-agent panel/,
    );
  });

  it("rejects a resumed HEAD whose complete diff requires stronger review", () => {
    const root = repo("risk-escalation");
    const manifest = create(root);
    execFileSync("bash", [RISK, "--manifest", manifest], { cwd: root });
    execFileSync("bash", [SELECT, "--manifest", manifest], { cwd: root });
    const before = JSON.parse(readFileSync(manifest, "utf8"));

    mkdirSync(path.join(root, "auth"), { recursive: true });
    writeFileSync(
      path.join(root, "auth/session.js"),
      "export const session = true;\n",
    );
    git(root, ["add", "auth/session.js"]);
    git(root, ["commit", "-q", "-m", "fix: add auth remediation"]);

    const result = spawnSync("node", [INVOCATION, "advance", manifest], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/stronger review.*fresh invocation/i);
    expect(
      JSON.parse(readFileSync(manifest, "utf8")).revisions.currentHead,
    ).toBe(before.revisions.currentHead);
  });

  it("rejects an underpowered persisted critical contract at the 75 boundary", () => {
    const root = repo("critical-boundary-escalation");
    const manifest = create(root);
    execFileSync("bash", [RISK, "--manifest", manifest], { cwd: root });
    const state = JSON.parse(readFileSync(manifest, "utf8"));
    state.risk = {
      ...state.risk,
      resolved: true,
      tier: "critical",
      score: 75,
      agentTarget: 2,
      codexDepth: "low",
      codexRounds: 0,
    };
    writeFileSync(manifest, `${JSON.stringify(state, null, 2)}\n`);

    mkdirSync(path.join(root, "server"), { recursive: true });
    writeFileSync(
      path.join(root, "server", "large.js"),
      `${Array.from({ length: 450 }, (_, index) => `export const v${index} = ${index};`).join("\n")}\n`,
    );
    git(root, ["add", "server/large.js"]);
    git(root, ["commit", "-q", "-m", "fix: add large server remediation"]);

    const result = spawnSync("node", [INVOCATION, "advance", manifest], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(
      /stronger review.*now critical\/6\/xhigh.*fresh invocation/i,
    );
  });

  it("rejects a same-HEAD manifest with a stale underpowered critical contract", () => {
    const root = repo("same-head-critical-boundary");
    mkdirSync(path.join(root, "auth"), { recursive: true });
    writeFileSync(
      path.join(root, "auth", "session.js"),
      "export const session = true;\n",
    );
    git(root, ["add", "auth/session.js"]);
    git(root, ["commit", "-q", "-m", "feat: add auth surface"]);

    const manifest = create(root);
    const state = JSON.parse(readFileSync(manifest, "utf8"));
    state.risk = {
      ...state.risk,
      resolved: true,
      tier: "critical",
      score: 75,
      agentTarget: 2,
      codexDepth: "low",
      codexRounds: 0,
    };
    writeFileSync(manifest, `${JSON.stringify(state, null, 2)}\n`);

    const result = spawnSync("node", [INVOCATION, "advance", manifest], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(
      /stronger review.*now critical\/6\/xhigh.*fresh invocation/i,
    );
    expect(() =>
      invocation.reviewAuthorization(
        JSON.parse(readFileSync(manifest, "utf8")),
      ),
    ).toThrow(/stronger review.*now critical\/6\/xhigh.*fresh invocation/i);
  });

  it("reapplies an explicit level-98 minimum when validating a stale same-HEAD contract", () => {
    const root = repo("same-head-level-98");
    const manifest = create(root, ["--level", "98"]);
    const state = JSON.parse(readFileSync(manifest, "utf8"));
    state.risk = {
      ...state.risk,
      requestedLevel: "98",
      resolved: true,
      tier: "critical",
      score: 75,
      agentTarget: 6,
      codexDepth: "high",
      codexRounds: 1,
    };
    writeFileSync(manifest, `${JSON.stringify(state, null, 2)}\n`);

    const result = spawnSync("node", [INVOCATION, "advance", manifest], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(
      /stronger review.*now critical\/6\/xhigh.*fresh invocation/i,
    );
  });

  it("fails a non-finite policy closed before validating a stale level-98 contract", () => {
    const root = mkdtempSync(path.join(tmpdir(), "quality-non-finite-policy-"));
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["config", "user.name", "Quality Test"]);
    git(root, ["config", "user.email", "quality@example.com"]);
    writeFileSync(path.join(root, "file.js"), "// before\n");
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: { lint: "true", test: "true", "security:audit": "true" },
      }),
    );
    writeFileSync(
      path.join(root, "harness-config.json"),
      JSON.stringify({
        scorePolicy: {
          mechanicalDelta: "not-a-number",
          curve: [{ maxScore: 100, agents: 6, codex: "high", codexRounds: 1 }],
        },
      }),
    );
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "base"]);
    git(root, ["remote", "add", "origin", root]);
    git(root, ["fetch", "-q", "origin", "main"]);
    git(root, ["switch", "-q", "-c", "feature"]);
    writeFileSync(path.join(root, "file.js"), "// after\n");
    git(root, ["commit", "-qam", "comment-only change"]);

    const manifest = create(root, ["--level", "98"]);
    const state = JSON.parse(readFileSync(manifest, "utf8"));
    state.risk = {
      ...state.risk,
      requestedLevel: "98",
      resolved: true,
      tier: "critical",
      score: 75,
      agentTarget: 6,
      codexDepth: "high",
      codexRounds: 1,
    };
    writeFileSync(manifest, `${JSON.stringify(state, null, 2)}\n`);

    const result = spawnSync("node", [INVOCATION, "advance", manifest], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/mechanicalDelta must be a finite number/i);
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
      /executable npm or Python repository gates for: lint, security/,
    );

    writeFileSync(path.join(root, "package.json"), JSON.stringify({}));
    git(root, ["commit", "-qam", "remove tests"]);
    expect(() => create(root)).toThrow(
      /executable npm or Python repository gates for: lint, security, test/,
    );
    expect(() => create(root, ["--skip-tests"])).toThrow(
      /executable npm or Python repository gates for: lint, security/,
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

    const boundedRoot = repo("critical-rounds-explicit-bound");
    const explicitlyBounded = create(boundedRoot, [], {
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
      { cwd: boundedRoot },
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
    recordMutationFixture(manifest);
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

  it("inventories preserved Codex findings with a complete Claude fallback panel", () => {
    const root = repo("fallback-inventory");
    const manifestPath = create(root);
    invocation.withManifestLock(manifestPath, (manifest) => {
      invocation.setRisk(manifest, {
        tier: "high",
        taskType: "bugfix",
        score: 60,
        agents: 2,
        "codex-depth": "high",
        "codex-rounds": 1,
      });
      invocation.setAgents(manifest, ["reviewer-a", "reviewer-b"]);
      manifest.provider.primary = "codex";
      manifest.provider.fallback = "claude";
    });
    const manifest = invocation.loadManifest(manifestPath).manifest;
    const artifactDir = invocation.reviewInfo(manifest).artifactDir;
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(
      path.join(artifactDir, "primary-codex-1.result.json"),
      JSON.stringify({
        verdict: "needs-attention",
        summary: "preserved primary pass",
        findings: [
          {
            severity: "high",
            title: "preserved primary finding",
            body: "must remain authoritative",
          },
        ],
      }),
    );
    writeFileSync(
      path.join(artifactDir, "reviewer-a.findings.txt"),
      "NO FINDINGS.\n",
    );
    writeFileSync(
      path.join(artifactDir, "reviewer-b.findings.txt"),
      "NO FINDINGS.\n",
    );

    expect(() =>
      invocation.writeArtifactInventory(manifest, artifactDir, "claude"),
    ).not.toThrow();
    const inventory = JSON.parse(
      readFileSync(path.join(artifactDir, "artifact-inventory.json"), "utf8"),
    );
    expect(inventory.provider).toBe("claude");
    expect(inventory.files).toEqual([
      expect.objectContaining({
        name: "primary-codex-1.result.json",
        provider: "codex",
      }),
      expect.objectContaining({
        name: "reviewer-a.findings.txt",
        provider: "claude",
      }),
      expect.objectContaining({
        name: "reviewer-b.findings.txt",
        provider: "claude",
      }),
    ]);

    writeFileSync(
      path.join(artifactDir, "reviewer-a.findings.txt"),
      "NO FINDINGS.\nINCONCLUSIVE: later pass\n",
    );
    expect(() =>
      invocation.writeArtifactInventory(manifest, artifactDir, "claude"),
    ).toThrow(/inconclusive provider findings/);
  });

  it("excludes stale fallback artifacts when a retry succeeds with Codex", () => {
    const root = repo("retry-inventory-provider-isolation");
    const manifestPath = create(root);
    invocation.withManifestLock(manifestPath, (manifest) => {
      invocation.setRisk(manifest, {
        tier: "high",
        taskType: "bugfix",
        score: 60,
        agents: 2,
        "codex-depth": "high",
        "codex-rounds": 1,
      });
      invocation.setAgents(manifest, ["reviewer-a", "reviewer-b"]);
    });
    const manifest = invocation.loadManifest(manifestPath).manifest;
    const artifactDir = invocation.reviewInfo(manifest).artifactDir;
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(
      path.join(artifactDir, "codex.findings.txt"),
      "NO FINDINGS.\n",
    );
    writeFileSync(
      path.join(artifactDir, "codex-1.normalized.json"),
      JSON.stringify({
        verdict: "approve",
        summary: "retry completed",
        findings: [],
      }),
    );
    writeFileSync(
      path.join(artifactDir, "reviewer-a.findings.txt"),
      "INCONCLUSIVE: stale fallback attempt\n",
    );
    writeFileSync(
      path.join(artifactDir, "reviewer-a.result.json"),
      JSON.stringify({ is_error: true }),
    );

    expect(() =>
      invocation.writeArtifactInventory(manifest, artifactDir, "codex"),
    ).not.toThrow();
    const inventory = JSON.parse(
      readFileSync(path.join(artifactDir, "artifact-inventory.json"), "utf8"),
    );
    expect(inventory.files.map((item) => item.name)).toEqual([
      "codex-1.normalized.json",
      "codex.findings.txt",
    ]);
  });

  it("attributes preserved primary evidence from the filename on a campaign's first round, before manifest.provider.primary is populated", () => {
    // recordReview() is what sets manifest.provider.primary, and it only
    // runs AFTER a review round completes. On a campaign's very first round
    // (primary fails mid-pass, fallback picks up), writeArtifactInventory
    // runs with manifest.provider.primary still unset — attribution must not
    // depend on it.
    const root = repo("fallback-inventory-first-round");
    const manifestPath = create(root);
    invocation.withManifestLock(manifestPath, (manifest) => {
      invocation.setRisk(manifest, {
        tier: "high",
        taskType: "bugfix",
        score: 60,
        agents: 2,
        "codex-depth": "high",
        "codex-rounds": 1,
      });
      invocation.setAgents(manifest, ["reviewer-a", "reviewer-b"]);
      // Deliberately NOT setting manifest.provider.primary — this is the
      // first-round state the real pipeline is in when inventory is written.
    });
    const manifest = invocation.loadManifest(manifestPath).manifest;
    expect(manifest.provider?.primary).toBeUndefined();
    const artifactDir = invocation.reviewInfo(manifest).artifactDir;
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(
      path.join(artifactDir, "primary-codex-1.result.json"),
      JSON.stringify({
        verdict: "needs-attention",
        summary: "preserved primary pass",
        findings: [
          {
            severity: "high",
            title: "preserved primary finding",
            body: "must remain authoritative",
          },
        ],
      }),
    );
    writeFileSync(
      path.join(artifactDir, "reviewer-a.findings.txt"),
      "NO FINDINGS.\n",
    );
    writeFileSync(
      path.join(artifactDir, "reviewer-b.findings.txt"),
      "NO FINDINGS.\n",
    );

    invocation.writeArtifactInventory(manifest, artifactDir, "claude");
    const inventory = JSON.parse(
      readFileSync(path.join(artifactDir, "artifact-inventory.json"), "utf8"),
    );
    expect(inventory.files).toContainEqual(
      expect.objectContaining({
        name: "primary-codex-1.result.json",
        provider: "codex",
      }),
    );
  });

  it("does not double-count a Gemini pass's findings between the raw and normalized JSON (not just Codex)", () => {
    // The raw-vs-normalized dedup filter in providerFindings() only matched
    // codex-(\d+)\.json, so a raw gemini-1.json and its gemini-1.normalized.json
    // sibling both got counted as separate findings sources — doubling every
    // Gemini finding. This mirrors the existing (implicit) Codex coverage from
    // prepareCodexReview, which always writes both codex-1.json and
    // codex-1.normalized.json and relies on the dedup to avoid double-counting.
    const root = repo("gemini-raw-normalized-dedup");
    const manifest = create(root);
    invocation.withManifestLock(manifest, (loaded) => {
      invocation.setRisk(loaded, {
        tier: "high",
        taskType: "bugfix",
        score: 60,
        agents: 2,
        "codex-depth": "high",
        "codex-rounds": 1,
      });
      invocation.setAgents(loaded, ["reviewer-a", "reviewer-b"]);
    });
    execFileSync("node", [GOVERNOR, "bump-round", manifest], { cwd: root });
    const loaded = invocation.loadManifest(manifest).manifest;
    const info = invocation.reviewInfo(loaded);
    mkdirSync(info.artifactDir, { recursive: true });
    writeFileSync(
      path.join(info.artifactDir, "diff.txt"),
      execFileSync("git", ["diff", `${info.from}..${info.to}`], { cwd: root }),
    );
    writeFileSync(
      path.join(info.artifactDir, "identity.json"),
      execFileSync("node", [INVOCATION, "review-identity", manifest], {
        cwd: root,
      }),
    );
    const geminiResult = {
      verdict: "needs-attention",
      summary: "gemini findings",
      findings: [{ severity: "high", title: "the one real finding" }],
    };
    writeFileSync(
      path.join(info.artifactDir, "gemini-1.json"),
      JSON.stringify(geminiResult),
    );
    writeFileSync(
      path.join(info.artifactDir, "gemini-1.normalized.json"),
      JSON.stringify(geminiResult),
    );
    writeFileSync(
      path.join(info.artifactDir, "gemini.findings.txt"),
      "HIGH: the one real finding\n",
    );
    writeFileSync(
      path.join(info.artifactDir, "reviewer-a.findings.txt"),
      "NO FINDINGS.\n",
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
        "gemini",
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
        manifest,
        "--from",
        info.from,
        "--to",
        info.to,
        "--provider",
        "gemini",
        "--primary",
        "gemini",
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
      recordGateFixture(manifest, name);
    }
    const context = JSON.parse(
      execFileSync("node", [INVOCATION, "judge-context", manifest], {
        cwd: root,
        encoding: "utf8",
      }),
    );
    expect(context.findings).toHaveLength(1);
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

  it("accepts documented no-findings marker variants from reviewers", () => {
    for (const [index, marker] of [
      "NO FINDINGS\n",
      "NO FINDINGS.\n",
      " no findings \n",
      "\tNo Findings.\t\r\n",
    ].entries()) {
      const root = repo(`clean-sentinel-${index}`);
      const manifest = create(root);
      prepareCodexReview(root, manifest, [], marker);
      const context = JSON.parse(
        execFileSync("node", [INVOCATION, "judge-context", manifest], {
          cwd: root,
          encoding: "utf8",
        }),
      );
      expect(context.findings).toEqual([]);
    }
  });

  it("BUI-463: delimited <<<NO FINDINGS>>> marker is authoritative regardless of preceding prose", () => {
    // Prose-based sentinel detection is structurally ambiguous — three
    // review rounds on earlier attempts confirmed real reviewers legitimately
    // preface, discuss, or quote the phrase "NO FINDINGS" without meaning it
    // as their verdict (e.g. explaining why a submodule bump has nothing to
    // review, or a self-referential review of this exact parsing logic).
    // The delimited marker is unambiguous by construction: reviewers are
    // instructed to emit it ONLY as an isolated final line, so its presence
    // is authoritative no matter what prose precedes it — no line-count or
    // substring heuristics needed.
    for (const [index, text] of [
      "<<<NO FINDINGS>>>",
      "Bare submodule pointer bump, nothing to review at this layer.\n\n<<<NO FINDINGS>>>",
      // Prose that itself discusses/quotes "NO FINDINGS" no longer matters —
      // only the delimited line is examined.
      'Reviewing the sentinel-detection logic: the marker "NO FINDINGS" must ' +
        "appear delimited, not as bare prose. No invalid-state issues found.\n\n" +
        "<<<NO FINDINGS>>>",
      "Full test suite passed. Review complete: NO FINDINGS.\n\n<<<NO FINDINGS>>>",
    ].entries()) {
      const root = repo(`delimited-clean-${index}`);
      const manifest = create(root);
      prepareCodexReview(root, manifest, [], text);
      const context = JSON.parse(
        execFileSync("node", [INVOCATION, "judge-context", manifest], {
          cwd: root,
          encoding: "utf8",
        }),
      );
      expect(context.findings).toEqual([]);
    }
  });

  it("BUI-463: delimited <<<FINDINGS REPORTED>>> marker is authoritative even if prose says NO FINDINGS", () => {
    const root = repo("delimited-findings-reported");
    const manifest = create(root);
    prepareCodexReview(
      root,
      manifest,
      [],
      "file.js:12 BLOCKING: retry loop never breaks on success.\n\n<<<FINDINGS REPORTED>>>",
    );
    const context = JSON.parse(
      execFileSync("node", [INVOCATION, "judge-context", manifest], {
        cwd: root,
        encoding: "utf8",
      }),
    );
    expect(context.findings).toHaveLength(1);
    expect(context.findings[0].severity).toBe("blocking");
    // The delimiter line itself must not leak into the finding body shown
    // to a human or the judge.
    expect(context.findings[0].body).not.toContain("<<<FINDINGS REPORTED>>>");
  });

  it("BUI-521: a bare <<<FINDINGS REPORTED>>> is malformed output, not a blocking finding", () => {
    // Supersedes the BUI-463 assertion that this shape must yield a
    // non-empty finding body. That framing asked "is the body empty?" when
    // the real question was "should a finding exist at all?" — six agents
    // converged on the narrower question and shipped the bug.
    //
    // Falling back to the raw text made a BLOCKING finding whose entire body
    // was the sentinel. Unfixable by construction: the campaign reports
    // "actionable code findings remain" with nothing to act on, so it never
    // converges and never merges (191 such phantom findings across 10+ PRs
    // locally, incl. merged #633/#638). It also scored a malformed response
    // as a caught defect in precision telemetry.
    //
    // Correct handling is the existing inconclusive path: still fail closed,
    // but with a diagnosis that names the real problem and has a retry route.
    const root = repo("bare-findings-reported-delimiter-only");
    const manifest = create(root);
    prepareCodexReview(root, manifest, [], "<<<FINDINGS REPORTED>>>");
    let stderr = "";
    expect(() => {
      try {
        execFileSync("node", [INVOCATION, "judge-context", manifest], {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (err) {
        stderr = err.stderr || "";
        throw err;
      }
    }).toThrow();
    // Named as inconclusive/malformed — NOT as an actionable code finding.
    expect(stderr).toMatch(/inconclusive provider findings/);
    expect(stderr).toMatch(/wrote no finding text/);
  });

  it("BUI-463: stripping the delimiter preserves paragraph breaks between multiple findings", () => {
    // 3 review agents converged on this: the earlier fix rebuilt the body
    // from a blank-line-FILTERED array, which silently collapsed paragraph
    // spacing between separate findings into a run-on block. The delimiter
    // must be stripped from the original line array instead.
    const root = repo("multi-finding-body-preserves-blank-lines");
    const manifest = create(root);
    prepareCodexReview(
      root,
      manifest,
      [],
      [
        "file.js:12 BLOCKING: issue one.",
        "",
        "file.js:30 BLOCKING: issue two.",
        "",
        "<<<FINDINGS REPORTED>>>",
      ].join("\n"),
    );
    const context = JSON.parse(
      execFileSync("node", [INVOCATION, "judge-context", manifest], {
        cwd: root,
        encoding: "utf8",
      }),
    );
    expect(context.findings).toHaveLength(1);
    expect(context.findings[0].body).toBe(
      "file.js:12 BLOCKING: issue one.\n\nfile.js:30 BLOCKING: issue two.",
    );
  });

  it("BUI-463: only the ACTUAL final line is authoritative, not any earlier mention of either marker", () => {
    // 4 independent review agents converged on this exact bug in an earlier
    // version of this fix: checking marker presence "anywhere in the text"
    // let permitted pre-delimiter commentary that quotes/discusses the
    // marker override the real, later verdict. Only the true final line
    // counts.
    const root = repo("both-markers-present-final-line-wins");
    const manifest = create(root);
    prepareCodexReview(
      root,
      manifest,
      [],
      [
        "Explaining the sign-off convention: reviewers emit <<<NO FINDINGS>>>",
        "when clean, or <<<FINDINGS REPORTED>>> when not.",
        "",
        "file.js:12 BLOCKING: retry loop never breaks on success.",
        "<<<FINDINGS REPORTED>>>",
      ].join("\n"),
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

  it("BUI-463: a mention of <<<NO FINDINGS>>> that is not the final line does not suppress a real finding", () => {
    const root = repo("no-findings-marker-mentioned-not-final");
    const manifest = create(root);
    prepareCodexReview(
      root,
      manifest,
      [],
      [
        "This diff introduces the <<<NO FINDINGS>>> delimiter as an example.",
        "file.js:12 BLOCKING: retry loop never breaks on success.",
        "<<<FINDINGS REPORTED>>>",
      ].join("\n"),
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

  it("BUI-463: legacy bare sentinel with no preamble still classifies clean (pre-delimiter compat)", () => {
    const root = repo("legacy-bare-sentinel");
    const manifest = create(root);
    prepareCodexReview(root, manifest, [], "NO FINDINGS\n");
    const context = JSON.parse(
      execFileSync("node", [INVOCATION, "judge-context", manifest], {
        cwd: root,
        encoding: "utf8",
      }),
    );
    expect(context.findings).toEqual([]);
  });

  it("BUI-463: legacy text without a delimiter or bare sentinel still flags as a finding", () => {
    const root = repo("legacy-real-finding-no-delimiter");
    const manifest = create(root);
    prepareCodexReview(
      root,
      manifest,
      [],
      "Found an issue: the retry loop never breaks on success.\n",
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
    recordMutationFixture(manifest);
    expect(() =>
      execFileSync("node", [INVOCATION, "review-authorization", manifest], {
        cwd: root,
      }),
    ).not.toThrow();
    expect(JSON.parse(readFileSync(manifest, "utf8")).requiredGates).toEqual(
      required,
    );
  });

  it("discovers security:check without requiring a redundant security alias", () => {
    const root = repo("security-check-gate");
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: {
          lint: "true",
          test: "true",
          "security:check": "node --check file.js",
        },
      }),
    );
    git(root, ["add", "package.json"]);
    git(root, ["commit", "-q", "-m", "use repository security convention"]);

    const manifest = create(root);
    expect(
      JSON.parse(readFileSync(manifest, "utf8")).requiredGates.find(
        (gate) => gate.name === "security",
      ),
    ).toMatchObject({
      source: "package-script:security:check",
      args: ["run", "security:check"],
    });
  });

  it("uses deterministic security gate precedence", () => {
    const root = repo("security-gate-precedence");
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: {
          lint: "true",
          test: "true",
          security: "true",
          "security:check": "true",
          "security:audit": "true",
        },
      }),
    );
    git(root, ["add", "package.json"]);
    git(root, ["commit", "-q", "-m", "define security candidates"]);

    const manifest = create(root);
    expect(
      JSON.parse(readFileSync(manifest, "utf8")).requiredGates.find(
        (gate) => gate.name === "security",
      ).source,
    ).toBe("package-script:security:audit");
  });

  it("discovers and executes committed native repository gates without a package manifest", () => {
    const root = repo("native-repository-gates");
    unlinkSync(path.join(root, "package.json"));
    writeFileSync(
      path.join(root, ".quality-gates.json"),
      JSON.stringify({
        version: 1,
        gates: {
          lint: {
            executable: "node",
            args: ["--check", "file.js"],
          },
          test: {
            executable: "node",
            args: [
              "-e",
              "require('node:fs').writeFileSync('native-test-ran', 'yes')",
            ],
          },
          security: {
            executable: "node",
            args: ["--check", "file.js"],
          },
        },
      }),
    );
    git(root, ["add", ".quality-gates.json"]);
    git(root, ["rm", "package.json"]);
    git(root, ["commit", "-q", "-m", "declare native quality gates"]);

    const manifest = create(root);
    const required = JSON.parse(readFileSync(manifest, "utf8")).requiredGates;
    expect(required.map((gate) => gate.name)).toEqual([
      "lint",
      "test",
      "security",
    ]);
    expect(required.find((gate) => gate.name === "test")).toMatchObject({
      source: "quality-gates:.quality-gates.json#test",
      executable: "node",
      args: [
        "-e",
        "require('node:fs').writeFileSync('native-test-ran', 'yes')",
      ],
    });

    execFileSync("node", [INVOCATION, "gate-run", manifest, "--name", "test"], {
      cwd: root,
    });
    expect(readFileSync(path.join(root, "native-test-ran"), "utf8")).toBe(
      "yes",
    );
  });

  it("rejects shell-command strings in native repository gate policy", () => {
    const root = repo("invalid-native-repository-gates");
    unlinkSync(path.join(root, "package.json"));
    writeFileSync(
      path.join(root, ".quality-gates.json"),
      JSON.stringify({
        version: 1,
        gates: {
          lint: { command: "node --check file.js" },
          test: { executable: "node", args: ["--test"] },
          security: { executable: "node", args: ["--check", "file.js"] },
        },
      }),
    );
    git(root, ["add", ".quality-gates.json"]);
    git(root, ["rm", "package.json"]);
    git(root, ["commit", "-q", "-m", "declare unsafe native gate"]);

    expect(() => create(root)).toThrow(
      /\.quality-gates\.json gate 'lint' requires a non-empty executable and string args array/,
    );
  });

  it("uses explicitly declared native gates ahead of package-script fallbacks", () => {
    const root = repo("native-gate-precedence");
    const packageJson = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8"),
    );
    packageJson.scripts.build = "node --check file.js";
    writeFileSync(path.join(root, "package.json"), JSON.stringify(packageJson));
    writeFileSync(
      path.join(root, ".quality-gates.json"),
      JSON.stringify({
        version: 1,
        gates: {
          test: { executable: "node", args: ["--test", "file.js"] },
          build: { executable: "node", args: ["--check", "native-build.js"] },
        },
      }),
    );
    git(root, ["add", ".quality-gates.json", "package.json"]);
    git(root, ["commit", "-q", "-m", "select native quality gates"]);

    const manifest = create(root);
    const required = JSON.parse(readFileSync(manifest, "utf8")).requiredGates;
    expect(required.find((gate) => gate.name === "test")).toMatchObject({
      source: "quality-gates:.quality-gates.json#test",
      executable: "node",
      args: ["--test", "file.js"],
    });
    expect(required.find((gate) => gate.name === "build")).toMatchObject({
      source: "quality-gates:.quality-gates.json#build",
      executable: "node",
      args: ["--check", "native-build.js"],
    });
  });

  it("discovers executable Python gates when package scripts are absent", () => {
    const root = repo("python-gate-discovery");
    git(root, ["rm", "package.json"]);
    writeFileSync(
      path.join(root, "pyproject.toml"),
      "[tool.ruff]\n\n[tool.pytest.ini_options]\n\n[tool.mypy]\n",
    );
    writeFileSync(path.join(root, "requirements-dev.txt"), "pytest==9.0.2\n");
    mkdirSync(path.join(root, "tests"));
    writeFileSync(
      path.join(root, "tests", "test_example.py"),
      "def test_ok():\n  assert True\n",
    );
    git(root, [
      "add",
      "pyproject.toml",
      "requirements-dev.txt",
      "tests/test_example.py",
    ]);
    git(root, ["commit", "-q", "-m", "add Python quality gates"]);

    const manifest = create(root);
    const required = JSON.parse(readFileSync(manifest, "utf8")).requiredGates;
    expect(required).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "lint",
          source: "python:ruff",
          executable: "ruff",
          args: ["check", "."],
        }),
        expect.objectContaining({
          name: "test",
          source: "python:pytest",
          executable: "pytest",
          args: [],
        }),
        expect.objectContaining({
          name: "security",
          source: "python:pip-audit",
          executable: "pip-audit",
          args: ["."],
        }),
        expect.objectContaining({
          name: "type",
          source: "python:mypy",
          executable: "mypy",
          args: ["."],
        }),
      ]),
    );
  });

  it.each([
    ["uv.lock", "uv"],
    ["poetry.lock", "poetry"],
  ])(
    "runs inferred Python tools through the %s project environment",
    (lockfile, executable) => {
      const root = repo(`managed-python-${executable}-gate-discovery`);
      git(root, ["rm", "package.json"]);
      writeFileSync(
        path.join(root, "pyproject.toml"),
        "[tool.ruff]\n\n[tool.pytest.ini_options]\n\n[tool.mypy]\n",
      );
      writeFileSync(path.join(root, lockfile), "version = 1\n");
      mkdirSync(path.join(root, "tests"));
      writeFileSync(
        path.join(root, "tests", "test_example.py"),
        "def test_ok():\n  assert True\n",
      );
      git(root, ["add", "pyproject.toml", lockfile, "tests/test_example.py"]);
      git(root, ["commit", "-q", "-m", "add managed Python quality gates"]);

      const manifest = create(root);
      const required = JSON.parse(readFileSync(manifest, "utf8")).requiredGates;
      expect(required).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "lint",
            executable,
            args: ["run", "ruff", "check", "."],
          }),
          expect.objectContaining({
            name: "test",
            executable,
            args: ["run", "pytest"],
          }),
          expect.objectContaining({
            name: "security",
            executable,
            args: ["run", "pip-audit", "."],
          }),
          expect.objectContaining({
            name: "type",
            executable,
            args: ["run", "mypy", "."],
          }),
        ]),
      );
    },
  );

  it("binds inferred Python security gates to committed requirements", () => {
    const root = repo("python-requirements-security-gate");
    git(root, ["rm", "package.json"]);
    writeFileSync(path.join(root, "requirements.txt"), "requests==2.32.4\n");
    writeFileSync(
      path.join(root, ".quality-gates.json"),
      JSON.stringify({
        version: 1,
        gates: {
          lint: { executable: "python3", args: ["-m", "compileall", "."] },
          test: { executable: "python3", args: ["-m", "unittest"] },
        },
      }),
    );
    git(root, ["add", "requirements.txt", ".quality-gates.json"]);
    git(root, ["commit", "-q", "-m", "add requirements security gate"]);

    const manifest = create(root);
    expect(
      JSON.parse(readFileSync(manifest, "utf8")).requiredGates.find(
        (gate) => gate.name === "security",
      ),
    ).toMatchObject({
      source: "python:pip-audit",
      executable: "pip-audit",
      args: ["-r", "requirements.txt"],
    });
  });

  it("does not invent Python gates from a non-Python tests directory", () => {
    const root = repo("non-python-gate-discovery");
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: {
          lint: "true",
          "security:audit": "true",
        },
      }),
    );
    mkdirSync(path.join(root, "tests"));
    writeFileSync(path.join(root, "tests", "example.test.js"), "// test\n");
    writeFileSync(path.join(root, "tests", "example.py"), "# fixture\n");
    writeFileSync(path.join(root, "requirements.txt"), "requests==2.32.4\n");
    git(root, [
      "add",
      "package.json",
      "requirements.txt",
      "tests/example.test.js",
      "tests/example.py",
    ]);
    git(root, ["commit", "-q", "-m", "add JavaScript tests"]);

    expect(() => create(root)).toThrow(
      /executable npm or Python repository gates for: test/,
    );
  });

  it("prefers package scripts over Python fallbacks for mixed repositories", () => {
    const root = repo("python-gate-precedence");
    writeFileSync(path.join(root, "pyproject.toml"), "[tool.ruff]\n");
    git(root, ["add", "pyproject.toml"]);
    git(root, ["commit", "-q", "-m", "add Python tooling"]);

    const manifest = create(root);
    const required = JSON.parse(readFileSync(manifest, "utf8")).requiredGates;
    expect(required.find((gate) => gate.name === "lint").source).toBe(
      "package-script:lint",
    );
    expect(required.find((gate) => gate.name === "security").source).toBe(
      "package-script:security:audit",
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
  }, 30_000);

  it("allows a slow gate to finish within its declared check reserve", () => {
    const root = repo("gate-check-reserve");
    const marker = path.join(tmpdir(), `quality-slow-gate-${process.pid}`);
    const gateScript = path.join(root, "gate-slow.sh");
    writeFileSync(
      gateScript,
      '#!/usr/bin/env bash\nsleep 2\nprintf passed > "$QUALITY_GATE_MARKER"\n',
    );
    chmodSync(gateScript, 0o755);
    const packageFile = path.join(root, "package.json");
    const packageJson = JSON.parse(readFileSync(packageFile, "utf8"));
    packageJson.scripts.build = "bash gate-slow.sh";
    writeFileSync(packageFile, JSON.stringify(packageJson));
    git(root, ["add", "gate-slow.sh", "package.json"]);
    git(root, ["commit", "-q", "-m", "add slow gate"]);
    const manifestPath = create(root);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.risk.runtime = { checkSeconds: 1, checkReserveSeconds: 2 };
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
    expect(result.status).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("passed");
    const updated = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(updated.governor.gateSecondsUsed).toBeGreaterThanOrEqual(2);
    expect(updated.governor.gateSecondsUsed).toBeLessThanOrEqual(3);
    expect(updated.governor.activeExecution).toBeNull();
    unlinkSync(marker);
  }, 30_000);

  it("shares one execution budget across the complete gate suite", () => {
    const root = repo("gate-shared-budget");
    const gateScript = path.join(root, "gate-too-slow.sh");
    writeFileSync(gateScript, "#!/usr/bin/env bash\nsleep 3\n");
    chmodSync(gateScript, 0o755);
    const packageFile = path.join(root, "package.json");
    const packageJson = JSON.parse(readFileSync(packageFile, "utf8"));
    packageJson.scripts.build = "bash gate-too-slow.sh";
    writeFileSync(packageFile, JSON.stringify(packageJson));
    git(root, ["add", "gate-too-slow.sh", "package.json"]);
    git(root, ["commit", "-q", "-m", "add validation gate"]);
    const manifestPath = create(root);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.risk.runtime = { checkSeconds: 1, checkReserveSeconds: 2 };
    manifest.governor.gateSecondsLimit = 2;
    manifest.governor.gateSecondsUsed = 0;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const result = spawnSync(
      "bash",
      [RUN_GATE, "--manifest", manifestPath, "--name", "build"],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/exceeded its proportional 2s budget/);
    const updated = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(updated.governor.gateSecondsUsed).toBe(2);
    expect(updated.governor.activeExecution).toBeNull();
  }, 30_000);

  it("requires explicit revalidation after lifecycle inactivity", () => {
    const root = repo("lifecycle-stale");
    const manifestPath = create(root);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.governor.lifecycleTTLSeconds = 60;
    manifest.governor.lastActivityAt = new Date(
      Date.now() - 61_000,
    ).toISOString();
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const stale = spawnSync(
      "node",
      [INVOCATION, "gate-plan", manifestPath, "--name", "lint"],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    expect(stale.status).not.toBe(0);
    expect(stale.stderr).toMatch(/resume through bootstrap to revalidate/);

    expect(
      execFileSync(
        "node",
        [INVOCATION, "field", manifestPath, "repo.realpath"],
        {
          cwd: root,
          encoding: "utf8",
        },
      ).trim(),
    ).toBe(realpathSync(root));
    const staleAuthorization = spawnSync(
      "node",
      [INVOCATION, "review-authorization", manifestPath],
      { cwd: root, encoding: "utf8" },
    );
    expect(staleAuthorization.status).not.toBe(0);
    expect(staleAuthorization.stderr).toMatch(
      /resume through bootstrap to revalidate/,
    );

    execFileSync("bash", [BOOTSTRAP, "--manifest", manifestPath], {
      cwd: root,
    });
    const resumed = spawnSync(
      "node",
      [INVOCATION, "gate-plan", manifestPath, "--name", "lint"],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    expect(resumed.status).toBe(0);
  });

  it("requires a fresh campaign for a legacy wall-clock manifest", () => {
    const root = repo("legacy-execution-budget");
    const manifestPath = create(root);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    delete manifest.governor.executionBudgetVersion;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    expect(
      execFileSync(
        "node",
        [INVOCATION, "field", manifestPath, "repo.realpath"],
        {
          cwd: root,
          encoding: "utf8",
        },
      ).trim(),
    ).toBe(realpathSync(root));
    const resume = spawnSync("node", [INVOCATION, "advance", manifestPath], {
      cwd: root,
      encoding: "utf8",
    });
    expect(resume.status).not.toBe(0);
    expect(resume.stderr).toMatch(
      /legacy manifest cannot reconstruct active execution usage/,
    );
  });

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

describe("human-floor-check command (Phase 0 autonomy relaxation)", () => {
  // Build a repo whose feature branch changes exactly `changedFile`.
  // Exit-code contract: 0 = VERIFIED CLEAR (autonomous OK); 10 = touches floor;
  // any other code (error) = human required. Only rc 0 unlocks autonomy.
  function repoChanging(label, changedFile, scorePolicy = null) {
    const root = mkdtempSync(path.join(tmpdir(), `hfloor-${label}-`));
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["config", "user.name", "Quality Test"]);
    git(root, ["config", "user.email", "quality@example.com"]);
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: { lint: "true", test: "true", "security:audit": "true" },
      }),
    );
    const target = path.join(root, changedFile);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "base\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "base"]);
    git(root, ["remote", "add", "origin", root]);
    git(root, ["fetch", "-q", "origin", "main"]);
    git(root, ["switch", "-q", "-c", "feature"]);
    writeFileSync(target, "changed\n");
    if (scorePolicy) {
      writeFileSync(
        path.join(root, "harness-config.json"),
        JSON.stringify({ scorePolicy }),
      );
    }
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "change"]);
    return { root, manifest: create(root) };
  }

  const rc = (root, manifest) =>
    spawnSync("node", [INVOCATION, "human-floor-check", manifest], {
      cwd: root,
    }).status;

  it("exits 0 (verified clear) for an ordinary script", () => {
    const { root, manifest } = repoChanging("clear", "scripts/util.sh");
    expect(rc(root, manifest)).toBe(0);
  });

  it("exits 10 for a key file", () => {
    const { root, manifest } = repoChanging("pem", "keys/server.pem");
    expect(rc(root, manifest)).toBe(10);
  });

  it("exits 10 for an uppercase-cased key (case-insensitive)", () => {
    const { root, manifest } = repoChanging("upper", "Keys/Server.PEM");
    expect(rc(root, manifest)).toBe(10);
  });

  it("exits 10 for an auth dir change", () => {
    const { root, manifest } = repoChanging("auth", "src/auth/session.js");
    expect(rc(root, manifest)).toBe(10);
  });

  it("exits 10 when the reviewed commit tries to erase the built-in floor", () => {
    const { root, manifest } = repoChanging("self-disarm", "keys/server.pem", {
      humanFloor: [],
    });
    expect(rc(root, manifest)).toBe(10);
  });

  const sensitiveDirectories = [
    "secrets/aws.json",
    "credentials/cloud.json",
    "passwords/admin.txt",
    "tokens/api.json",
    "webhooks/receive.js",
    "license/policy.js",
    "licensing/policy.js",
    "deployments/ship.sh",
    "keystore/config.json",
    "keystores/config.json",
    "keyring/config.json",
    "keychain/config.json",
  ];
  for (const changedFile of sensitiveDirectories) {
    it(`exits 10 for sensitive directory path ${changedFile}`, () => {
      const label = changedFile.replace(/[^a-z]/gi, "-");
      const { root, manifest } = repoChanging(label, changedFile);
      expect(rc(root, manifest)).toBe(10);
    });
  }

  it("exits 10 when a sensitive file is RENAMED out of a floor path", () => {
    // auth/login.js -> login.js. --no-renames must surface the old auth/ path.
    const root = mkdtempSync(path.join(tmpdir(), "hfloor-rename-"));
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["config", "user.name", "Quality Test"]);
    git(root, ["config", "user.email", "quality@example.com"]);
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: { lint: "true", test: "true", "security:audit": "true" },
      }),
    );
    mkdirSync(path.join(root, "auth"), { recursive: true });
    writeFileSync(path.join(root, "auth/login.js"), "export const x = 1;\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "base"]);
    git(root, ["remote", "add", "origin", root]);
    git(root, ["fetch", "-q", "origin", "main"]);
    git(root, ["switch", "-q", "-c", "feature"]);
    git(root, ["mv", "auth/login.js", "login.js"]);
    git(root, ["commit", "-qam", "move auth out"]);
    const manifest = create(root);
    expect(rc(root, manifest)).toBe(10);
  });

  it("FAILS CLOSED (not 0) when the check errors — error must not unlock autonomy", () => {
    // Tampered manifest (currentHead ≠ real HEAD) makes the loader throw →
    // top-level exit 1. Autonomy is reachable ONLY on exit 0.
    const { root, manifest } = repoChanging("err", "scripts/util.sh");
    const m = JSON.parse(readFileSync(manifest, "utf8"));
    m.revisions.currentHead = m.revisions.baseSha;
    writeFileSync(manifest, `${JSON.stringify(m, null, 2)}\n`);
    expect(rc(root, manifest)).not.toBe(0);
  });

  it("FAILS CLOSED when harness-config.json is malformed", () => {
    const { root, manifest } = repoChanging(
      "malformed-policy",
      "scripts/util.sh",
    );
    writeFileSync(path.join(root, "harness-config.json"), "{ not json");
    expect(rc(root, manifest)).not.toBe(0);
  });
});
