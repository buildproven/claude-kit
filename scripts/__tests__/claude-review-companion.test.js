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
    expect(r.code).toBe(0); // wrote a findings file → overall success
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
});
