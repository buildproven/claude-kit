// Tests for scripts/claude-review-companion.sh — the blocking-subprocess
// Claude review runner. These exercise the guard/degradation paths that do
// NOT require a real `claude` call (fast, deterministic, CI-safe). The
// happy-path (agents actually reviewing a diff) is validated manually /
// live, since it needs the claude CLI + network and costs tokens.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCRIPT = path.resolve(__dirname, "..", "claude-review-companion.sh");
const KIT_ROOT = path.resolve(__dirname, "..", "..");

function run(args, { env } = {}) {
  if (args.includes("--diff-file") && !args.includes("--identity-file")) {
    const identity = path.join(
      os.tmpdir(),
      `crc-identity-${process.pid}-${Math.random().toString(36).slice(2)}.json`,
    );
    fs.writeFileSync(
      identity,
      JSON.stringify({
        invocationId: "test",
        repositoryRealpath: process.cwd(),
        baseSha: "a".repeat(40),
        headSha: "b".repeat(40),
      }),
    );
    args = [...args, "--identity-file", identity];
  }
  // Capture stderr on BOTH success and failure. execFileSync throws only on
  // non-zero exit; on success it returns stdout but stderr is still written to
  // the pipe, so redirect stderr→a file we read back to avoid losing it.
  const errFile = path.join(
    os.tmpdir(),
    `crc-err-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  try {
    const stdout = execFileSync("bash", [SCRIPT, ...args], {
      env: { ...process.env, ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", fs.openSync(errFile, "w")],
    });
    const stderr = fs.existsSync(errFile)
      ? fs.readFileSync(errFile, "utf8")
      : "";
    return { code: 0, stdout, stderr };
  } catch (e) {
    const stderr = fs.existsSync(errFile)
      ? fs.readFileSync(errFile, "utf8")
      : (e.stderr?.toString() ?? "");
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? "", stderr };
  } finally {
    try {
      fs.unlinkSync(errFile);
    } catch {
      /* ignore */
    }
  }
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "crc-test-"));
}

describe("claude-review-companion.sh", () => {
  it("exits 1 when required args are missing", () => {
    const r = run(["--agents", "code-reviewer"]); // no --out-dir / --diff-file
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/required/);
  });

  it("requires and injects prior findings for verification mode", () => {
    const d = tmpdir();
    const diff = path.join(d, "diff.txt");
    const findings = path.join(d, "findings.json");
    fs.writeFileSync(diff, "+fixed\n");
    fs.writeFileSync(findings, '[{"file":"a.js","summary":"missing guard"}]');

    const missing = run([
      "--diff-file",
      diff,
      "--out-dir",
      path.join(d, "missing"),
      "--agents",
      "code-reviewer",
      "--review-mode",
      "verification",
      "--dry-run",
    ]);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toMatch(/prior-findings-file/);

    const ok = run([
      "--diff-file",
      diff,
      "--out-dir",
      path.join(d, "ok"),
      "--agents",
      "code-reviewer",
      "--review-mode",
      "verification",
      "--prior-findings-file",
      findings,
      "--dry-run",
    ]);
    expect(ok.code).toBe(0);
    expect(
      fs.readFileSync(path.join(d, "ok", "review-context.txt"), "utf8"),
    ).toContain("missing guard");
  });

  it("exits 2 (fail LOUD) when the claude CLI is unavailable", () => {
    const d = tmpdir();
    fs.writeFileSync(path.join(d, "diff.txt"), "x\n");
    // Restrict PATH so `claude` cannot be found (but bash/jq/perl basics remain
    // in /usr/bin:/bin — jq may be absent there, but the CLI check happens
    // first and short-circuits).
    const r = run(
      [
        "--diff-file",
        path.join(d, "diff.txt"),
        "--out-dir",
        path.join(d, "o"),
        "--agents",
        "code-reviewer",
      ],
      { env: { PATH: "/usr/bin:/bin" } },
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/CLI not found/);
  });

  it("marks an unresolvable agent INCONCLUSIVE instead of crashing (--dry-run)", () => {
    const d = tmpdir();
    fs.writeFileSync(path.join(d, "diff.txt"), "x\n");
    const out = path.join(d, "o");
    const r = run([
      "--dry-run",
      "--diff-file",
      path.join(d, "diff.txt"),
      "--out-dir",
      out,
      "--agents",
      "definitely-not-an-agent",
    ]);
    // A findings file is still written (no crash) — the run is fully degraded
    // (the only agent is inconclusive), so exit 4 so the caller blocks.
    expect(r.code).toBe(4);
    const f = path.join(out, "definitely-not-an-agent.findings.txt");
    expect(fs.readFileSync(f, "utf8")).toMatch(/INCONCLUSIVE/);
  });

  it("resolves a real agent to its .md system prompt (--dry-run)", () => {
    const d = tmpdir();
    fs.writeFileSync(path.join(d, "diff.txt"), "x\n");
    const out = path.join(d, "o");
    const r = run([
      "--dry-run",
      "--diff-file",
      path.join(d, "diff.txt"),
      "--out-dir",
      out,
      "--agents",
      "code-reviewer",
    ]);
    expect(r.code).toBe(0);
    const f = fs.readFileSync(
      path.join(out, "code-reviewer.findings.txt"),
      "utf8",
    );
    expect(f).toMatch(/DRY-RUN: would review with agent 'code-reviewer'/);
    expect(f).toMatch(/agents\/code-reviewer\.md/); // points at the REAL body
  });

  it("refuses to pin a 1M-context model (Extra Usage billing gate) (--dry-run)", () => {
    const d = tmpdir();
    fs.writeFileSync(path.join(d, "diff.txt"), "x\n");
    const r = run([
      "--dry-run",
      "--diff-file",
      path.join(d, "diff.txt"),
      "--out-dir",
      path.join(d, "o"),
      "--agents",
      "code-reviewer",
      "--model",
      "claude-sonnet-4-6[1m]",
    ]);
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/refusing to pin a 1M-context model/);
  });

  describe("agent-file resolution (drift guard)", () => {
    // The whole design rests on pointing --append-system-prompt-file at the
    // REAL agent bodies (no inlined copies to drift). Assert the kit-local
    // agents referenced by the default panel actually exist on disk.
    const KIT_AGENTS = [
      "code-reviewer",
      "security-auditor",
      "architect-reviewer",
    ];
    for (const name of KIT_AGENTS) {
      it(`kit agent file exists: ${name}.md`, () => {
        expect(fs.existsSync(path.join(KIT_ROOT, "agents", `${name}.md`))).toBe(
          true,
        );
      });
    }
  });

  describe("recursion guard contract", () => {
    it("exports BS_QUALITY_HEADLESS=1 to review children", () => {
      const src = fs.readFileSync(SCRIPT, "utf8");
      // The sentinel must be set on the child `claude` invocation so the skill
      // can hard-refuse re-entry (fork→child→fork recursion, 2026-06-04 incident).
      expect(src).toMatch(/BS_QUALITY_HEADLESS=1[\s\S]*claude -p/);
    });
  });

  describe("bash 3.2 compatibility (macOS /bin/bash)", () => {
    // Finding #3: an empty MODEL_ARGS array must not fatal under set -u on
    // bash 3.2. Run the whole script through /bin/bash if present.
    const SYS_BASH = "/bin/bash";
    const hasSysBash = fs.existsSync(SYS_BASH);
    (hasSysBash ? it : it.skip)(
      "runs under /bin/bash with no --model (empty array, set -u safe)",
      () => {
        const d = tmpdir();
        fs.writeFileSync(path.join(d, "diff.txt"), "x\n");
        fs.writeFileSync(path.join(d, "identity.json"), "{}\n");
        const out = path.join(d, "o");
        // --dry-run avoids a live claude call but still exercises arg parsing,
        // guards, and the array-expansion code paths under set -u.
        const r = execFileSync(
          SYS_BASH,
          [
            SCRIPT,
            "--dry-run",
            "--diff-file",
            path.join(d, "diff.txt"),
            "--out-dir",
            out,
            "--agents",
            "code-reviewer",
            "--identity-file",
            path.join(d, "identity.json"),
          ],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
        expect(r).toBeDefined();
        const f = fs.readFileSync(
          path.join(out, "code-reviewer.findings.txt"),
          "utf8",
        );
        expect(f).toMatch(/DRY-RUN/);
      },
    );
  });

  describe("degraded-run detection", () => {
    // Finding #7: if EVERY agent is inconclusive, exit 4 so the caller can
    // block the merge instead of reading N inconclusive files as a clean pass.
    it("exits 4 when all agents are unresolvable/inconclusive (--dry-run)", () => {
      const d = tmpdir();
      fs.writeFileSync(path.join(d, "diff.txt"), "x\n");
      // Two bogus agents → both INCONCLUSIVE (unresolved) → all inconclusive.
      const r = run([
        "--dry-run",
        "--diff-file",
        path.join(d, "diff.txt"),
        "--out-dir",
        path.join(d, "o"),
        "--agents",
        "bogus-one,bogus-two",
      ]);
      expect(r.code).toBe(4);
    });

    it("blocks when any mandatory agent is inconclusive (--dry-run)", () => {
      const d = tmpdir();
      fs.writeFileSync(path.join(d, "diff.txt"), "x\n");
      const r = run([
        "--dry-run",
        "--diff-file",
        path.join(d, "diff.txt"),
        "--out-dir",
        path.join(d, "o"),
        "--agents",
        "code-reviewer,bogus",
      ]);
      expect(r.code).toBe(4);
    });
  });

  describe("account exhaustion", () => {
    it("returns 75, exposes the 429, and cancels sibling reviewers", () => {
      const d = tmpdir();
      const bin = path.join(d, "bin");
      fs.mkdirSync(bin);
      const fakeClaude = path.join(bin, "claude");
      fs.writeFileSync(
        fakeClaude,
        `#!/bin/bash
case "$*" in
  *code-reviewer.md*) echo '{"is_error":true,"error":{"status":429,"code":"rate_limit_exceeded","reset_at":"2026-07-20T03:00:00Z"}}'; exit 1 ;;
  *) sleep 30; printf '{"is_error":false,"result":"NO FINDINGS."}\\n' ;;
esac
`,
      );
      fs.chmodSync(fakeClaude, 0o755);
      fs.writeFileSync(path.join(d, "diff.txt"), "x\n");
      const started = Date.now();
      const r = run(
        [
          "--diff-file",
          path.join(d, "diff.txt"),
          "--out-dir",
          path.join(d, "o"),
          "--agents",
          "code-reviewer,security-auditor",
          "--timeout",
          "30",
        ],
        { env: { PATH: `${bin}:${process.env.PATH}` } },
      );
      expect(r.code).toBe(75);
      expect(r.stderr).toMatch(/weekly usage limit|provider exhausted/i);
      expect(r.stderr).toContain("2026-07-20T03:00:00.000Z");
      expect(
        JSON.parse(
          fs.readFileSync(path.join(d, "o", "provider-failure.json"), "utf8"),
        ),
      ).toMatchObject({
        provider: "claude",
        category: "provider-exhaustion",
        resetAt: "2026-07-20T03:00:00.000Z",
      });
      expect(Date.now() - started).toBeLessThan(8000);
      expect(
        fs.readFileSync(
          path.join(d, "o", "security-auditor.findings.txt"),
          "utf8",
        ),
      ).toMatch(/cancelled/i);
    });

    it("recognizes Claude's exit-0 error envelope and fails over immediately", () => {
      const d = tmpdir();
      const bin = path.join(d, "bin");
      fs.mkdirSync(bin);
      const fakeClaude = path.join(bin, "claude");
      fs.writeFileSync(
        fakeClaude,
        `#!/bin/bash
printf '%s\\n' '{"type":"result","subtype":"success","is_error":true,"api_error_status":429,"result":"Weekly usage limit reached"}'
exit 0
`,
      );
      fs.chmodSync(fakeClaude, 0o755);
      fs.writeFileSync(path.join(d, "diff.txt"), "x\n");
      const out = path.join(d, "o");
      const r = run(
        [
          "--diff-file",
          path.join(d, "diff.txt"),
          "--out-dir",
          out,
          "--agents",
          "code-reviewer",
        ],
        { env: { PATH: `${bin}:${process.env.PATH}` } },
      );
      expect(r.code, r.stderr).toBe(75);
      expect(
        JSON.parse(
          fs.readFileSync(path.join(out, "provider-failure.json"), "utf8"),
        ),
      ).toMatchObject({
        provider: "claude",
        category: "provider-exhaustion",
      });
    });

    it("does not classify successful review text mentioning 429 and quota as exhaustion", () => {
      const d = tmpdir();
      const bin = path.join(d, "bin");
      fs.mkdirSync(bin);
      const fakeClaude = path.join(bin, "claude");
      fs.writeFileSync(
        fakeClaude,
        `#!/bin/bash
printf '%s\\n' '{"is_error":false,"result":"WARNING: src/http.js:10 — status === 429 should preserve quota headers."}'
`,
      );
      fs.chmodSync(fakeClaude, 0o755);
      fs.writeFileSync(path.join(d, "diff.txt"), "x\n");
      const out = path.join(d, "o");
      const r = run(
        [
          "--diff-file",
          path.join(d, "diff.txt"),
          "--out-dir",
          out,
          "--agents",
          "code-reviewer",
        ],
        { env: { PATH: `${bin}:${process.env.PATH}` } },
      );
      expect(r.code, r.stderr).toBe(0);
      expect(
        fs.readFileSync(path.join(out, "code-reviewer.findings.txt"), "utf8"),
      ).toContain("status === 429");
      expect(fs.existsSync(path.join(out, "provider-exhausted"))).toBe(false);
    });
  });

  describe("quality skill wiring (findings #1/#2/#6)", () => {
    // #70 split SKILL.md's inline bash into scripts/ so SKILL.md stays under
    // the compaction re-attach token budget (see reference.md "Regression
    // History" 2026-07-11). These invariants used to be asserted against
    // inline SKILL.md text; they now live in the scripts SKILL.md delegates
    // to. Read all three so a future re-inlining or further split still
    // satisfies the same behavioral contract regardless of which file holds it.
    const BOOTSTRAP = fs.readFileSync(
      path.resolve(KIT_ROOT, "scripts", "quality-bootstrap.sh"),
      "utf8",
    );
    const SELECT_AGENTS = fs.readFileSync(
      path.resolve(KIT_ROOT, "scripts", "quality-select-agents.sh"),
      "utf8",
    );
    const RUN_REVIEW = fs.readFileSync(
      path.resolve(KIT_ROOT, "scripts", "quality-run-review.sh"),
      "utf8",
    );
    const COMBINED = `${BOOTSTRAP}\n${SELECT_AGENTS}\n${RUN_REVIEW}`;

    it("persists the AGENTS panel to the explicit manifest", () => {
      expect(SELECT_AGENTS).toMatch(
        /quality-invocation\.js" agents "\$MANIFEST"/,
      );
    });
    it("companion block reads agents from the explicit manifest", () => {
      expect(RUN_REVIEW).toMatch(
        /quality-invocation\.js" get "\$MANIFEST" agents/,
      );
      expect(RUN_REVIEW).not.toMatch(/bs-quality-agents/);
    });
    it("falls back only for typed exhaustion or provider unavailability", () => {
      expect(RUN_REVIEW).toMatch(/PROVIDER_RC" -eq 75/);
      expect(RUN_REVIEW).toMatch(/PROVIDER_RC" -eq 2/);
      expect(RUN_REVIEW).toMatch(/QUALITY_FALLBACK/);
    });
    it("uses the manifest checkpoint for later-round delta review", () => {
      expect(RUN_REVIEW).toMatch(
        /quality-invocation\.js" review-info "\$MANIFEST"/,
      );
      expect(RUN_REVIEW).toMatch(/REVIEW_DIFF_BASE=.*\.from/);
    });
    it("no panel/AGENTS line lists the phantom test-generator agent", () => {
      // test-generator has no agent .md anywhere → would permanently block
      // high/critical merges as INCONCLUSIVE. It may only appear in prose
      // explaining its removal, never in a PANEL=(...) or AGENTS=(...) line.
      const panelLines = COMBINED.split("\n").filter(
        (l) =>
          /^\s*(PANEL|AGENTS)=\(/.test(l) ||
          /^\s+(code-reviewer|test-generator|pr-test-analyzer)/.test(l),
      );
      for (const l of panelLines) {
        expect(l).not.toMatch(/test-generator/);
      }
    });
    it("does not discover or clear session-scoped panel state", () => {
      expect(BOOTSTRAP).not.toMatch(/bs-quality-agents/);
      expect(SELECT_AGENTS).not.toMatch(/bs-quality-agents/);
      expect(RUN_REVIEW).not.toMatch(/bs-quality-agents/);
    });
  });
});
