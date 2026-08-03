import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "./helpers/tmp.js";

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
const PRESERVE_PRIMARY = path.join(
  ROOT,
  "scripts",
  "quality-preserve-primary-evidence.sh",
);
const NORMALIZE_CODEX_REVIEW = path.join(
  ROOT,
  "scripts",
  "quality-normalize-codex-review.sh",
);
const NORMALIZE_GEMINI_REVIEW = path.join(
  ROOT,
  "scripts",
  "quality-normalize-gemini-review.js",
);

describe("provider review runtime", () => {
  it("documents the exact Quality-* schema emitted by the runtime", () => {
    const skill = readFileSync(
      path.join(ROOT, "skills", "quality", "SKILL.md"),
      "utf8",
    );
    const runtime = readFileSync(
      path.join(ROOT, "scripts", "quality-invocation.js"),
      "utf8",
    );
    const keys = [
      "Tier",
      "Reviewer",
      "Primary",
      "Fallback",
      "Findings",
      "Head",
      "Base",
    ];
    for (const key of keys) {
      expect(skill).toMatch(new RegExp(`^Quality-${key}:`, "m"));
      expect(runtime).toContain(`Quality-${key}:`);
    }
    expect(skill).toMatch(/parenthetical[\s\S]*legacy/i);
  });

  it.each([
    ["low", "120", "Focused"],
    ["medium", "480", "Broad"],
    ["high", "900", "Deep adversarial"],
    ["critical", "900", "release-veto"],
  ])("maps %s to a mechanical review plan", (tier, timeout, focus) => {
    const result = spawnSync(
      "/bin/bash",
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

  it("kills a hanging provider and a session-escaped helper at the wall-clock cap", () => {
    const directory = makeTempDir("bounded-tree-");
    const pidFile = path.join(directory, "native-helper.pid");
    const started = Date.now();
    const result = spawnSync(
      "/bin/bash",
      [
        BOUNDED,
        "--timeout",
        "1",
        "--",
        "/bin/bash",
        "-c",
        'python3 -c \'import os,signal,sys,time; os.setsid(); signal.signal(signal.SIGTERM, signal.SIG_IGN); open(sys.argv[1], "w").write(str(os.getpid())); time.sleep(20)\' "$1" & wait',
        "provider",
        pidFile,
      ],
      { encoding: "utf8", timeout: 5000 },
    );
    expect(result.status).toBe(124);
    expect(Date.now() - started).toBeLessThan(4000);
    const helperPid = Number(readFileSync(pidFile, "utf8").trim());
    expect(Number.isSafeInteger(helperPid)).toBe(true);
    expect(() => process.kill(helperPid, 0)).toThrow();
  });

  it("reaps the watchdog promptly after a successful command", () => {
    const started = Date.now();
    const result = spawnSync(
      "bash",
      [BOUNDED, "--timeout", "20", "--", "bash", "-c", "exit 0"],
      { encoding: "utf8", timeout: 5000 },
    );
    expect(result.status).toBe(0);
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it("honors scorer-selected independent Codex rounds", () => {
    const result = spawnSync(
      "bash",
      [
        "-c",
        `TIER=critical CODEX_DEPTH=xhigh CODEX_ROUNDS=2; source "$1"; printf '%s|%s' "$QUALITY_REVIEW_DEPTH" "$QUALITY_REVIEW_PASSES"`,
        "plan",
        PLAN,
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("xhigh|2");
  });

  it("loads persisted risk state at the runner boundary", () => {
    const plan = readFileSync(PLAN, "utf8");
    const runner = readFileSync(RUN_REVIEW, "utf8");
    const riskLoad = 'TIER="$(field risk.tier)"';
    const planLoad = 'source "$SCRIPT_DIR/quality-review-plan.sh"';

    expect(plan).not.toContain("riskstate.env");
    expect(runner).not.toContain("riskstate.env");
    expect(runner).toContain(riskLoad);
    expect(runner.indexOf(riskLoad)).toBeLessThan(runner.indexOf(planLoad));
  });

  it("gives mandatory fix validation its persisted provider allowance", () => {
    const runner = readFileSync(RUN_REVIEW, "utf8");
    const invocation = readFileSync(
      path.join(ROOT, "scripts", "quality-invocation.js"),
      "utf8",
    );

    expect(runner).toContain(
      'QUALITY_REVIEW_TIMEOUT="$(field risk.runtime.reviewReserveSeconds)"',
    );
    expect(runner).toContain(
      '[ -n "$QUALITY_REVIEW_TIMEOUT" ] || QUALITY_REVIEW_TIMEOUT=300',
    );
    expect(invocation).toMatch(
      /manifest\.reviews\.length === 0[\s\S]*risk\?\.runtime\?\.reviewSeconds[\s\S]*risk\?\.runtime\?\.reviewReserveSeconds \?\? 300/,
    );
  });

  it("uses native structured Claude output without a malformed-output retry loop", () => {
    const runner = readFileSync(RUN_REVIEW, "utf8");
    const companion = readFileSync(
      path.resolve(ROOT, "scripts", "claude-review-companion.sh"),
      "utf8",
    );
    expect(runner).not.toContain("claude_marker_only_result()");
    expect(runner).not.toContain("marker-only finding; retrying once");
    expect(companion).toContain('--json-schema "$REVIEW_SCHEMA_JSON"');
    expect(companion).toContain(".structured_output");
    expect(companion).toContain('del(."$schema")');
    expect(companion).not.toContain('category: "marker-only-findings"');
  });

  it("fails over when Codex cannot refresh an MCP OAuth token", () => {
    const runner = readFileSync(RUN_REVIEW, "utf8");
    expect(runner).toContain("OAuth token refresh failed:.*invalid_grant");
    expect(runner).toContain("return 2");
  });

  it("kills the provider tree when the wrapper itself is cancelled", () => {
    const dir = makeTempDir("bounded-cancel-");
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

  it("does not name active state by Claude or Codex session IDs", () => {
    const source = spawnSync("cat", [LOAD_ROOT], { encoding: "utf8" }).stdout;
    expect(source).not.toMatch(/CLAUDE_CODE_SESSION_ID|CODEX_THREAD_ID/);
    expect(source).toMatch(/--manifest is required/);
  });

  it("requires the explicit manifest instead of ambient shell state", () => {
    const source = readFileSync(LOAD_ROOT, "utf8");
    expect(source).toMatch(/--manifest/);
    expect(source).toMatch(/quality-invocation\.js" locate/);
    expect(source).not.toMatch(/BS_QUALITY_ROOT_FILE|latest|find .*bs-quality/);
  });

  it("accepts exact evidence, then rejects later code and contradictions", () => {
    const repo = makeTempDir("review-evidence-");
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

Reviewed-By: quality
Reviewed-By: codex
Quality-Tier: high
Quality-Reviewer: codex
Quality-Primary: codex
Quality-Fallback: claude
Quality-Findings: 0
Quality-Head: $reviewed
Quality-Base: $base"
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

Reviewed-By: quality
Reviewed-By: codex
Quality-Tier: high
Quality-Reviewer: codex
Quality-Primary: codex
Quality-Fallback: claude
Quality-Findings: 0
Quality-Head: ${reviewed}
Quality-Base: ${base}`;
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
    }).stdout.concat("\nQuality-Findings: 9\n");
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
    const preservation = spawnSync("cat", [PRESERVE_PRIMARY], {
      encoding: "utf8",
    }).stdout;
    expect(source).toMatch(
      /while \[ "\$pass" -le "\$QUALITY_REVIEW_PASSES" \]/,
    );
    expect(source).toMatch(/model_reasoning_effort=.*QUALITY_REVIEW_DEPTH/);
    expect(source).toMatch(
      /codex exec --ephemeral --ignore-user-config -s read-only --json/,
    );
    expect(source).toMatch(
      /optional[\s\S]*MCP configuration[\s\S]*unrelated, stale OAuth grants/i,
    );
    expect(source).toMatch(/-C "\$GIT_ROOT"/);
    expect(source).toMatch(/review_selector=--base/);
    expect(source).not.toMatch(/review_selector=--commit/);
    expect(source).toMatch(/Prior reviewed findings requiring verification/);
    expect(source).toMatch(/Automated gates already passed/);
    expect(source).toMatch(/do not run commands or tests/);
    expect(source).toMatch(/cat "\$REVIEW_OUT\/diff\.txt"/);
    expect(source).not.toMatch(/\$review_selector_value" -/);
    expect(source).toMatch(/Codex review passes must be 1 or 2/);
    expect(source).toMatch(/record_provider_exhaustion Codex/);
    expect(source).toMatch(/quality-provider-error\.js/);
    expect(source).not.toMatch(/provider_stderr_exhausted/);
    expect(source).not.toMatch(/provider_exhausted "\$raw_file"/);
    expect(source.indexOf('[ "$rc" -eq 124 ] && return 76')).toBeLessThan(
      source.indexOf('if node "$SCRIPT_DIR/quality-provider-error.js"'),
    );
    expect(preservation).toMatch(/"\$REVIEW_OUT"\/codex-\*\.json/);
    expect(preservation).toMatch(/"\$REVIEW_OUT"\/codex-\*\.progress/);
    expect(preservation).toMatch(/"\$REVIEW_OUT"\/codex-\*\.prompt/);
    expect(preservation).toMatch(/codex-\*\.normalized\.json/);
    expect(preservation).toMatch(/primary-\$preserve_pass\.result\.json/);
    // rc=76 (bounded-budget timeout without converging) is now CONFIGURABLE:
    // it fails over to the fallback when BS_QUALITY_FALLBACK_ON_TIMEOUT=1
    // (the default), gated so a degraded primary doesn't block a merge while a
    // healthy fallback sits idle (BUI-357). #104's strict single-clock bound is
    // preserved via BS_QUALITY_FALLBACK_ON_TIMEOUT=0. The fallback still runs at
    // most once — a fallback rc=76 hard-blocks below, so total review time is
    // bounded at two clocks, never unbounded.
    expect(source).toMatch(/BS_QUALITY_FALLBACK_ON_TIMEOUT/);
    expect(source).toMatch(
      /FALLBACK_ON_TIMEOUT="\$\{BS_QUALITY_FALLBACK_ON_TIMEOUT:-1\}"/,
    );
    expect(source).toMatch(
      /PROVIDER_RC" -eq 76 \] && \[ "\$FALLBACK_ON_TIMEOUT" = 1 \]/,
    );
  });

  it("runs Gemini through the same bounded, read-only provider contract", () => {
    const source = readFileSync(RUN_REVIEW, "utf8");
    expect(source).toMatch(/authorize_provider_attempt gemini/);
    expect(source).toMatch(/gemini --skip-trust --approval-mode plan/);
    expect(source).toMatch(/--output-format json/);
    expect(source).toMatch(/quality-normalize-gemini-review\.js/);
    expect(source).toMatch(/quality-run-bounded\.sh/);
    expect(source).toMatch(/classify_structured_provider_failure gemini/);
    expect(source).toMatch(/quality-provider-policy\.sh" \|\| exit 1/);
    expect(source).toMatch(/Never return JSON Schema definition keys/);
    expect(source).not.toMatch(/gemini[^\n]*(?:--yolo|approval-mode yolo)/);
    expect(readFileSync(NORMALIZE_GEMINI_REVIEW, "utf8")).toMatch(
      /normalizeStructuredReview/,
    );
  });

  it.each([
    ["root", (review) => review],
    ["legacy result envelope", (review) => ({ result: review })],
  ])("normalizes %s Codex structured output", (_label, wrap) => {
    const dir = makeTempDir("codex-review-output-");
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
      "needs-attention without an actionable finding",
      {
        verdict: "needs-attention",
        summary: "Manual review is required.",
        findings: [],
      },
    ],
    [
      "approve with an actionable finding",
      {
        verdict: "approve",
        summary: "Contradictory approval.",
        findings: [
          {
            severity: "high",
            title: "unexpected finding",
            body: "An approval cannot carry a release-blocking finding.",
            file: "file.js",
            line_start: 1,
            recommendation: "Use needs-attention.",
          },
        ],
      },
    ],
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
    const dir = makeTempDir("codex-review-invalid-");
    const input = path.join(dir, "input.json");
    const output = path.join(dir, "output.json");
    writeFileSync(input, JSON.stringify(review));

    expect(
      spawnSync("bash", [NORMALIZE_CODEX_REVIEW, input, output]).status,
    ).not.toBe(0);
  });

  it("pins the initial review diff to the branch merge-base", () => {
    const source = readFileSync(RUN_REVIEW, "utf8");
    expect(source).toMatch(/quality-invocation\.js" review-info/);
    expect(source).toMatch(
      /git diff "\$\{REVIEW_DIFF_BASE\}\.\.\$\{REVIEWED_HEAD\}"/,
    );
    expect(source).toMatch(/normalized Codex findings could not be rendered/);
  });

  it("runs Bash-only review entrypoints explicitly through Bash", () => {
    const runner = readFileSync(RUN_REVIEW, "utf8");
    const policy = readFileSync(
      path.join(ROOT, "scripts", "quality-provider-policy.sh"),
      "utf8",
    );
    expect(runner).toMatch(/^#!\/usr\/bin\/env bash/);
    expect(runner).toMatch(/\$\{BASH_SOURCE\[0\]\}/);
    expect(policy).toMatch(/BASH_VERSION/);
    expect(policy).toMatch(/ZSH_VERSION/);
  });

  it.each(["parser-inconclusive", "evidence-absent"])(
    "preserves a completed earlier pass's normalized findings in --mode %s when a LATER pass fails",
    (mode) => {
      // Multi-pass Codex review: pass 1 completes with real findings, pass 2
      // fails for whatever reason (parser error -> parser-inconclusive;
      // exhaustion/timeout/unavailability -> evidence-absent). Either way,
      // pass 1's normalized result is authoritative and must not be
      // discarded as if the primary produced nothing.
      const dir = makeTempDir("preserve-primary-");
      writeFileSync(
        path.join(dir, "codex-1.normalized.json"),
        JSON.stringify({
          verdict: "needs-attention",
          summary: "pass 1 completed",
          findings: [{ severity: "high", title: "real finding" }],
        }),
      );
      writeFileSync(
        path.join(dir, "codex.findings.txt"),
        "INCONCLUSIVE: pass 2 failed\n",
      );

      const result = spawnSync("bash", [
        PRESERVE_PRIMARY,
        "--review-out",
        dir,
        "--mode",
        mode,
      ]);
      expect(result.status).toBe(0);

      const preserved = readFileSync(
        path.join(dir, "primary-codex-1.result.json"),
        "utf8",
      );
      expect(JSON.parse(preserved).findings).toHaveLength(1);
      expect(
        spawnSync("test", ["-e", path.join(dir, "codex-1.normalized.json")])
          .status,
      ).not.toBe(0);
    },
  );

  it.each(["parser-inconclusive", "evidence-absent"])(
    "preserves a completed Gemini pass's normalized findings in --mode %s (not just Codex)",
    (mode) => {
      // Same bug class as the Codex test above, but for Gemini: the
      // preservation loop only globbed codex-*.normalized.json, so a
      // completed Gemini pass got swept into failed-primary/ by the raw
      // artifact quarantine loop (gemini-*.json) instead of being preserved.
      const dir = makeTempDir("preserve-primary-gemini-");
      writeFileSync(
        path.join(dir, "gemini-1.normalized.json"),
        JSON.stringify({
          verdict: "needs-attention",
          summary: "gemini pass 1 completed",
          findings: [{ severity: "high", title: "real gemini finding" }],
        }),
      );
      writeFileSync(
        path.join(dir, "gemini.findings.txt"),
        "INCONCLUSIVE: pass 2 failed\n",
      );

      const result = spawnSync("bash", [
        PRESERVE_PRIMARY,
        "--review-out",
        dir,
        "--mode",
        mode,
      ]);
      expect(result.status).toBe(0);

      const preserved = readFileSync(
        path.join(dir, "primary-gemini-1.result.json"),
        "utf8",
      );
      expect(JSON.parse(preserved).findings).toHaveLength(1);
      expect(
        spawnSync("test", ["-e", path.join(dir, "gemini-1.normalized.json")])
          .status,
      ).not.toBe(0);
    },
  );
});
