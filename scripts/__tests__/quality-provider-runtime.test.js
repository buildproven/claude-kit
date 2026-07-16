import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const PLAN = path.join(ROOT, "scripts", "quality-review-plan.sh");
const BOUNDED = path.join(ROOT, "scripts", "quality-run-bounded.sh");
const LOAD_ROOT = path.join(ROOT, "scripts", "quality-load-root.sh");
const VALIDATOR = path.join(
  ROOT,
  "scripts",
  "quality-validate-review-trailers.sh",
);
const RUN_REVIEW = path.join(ROOT, "scripts", "quality-run-review.sh");
const NORMALIZE_CODEX_REVIEW = path.join(
  ROOT,
  "scripts",
  "quality-normalize-codex-review.sh",
);
const BOOTSTRAP = path.join(ROOT, "scripts", "quality-bootstrap.sh");
const REFERENCE = path.join(ROOT, "skills", "quality", "reference.md");

describe("provider review runtime", () => {
  it.each([
    ["low", "120", "Focused"],
    ["medium", "300", "Broad"],
    ["high", "480", "Deep adversarial"],
    ["critical", "600", "release-veto"],
  ])("maps %s to a mechanical review plan", (tier, timeout, focus) => {
    const result = spawnSync(
      "bash",
      [
        "-c",
        `TIER="$1"; source "$2"; printf '%s|%s' "$QUALITY_REVIEW_TIMEOUT" "$QUALITY_REVIEW_FOCUS"`,
        "plan",
        tier,
        PLAN,
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`${timeout}|`);
    expect(result.stdout).toContain(focus);
  });

  it("documents and initializes one 15-minute absolute default deadline", () => {
    const bootstrap = readFileSync(BOOTSTRAP, "utf8");
    const reference = readFileSync(REFERENCE, "utf8");
    expect(bootstrap).toContain(
      'BS_QUALITY_MAX_WALL_SECONDS="${BS_QUALITY_MAX_WALL_SECONDS:-900}"',
    );
    expect(bootstrap).toContain('"deadline_epoch": ${GOVERNOR_DEADLINE_EPOCH}');
    expect(reference).toMatch(/default 900 = 15 min/);
    expect(reference).not.toMatch(/default 1800 = 30 min/);
  });

  it("kills a hanging provider process group at the wall-clock cap", () => {
    const started = Date.now();
    const result = spawnSync(
      "bash",
      [BOUNDED, "--timeout", "1", "--", "bash", "-c", "sleep 20 & wait"],
      { encoding: "utf8", timeout: 5000 },
    );
    expect(result.status).toBe(124);
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it("clamps a stage to the governor's shared remaining budget", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "quality-deadline-"));
    const governor = path.join(dir, "governor.json");
    const start = Math.floor(Date.now() / 1000);
    writeFileSync(
      governor,
      JSON.stringify({
        start_epoch: start,
        deadline_epoch: start + 1,
        max_wall_seconds: 1,
      }),
    );
    const started = Date.now();
    const result = spawnSync(
      "bash",
      [
        BOUNDED,
        "--governor",
        governor,
        "--cap",
        "20",
        "--",
        "bash",
        "-c",
        "sleep 20",
      ],
      { encoding: "utf8", timeout: 5000 },
    );
    expect(result.status).toBe(124);
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it("honors a single scorer-selected xhigh discovery pass", () => {
    const result = spawnSync(
      "bash",
      [
        "-c",
        `TIER=critical CODEX_DEPTH=xhigh CODEX_ROUNDS=1; source "$1"; printf '%s|%s' "$QUALITY_REVIEW_DEPTH" "$QUALITY_REVIEW_PASSES"`,
        "plan",
        PLAN,
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("xhigh|1");
  });

  it("kills the provider tree when the wrapper itself is cancelled", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bounded-cancel-"));
    const pidFile = path.join(dir, "child.pid");
    const script = `
"$1" --timeout 20 -- bash -c 'trap "" TERM; echo $$ > "$1"; while :; do sleep 1; done' child "$2" &
wrapper=$!
while [ ! -s "$2" ]; do sleep 0.05; done
child=$(cat "$2")
kill -TERM "$wrapper"
wait "$wrapper" 2>/dev/null || true
sleep 0.2
if kill -0 "$child" 2>/dev/null; then exit 99; fi
`;
    const result = spawnSync(
      "bash",
      ["-c", script, "cancel", BOUNDED, pidFile],
      {
        encoding: "utf8",
        timeout: 5000,
      },
    );
    expect(result.status).toBe(0);
  });

  it("names state by Codex thread when no Claude session exists", () => {
    const result = spawnSync(
      "bash",
      [
        "-c",
        `unset CLAUDE_CODE_SESSION_ID; CODEX_THREAD_ID=codex-thread-42; source "$1"; bs_quality_root_file "$2"`,
        "state",
        LOAD_ROOT,
        ROOT,
      ],
      { encoding: "utf8", cwd: ROOT },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("bs-quality-gitroot-codex-thread-42-");
  });

  it.each(["bash", "zsh"])(
    "restores root and governor state in a fresh %s shell",
    (shell) => {
      const result = spawnSync(
        shell,
        [
          "-c",
          `source "$1"; printf '%s|%s|%s' "$GIT_ROOT" "$BS_QUALITY_ROOT_FILE" "$BS_QUALITY_GOVERNOR_FILE"`,
          "state",
          LOAD_ROOT,
        ],
        { encoding: "utf8", cwd: ROOT },
      );
      if (result.error?.code === "ENOENT") return;
      expect(result.status).toBe(0);
      const [gitRoot, rootFile, governorFile] = result.stdout.split("|");
      expect(gitRoot).toBe(ROOT);
      expect(rootFile).toContain("bs-quality-gitroot-");
      expect(governorFile).toBe(rootFile.replace(/\.txt$/, "-governor.json"));
    },
  );

  it("uses target scripts only in explicit trusted-development mode", () => {
    const trusted = mkdtempSync(path.join(tmpdir(), "trusted-kit-"));
    const trustedScripts = path.join(trusted, "scripts");
    spawnSync("mkdir", ["-p", trustedScripts]);
    writeFileSync(path.join(trustedScripts, "risk-score.js"), "trusted\n");
    const result = spawnSync(
      "bash",
      [
        "-c",
        `CLAUDE_KIT_ROOT="$2"; source "$1"; bs_quality_find_script risk-score.js; printf '\\n'; BS_QUALITY_TRUST_TARGET_SCRIPTS=true; bs_quality_find_script risk-score.js`,
        "resolution",
        LOAD_ROOT,
        trusted,
      ],
      { encoding: "utf8", cwd: ROOT },
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual([
      path.join(trustedScripts, "risk-score.js"),
      path.join(ROOT, "scripts", "risk-score.js"),
    ]);
  });

  it("accepts exact evidence, then rejects later code and contradictions", () => {
    const repo = mkdtempSync(path.join(tmpdir(), "review-evidence-"));
    const setup = spawnSync(
      "bash",
      [
        "-c",
        `
git init -q -b main "$1"
cd "$1"
git config user.name test
git config user.email test@example.com
echo base > file; git add file; git commit -q -m base
base=$(git rev-parse HEAD)
git switch -q -c feature
echo change >> file; git commit -qam change
reviewed=$(git rev-parse HEAD)
git commit -q --allow-empty -m "chore: stamp

Reviewed-By: quality (tier=high, reviewer=codex, primary=codex, fallback=claude, findings=0, head=$reviewed, base=$base)
Reviewed-By: codex (tier=high, findings=0, head=$reviewed, base=$base)"
`,
        "setup",
        repo,
      ],
      { encoding: "utf8" },
    );
    expect(setup.status).toBe(0);
    expect(spawnSync("bash", [VALIDATOR, "main"], { cwd: repo }).status).toBe(
      0,
    );

    spawnSync("bash", ["-c", "echo later >> file; git commit -qam later"], {
      cwd: repo,
    });
    expect(
      spawnSync("bash", [VALIDATOR, "main"], { cwd: repo }).status,
    ).not.toBe(0);

    spawnSync("git", ["reset", "--hard", "HEAD~2"], { cwd: repo });
    const reviewed = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repo,
      encoding: "utf8",
    }).stdout.trim();
    const base = spawnSync("git", ["merge-base", "HEAD", "main"], {
      cwd: repo,
      encoding: "utf8",
    }).stdout.trim();
    const malicious = `code-bearing stamp

Reviewed-By: quality (tier=high, reviewer=codex, primary=codex, fallback=claude, findings=0, head=${reviewed}, base=${base})
Reviewed-By: codex (tier=high, findings=0, head=${reviewed}, base=${base})`;
    spawnSync("bash", ["-c", "echo unreviewed >> file; git add file"], {
      cwd: repo,
    });
    spawnSync("git", ["commit", "-q", "-m", malicious], { cwd: repo });
    expect(
      spawnSync("bash", [VALIDATOR, "main"], { cwd: repo }).status,
    ).not.toBe(0);

    spawnSync("git", ["reset", "--hard", "HEAD~1"], { cwd: repo });
    const correct = malicious.replace("code-bearing stamp", "empty stamp");
    spawnSync("git", ["commit", "--allow-empty", "-q", "-m", correct], {
      cwd: repo,
    });
    const message = spawnSync("git", ["log", "-1", "--format=%B"], {
      cwd: repo,
      encoding: "utf8",
    }).stdout.replace("findings=0, head=", "findings=9, head=");
    spawnSync(
      "git",
      ["commit", "--amend", "--allow-empty", "-q", "-m", message],
      { cwd: repo },
    );
    expect(
      spawnSync("bash", [VALIDATOR, "main"], { cwd: repo }).status,
    ).not.toBe(0);
  }, 15000);

  it("passes scorer effort and exact round count to Codex mechanically", () => {
    const source = spawnSync("cat", [RUN_REVIEW], { encoding: "utf8" }).stdout;
    expect(source).toMatch(
      /while \[ "\$pass" -le "\$QUALITY_REVIEW_PASSES" \]/,
    );
    expect(source).toMatch(/model_reasoning_effort=.*QUALITY_REVIEW_DEPTH/);
    expect(source).toMatch(/codex exec --ephemeral -s read-only/);
    expect(source).toMatch(/record_provider_exhaustion Codex/);
    expect(source).toMatch(/try again at/);
    expect(source).toMatch(/REVIEW_MODE=verification/);
    expect(source).toMatch(/Prior findings to verify/);
    expect(source).not.toMatch(
      /PROVIDER_RC.*-eq 76.*QUALITY_FALLBACK|QUALITY_FALLBACK.*PROVIDER_RC.*-eq 76/,
    );
  });

  it.each([
    ["root", (review) => review],
    ["legacy result envelope", (review) => ({ result: review })],
  ])("normalizes %s Codex structured output", (_label, wrap) => {
    const dir = mkdtempSync(path.join(tmpdir(), "codex-review-output-"));
    const input = path.join(dir, "input.json");
    const output = path.join(dir, "output.json");
    const review = {
      verdict: "approve",
      summary: "No actionable findings.",
      findings: [],
    };
    writeFileSync(input, JSON.stringify(wrap(review)));

    const result = spawnSync("bash", [NORMALIZE_CODEX_REVIEW, input, output], {
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(review);
  });

  it.each([
    ["missing fields", { verdict: "approve" }],
    ["unknown verdict", { verdict: "maybe", summary: "invalid", findings: [] }],
    [
      "invalid finding item",
      { verdict: "approve", summary: "invalid", findings: [false] },
    ],
    [
      "invalid finding line",
      {
        verdict: "needs-attention",
        summary: "invalid",
        findings: [
          {
            severity: "high",
            title: "bad line",
            body: "line_start must be positive",
            file: "file.js",
            line_start: 0,
            recommendation: "fix it",
          },
        ],
      },
    ],
  ])("rejects malformed Codex output: %s", (_label, review) => {
    const dir = mkdtempSync(path.join(tmpdir(), "codex-review-invalid-"));
    const input = path.join(dir, "input.json");
    const output = path.join(dir, "output.json");
    writeFileSync(input, JSON.stringify(review));

    expect(
      spawnSync("bash", [NORMALIZE_CODEX_REVIEW, input, output]).status,
    ).not.toBe(0);
  });

  it("pins the initial review diff to the branch merge-base", () => {
    const source = readFileSync(RUN_REVIEW, "utf8");
    expect(source).toMatch(
      /REVIEW_BASE="\$\(git merge-base HEAD "\$REVIEW_BASE_REF"\)"/,
    );
    expect(source).toMatch(/REVIEW_DIFF_BASE="\$REVIEW_BASE"/);
    expect(source).toMatch(/git diff "\$\{REVIEW_DIFF_BASE\}\.\.HEAD"/);
    expect(source).toMatch(/REVIEWED_BASE="\$REVIEW_BASE"/);
    expect(source).toMatch(/normalized Codex findings could not be rendered/);
  });

  it("keeps sourced review scripts compatible with Bash and zsh", () => {
    const runner = readFileSync(RUN_REVIEW, "utf8");
    const policy = readFileSync(
      path.join(ROOT, "scripts", "quality-provider-policy.sh"),
      "utf8",
    );
    for (const source of [runner, policy]) {
      expect(source).toMatch(/BASH_VERSION/);
      expect(source).toMatch(/ZSH_VERSION/);
      expect(source).toMatch(/\$\{\(%\):-%x\}/);
    }
  });

  it("runs one xhigh discovery pass, then one high targeted verification", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "quality-rounds-"));
    const repo = path.join(dir, "repo");
    const bin = path.join(dir, "bin");
    const prompt = path.join(dir, "prompt.txt");
    const argsLog = path.join(dir, "args.txt");
    const setup = spawnSync(
      "bash",
      [
        "-c",
        `
mkdir -p "$1" "$2"
git init -q -b main "$1"
cd "$1"
git config user.name test
git config user.email test@example.com
echo base > file.js
git add file.js
git commit -q -m base
git switch -q -c feature
echo broken >> file.js
git commit -qam feature
`,
        "setup",
        repo,
        bin,
      ],
      { encoding: "utf8" },
    );
    expect(setup.status).toBe(0);

    const fakeCodex = path.join(bin, "codex");
    writeFileSync(
      fakeCodex,
      `#!/usr/bin/env bash
if [ "$1" = "login" ]; then
  echo "Logged in using ChatGPT"
  exit 0
fi
printf '%s\\n' "$*" >> "$FAKE_CODEX_ARGS"
cat > "$FAKE_CODEX_PROMPT"
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then out="$2"; shift 2; continue; fi
  shift
done
printf '%s\\n' '{"verdict":"approve","summary":"verified","findings":[]}' > "$out"
`,
    );
    chmodSync(fakeCodex, 0o755);

    const rootFile = path.join(dir, "root.txt");
    const governor = path.join(dir, "governor.json");
    const baseline = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repo,
      encoding: "utf8",
    }).stdout.trim();
    const start = Math.floor(Date.now() / 1000);
    writeFileSync(rootFile, `${repo}\n`);
    writeFileSync(
      governor,
      JSON.stringify({
        start_epoch: start,
        deadline_epoch: start + 600,
        start_commit_sha: baseline,
        start_commit_count: 2,
        max_fix_commits: 4,
        max_wall_seconds: 600,
        max_review_rounds: 2,
        rounds_used: 1,
        findings_seen: [],
      }),
    );
    writeFileSync(
      rootFile.replace(/\.txt$/, "-riskstate.env"),
      "TIER='critical'\nCODEX_DEPTH='xhigh'\nCODEX_ROUNDS='1'\nLEVEL='auto'\n",
    );

    const runReview = () =>
      spawnSync(
        "bash",
        [
          "-c",
          `
bs_quality_find_script() { printf '%s/scripts/%s\\n' "$KIT_ROOT" "$1"; }
source "$KIT_ROOT/scripts/quality-run-review.sh"
`,
        ],
        {
          cwd: repo,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            KIT_ROOT: ROOT,
            BS_QUALITY_PRIMARY: "codex",
            BS_QUALITY_FALLBACK: "none",
            BS_QUALITY_ROOT_FILE: rootFile,
            BS_QUALITY_GOVERNOR_FILE: governor,
            FAKE_CODEX_PROMPT: prompt,
            FAKE_CODEX_ARGS: argsLog,
          },
        },
      );

    const discovery = runReview();
    expect(discovery.status, discovery.stderr + discovery.stdout).toBe(0);
    expect(readFileSync(prompt, "utf8")).toContain("Review mode: discovery");
    expect(readFileSync(argsLog, "utf8")).toContain(
      'model_reasoning_effort="xhigh"',
    );

    const findings = JSON.stringify([
      { file: "file.js", summary: "broken behavior" },
    ]);
    expect(
      spawnSync("node", [
        path.join(ROOT, "scripts", "quality-run-governor.js"),
        "record-finding",
        governor,
        findings,
      ]).status,
    ).toBe(0);
    spawnSync("bash", ["-c", "echo fixed >> file.js; git commit -qam fix"], {
      cwd: repo,
    });
    expect(
      spawnSync(
        "node",
        [
          path.join(ROOT, "scripts", "quality-run-governor.js"),
          "bump-round",
          governor,
        ],
        { cwd: repo },
      ).status,
    ).toBe(0);

    const verification = runReview();
    expect(verification.status, verification.stderr + verification.stdout).toBe(
      0,
    );
    const verificationPrompt = readFileSync(prompt, "utf8");
    expect(verificationPrompt).toContain("Review mode: verification");
    expect(verificationPrompt).toContain("broken behavior");
    expect(verificationPrompt).toContain("+fixed");
    const invocations = readFileSync(argsLog, "utf8").trim().split("\n");
    expect(invocations).toHaveLength(2);
    expect(invocations[1]).toContain('model_reasoning_effort="high"');
  });
});
