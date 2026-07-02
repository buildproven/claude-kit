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

    it("exits 0 when at least one agent resolves (--dry-run)", () => {
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
      expect(r.code).toBe(0);
    });
  });

  describe("SKILL.md wiring (findings #1/#2/#6)", () => {
    const SKILL = fs.readFileSync(
      path.resolve(KIT_ROOT, "skills", "quality", "SKILL.md"),
      "utf8",
    );
    it("persists the AGENTS panel to a sentinel (survives across fenced blocks)", () => {
      expect(SKILL).toMatch(/bs-quality-agents-.*\.txt/);
    });
    it("companion block reads the agents sentinel, not an in-scope array", () => {
      expect(SKILL).toMatch(/AGENTS_FILE=.*bs-quality-agents/);
      expect(SKILL).toMatch(/AGENTS_CSV=.*paste -sd, "\$AGENTS_FILE"/);
    });
    it("blocks the merge on ANY non-zero companion rc (not just rc==2)", () => {
      expect(SKILL).toMatch(/COMPANION_RC" -ne 0/);
    });
    it("no panel/AGENTS line lists the phantom test-generator agent", () => {
      // test-generator has no agent .md anywhere → would permanently block
      // high/critical merges as INCONCLUSIVE. It may only appear in prose
      // explaining its removal, never in a PANEL=(...) or AGENTS=(...) line.
      const panelLines = SKILL.split("\n").filter(
        (l) =>
          /^\s*(PANEL|AGENTS)=\(/.test(l) ||
          /^\s+(code-reviewer|test-generator|pr-test-analyzer)/.test(l),
      );
      for (const l of panelLines) {
        expect(l).not.toMatch(/test-generator/);
      }
    });
    it("clears any stale review-panel sentinel before the pipeline runs", () => {
      // The sentinel is session- (not run-) namespaced. A run that SKIPS agent
      // selection (--scope changed) must not inherit a prior run's panel, so
      // the skill removes any stale sentinel up front (right after the recursion
      // guard, before Step 1.8). Assert that rm precedes the write.
      const rmIdx = SKILL.search(
        /rm -f "\$\{TMPDIR:-\/tmp\}\/bs-quality-agents-/,
      );
      const writeIdx = SKILL.search(
        /> "\$\{TMPDIR:-\/tmp\}\/bs-quality-agents-/,
      );
      expect(rmIdx).toBeGreaterThan(-1);
      expect(writeIdx).toBeGreaterThan(-1);
      expect(rmIdx).toBeLessThan(writeIdx); // clear happens before the write
    });
  });
});
