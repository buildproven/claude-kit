const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "..", "quality-adversarial-verify.sh");

/**
 * Adversarial verification hands each finding to N skeptics whose only job is to
 * REFUTE it. It exists because "3 agents agreed" is not independent evidence —
 * agents reading the same diff share a model, a prompt shape, and the same blind
 * spots, so they make CORRELATED errors.
 *
 * Its safety property is the asymmetry: a false PASS ships the bug, a false BLOCK
 * costs one fix round. So every uncertain path must let the finding SURVIVE —
 * a tie, a timed-out skeptic, a malformed input. Silence is not a refutation.
 */
const run = (args) => {
  // Merge stderr into stdout: the script reports refusals and fail-safe warnings
  // on stderr while still exiting 0 (an unverifiable finding must not fail the
  // build — it survives). Capturing only stdout would miss exactly those.
  try {
    const out = execFileSync("bash", [SCRIPT, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
};

/** Same, but captures stderr on a successful (exit 0) run. */
const runCapturingStderr = (args) => {
  const errFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "adv-err-")),
    "err",
  );
  const fd = fs.openSync(errFile, "w");
  try {
    const out = execFileSync("bash", [SCRIPT, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", fd],
    });
    return { code: 0, out: out + fs.readFileSync(errFile, "utf8") };
  } catch (e) {
    return {
      code: e.status,
      out: (e.stdout ?? "") + fs.readFileSync(errFile, "utf8"),
    };
  } finally {
    fs.closeSync(fd);
  }
};

const fixture = (findings) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adv-"));
  const f = path.join(dir, "findings.json");
  fs.writeFileSync(
    f,
    typeof findings === "string" ? findings : JSON.stringify(findings),
  );
  const d = path.join(dir, "diff.txt");
  fs.writeFileSync(d, "diff --git a/x b/x\n");
  return { dir, findings: f, diff: d, out: path.join(dir, "out") };
};

const verdicts = (fx) =>
  JSON.parse(fs.readFileSync(path.join(fx.out, "verdicts.json"), "utf8"));

const FINDING = {
  file: "src/a.js",
  line: 12,
  severity: "BLOCKING",
  summary: "Null deref on empty input",
  detail: "foo() returns null when the list is empty",
};

describe("adversarial verification", () => {
  it("emits a verdict per finding, with the vote split recorded", () => {
    const fx = fixture([FINDING]);
    const { code } = run([
      "--findings",
      fx.findings,
      "--diff",
      fx.diff,
      "--out",
      fx.out,
      "--voters",
      "3",
      "--dry-run",
    ]);

    expect(code).toBe(0);
    const [v] = verdicts(fx);
    expect(v.file).toBe("src/a.js");
    expect(v.verified.refuted + v.verified.stands).toBe(3);
    expect(v.verified).toHaveProperty("survives");
  });

  // The whole point of the tool: this is the only path that may DROP a finding.
  it("a finding survives unless a MAJORITY of skeptics refute it", () => {
    const fx = fixture([FINDING]);
    // --dry-run makes every skeptic vote STANDS, so nothing is refuted.
    run([
      "--findings",
      fx.findings,
      "--diff",
      fx.diff,
      "--out",
      fx.out,
      "--voters",
      "3",
      "--dry-run",
    ]);
    expect(verdicts(fx)[0].verified.survives).toBe(true);
  });

  it("does not shell-inject on a hostile finding summary", () => {
    // A finding's summary is written by a model and can contain anything. Eval-ing
    // it would be a shell-injection hole in the tool whose job is catching security
    // bugs. The canary must not be created.
    const canary = path.join(os.tmpdir(), `adv-canary-${process.pid}`);
    const fx = fixture([
      { ...FINDING, summary: `it's a $(touch ${canary}) \`quote\` bomb` },
    ]);

    run([
      "--findings",
      fx.findings,
      "--diff",
      fx.diff,
      "--out",
      fx.out,
      "--voters",
      "1",
      "--dry-run",
    ]);

    expect(fs.existsSync(canary)).toBe(false);
    expect(verdicts(fx)[0].summary).toContain("quote");
  });

  it("keeps every finding when the input JSON is malformed", () => {
    // A parse failure must never silently discard findings — that would turn a
    // verification error into a green build.
    const fx = fixture("{ not json");
    const { code, out } = runCapturingStderr([
      "--findings",
      fx.findings,
      "--diff",
      fx.diff,
      "--out",
      fx.out,
      "--dry-run",
    ]);

    // Exit 0 on purpose: an unverifiable finding must not fail the build, it must
    // survive. But it must SAY SO — a silent pass here is the failure mode.
    expect(code).toBe(0);
    expect(out).toMatch(/SURVIVE unverified/i);
  });

  it("handles an empty findings list without error", () => {
    const fx = fixture([]);
    const { code } = run([
      "--findings",
      fx.findings,
      "--diff",
      fx.diff,
      "--out",
      fx.out,
      "--dry-run",
    ]);
    expect(code).toBe(0);
    expect(verdicts(fx)).toEqual([]);
  });

  it("exits 2 on missing required arguments rather than doing nothing quietly", () => {
    expect(run(["--voters", "3"]).code).toBe(2);
  });

  it("exits 2 when the findings file does not exist", () => {
    const fx = fixture([FINDING]);
    const { code } = run([
      "--findings",
      "/nonexistent/findings.json",
      "--diff",
      fx.diff,
      "--out",
      fx.out,
    ]);
    expect(code).toBe(2);
  });

  it("rejects a non-numeric voter count", () => {
    const fx = fixture([FINDING]);
    const { code } = run([
      "--findings",
      fx.findings,
      "--diff",
      fx.diff,
      "--out",
      fx.out,
      "--voters",
      "lots",
    ]);
    expect(code).toBe(2);
  });
});
