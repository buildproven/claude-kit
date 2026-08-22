const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const CLI = path.resolve(import.meta.dirname, "..", "vcycle-creator.js");

function runGit(repo, args) {
  const result = spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function invoke(args, environment = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
  const text = (result.status === 0 ? result.stdout : result.stderr).trim();
  return { ...result, json: JSON.parse(text) };
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function matrix() {
  return {
    schemaVersion: 1,
    artifacts: [
      { phase: "DISCOVER", reference: "discover.md" },
      { phase: "REQUIREMENTS", reference: "requirements.md" },
      { phase: "ARCHITECTURE", reference: "architecture.md" },
    ],
    requirements: [
      {
        id: "REQ-1",
        obligations: [
          { id: "unit-1", phase: "UNIT_VERIFY", gate: "lint" },
          { id: "system-1", phase: "SYSTEM_VERIFY", gate: "test" },
          { id: "release-1", phase: "RELEASE_VERIFY", gate: "security" },
        ],
      },
    ],
  };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vcycle-"));
  const repo = path.join(root, "repo");
  const cycle = path.join(root, "evidence");
  fs.mkdirSync(repo);
  fs.mkdirSync(cycle);
  writeJson(path.join(repo, "package.json"), {
    name: "vcycle-fixture",
    version: "1.0.0",
    scripts: {
      lint: `node -e "process.exit(process.env.VCYCLE_FAIL_LINT === '1' ? 1 : 0)"`,
      test: `node -e "process.exit(process.env.VCYCLE_FAIL_TEST === '1' ? 1 : 0)"`,
      "security:scan": `node -e "process.exit(process.env.VCYCLE_FAIL_SECURITY === '1' ? 1 : 0)"`,
    },
  });
  fs.writeFileSync(path.join(repo, "product.js"), "module.exports = 1\n");
  runGit(repo, ["init", "-b", "main"]);
  runGit(repo, ["config", "user.email", "test@example.com"]);
  runGit(repo, ["config", "user.name", "Test"]);
  runGit(repo, ["add", "."]);
  runGit(repo, ["commit", "-m", "initial"]);
  for (const name of [
    "brief.md",
    "discover.md",
    "requirements.md",
    "architecture.md",
  ]) {
    fs.writeFileSync(path.join(cycle, name), `${name}\n`);
  }
  writeJson(path.join(cycle, "matrix.json"), matrix());
  return { root, repo, cycle };
}

function command(cycle, verb, options = {}) {
  const args = [verb, "--cycle", cycle];
  for (const [name, value] of Object.entries(options))
    args.push(`--${name}`, value);
  return invoke(args);
}

function initialize(subject) {
  return invoke([
    "init",
    "--repo",
    subject.repo,
    "--evidence-dir",
    subject.cycle,
    "--brief",
    path.join(subject.cycle, "brief.md"),
  ]);
}

function reachBuild(subject) {
  initialize(subject);
  command(subject.cycle, "advance", {
    phase: "DISCOVER",
    evidence: path.join(subject.cycle, "discover.md"),
  });
  command(subject.cycle, "plan", {
    matrix: path.join(subject.cycle, "matrix.json"),
  });
  command(subject.cycle, "advance", {
    phase: "REQUIREMENTS",
    evidence: path.join(subject.cycle, "requirements.md"),
  });
  return command(subject.cycle, "advance", {
    phase: "ARCHITECTURE",
    evidence: path.join(subject.cycle, "architecture.md"),
  });
}

function commitBuild(subject, { gateSource = false } = {}) {
  const file = gateSource ? "package.json" : "product.js";
  fs.appendFileSync(
    path.join(subject.repo, file),
    gateSource ? "\n" : "module.exports.extra = true\n",
  );
  runGit(subject.repo, ["add", file]);
  runGit(subject.repo, ["commit", "-m", "build"]);
}

function recordAndAdvanceBuild(subject) {
  expect(command(subject.cycle, "record-build").status).toBe(0);
  return command(subject.cycle, "advance", { phase: "BUILD" });
}

describe("vcycle creator public CLI", () => {
  let subject;

  beforeEach(() => {
    subject = fixture();
  });

  afterEach(() => {
    fs.rmSync(subject.root, { recursive: true, force: true });
  });

  it("creates permissioned external state and rejects a symlinked evidence directory", () => {
    const result = initialize(subject);
    expect(result.status).toBe(0);
    const state = path.join(subject.cycle, "cycle.json");
    expect(fs.statSync(subject.cycle).mode & 0o777).toBe(0o700);
    expect(fs.statSync(state).mode & 0o777).toBe(0o600);

    const stateTarget = path.join(subject.root, "cycle-target.json");
    fs.copyFileSync(state, stateTarget);
    fs.unlinkSync(state);
    fs.symlinkSync(stateTarget, state);
    const stateRejected = command(subject.cycle, "status");
    expect(stateRejected.status).toBe(1);
    expect(stateRejected.json.code).toBe("UNSAFE_PATH");

    const other = fixture();
    const linked = path.join(other.root, "linked");
    fs.symlinkSync(other.cycle, linked);
    const rejected = invoke([
      "init",
      "--repo",
      other.repo,
      "--evidence-dir",
      linked,
      "--brief",
      path.join(other.cycle, "brief.md"),
    ]);
    expect(rejected.status).toBe(1);
    expect(rejected.json.code).toBe("UNSAFE_PATH");
    fs.rmSync(other.root, { recursive: true, force: true });
  });

  it("rejects incomplete and duplicate traceability contracts", () => {
    initialize(subject);
    command(subject.cycle, "advance", {
      phase: "DISCOVER",
      evidence: path.join(subject.cycle, "discover.md"),
    });
    const invalid = matrix();
    invalid.requirements.push(invalid.requirements[0]);
    writeJson(path.join(subject.cycle, "matrix.json"), invalid);
    const result = command(subject.cycle, "plan", {
      matrix: path.join(subject.cycle, "matrix.json"),
    });
    expect(result.status).toBe(1);
    expect(result.json.code).toBe("INVALID_MATRIX");
  });

  it("rejects package gates that can publish, deploy, install, or call network tools", () => {
    const packageFile = path.join(subject.repo, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageFile));
    packageJson.scripts.lint = "sh -c 'curl https://example.invalid'";
    writeJson(packageFile, packageJson);
    runGit(subject.repo, ["add", "package.json"]);
    runGit(subject.repo, ["commit", "-m", "unsafe gate"]);
    initialize(subject);
    command(subject.cycle, "advance", {
      phase: "DISCOVER",
      evidence: path.join(subject.cycle, "discover.md"),
    });
    const result = command(subject.cycle, "plan", {
      matrix: path.join(subject.cycle, "matrix.json"),
    });
    expect(result.status).toBe(1);
    expect(result.json.code).toBe("UNSAFE_GATE");
  });

  it("binds the traceability matrix exactly once", () => {
    initialize(subject);
    command(subject.cycle, "advance", {
      phase: "DISCOVER",
      evidence: path.join(subject.cycle, "discover.md"),
    });
    expect(
      command(subject.cycle, "plan", {
        matrix: path.join(subject.cycle, "matrix.json"),
      }).status,
    ).toBe(0);
    const before = JSON.parse(
      fs.readFileSync(path.join(subject.cycle, "cycle.json")),
    );
    const reduced = matrix();
    reduced.requirements[0].id = "REPLACEMENT";
    writeJson(path.join(subject.cycle, "matrix.json"), reduced);
    const result = command(subject.cycle, "plan", {
      matrix: path.join(subject.cycle, "matrix.json"),
    });
    expect(result.json.code).toBe("ALREADY_PLANNED");
    const after = JSON.parse(
      fs.readFileSync(path.join(subject.cycle, "cycle.json")),
    );
    expect(after.matrix.sha256).toBe(before.matrix.sha256);
  });

  it("stores an immutable matrix snapshot and rejects undeclared evidence", () => {
    reachBuild(subject);
    const stateBefore = JSON.parse(
      fs.readFileSync(path.join(subject.cycle, "cycle.json")),
    );
    writeJson(path.join(subject.cycle, "matrix.json"), { schemaVersion: 99 });
    const stateAfter = JSON.parse(
      fs.readFileSync(path.join(subject.cycle, "cycle.json")),
    );
    expect(stateAfter.matrix.sha256).toBe(stateBefore.matrix.sha256);
    expect(stateAfter.matrix.snapshot).toEqual(stateBefore.matrix.snapshot);

    const fresh = fixture();
    initialize(fresh);
    const bad = command(fresh.cycle, "advance", {
      phase: "DISCOVER",
      evidence: path.join(fresh.cycle, "brief.md"),
    });
    expect(bad.status).toBe(0);
    const planResult = command(fresh.cycle, "plan", {
      matrix: path.join(fresh.cycle, "matrix.json"),
    });
    expect(planResult.status).toBe(1);
    expect(planResult.json.code).toBe("UNKNOWN_EVIDENCE");
    fs.rmSync(fresh.root, { recursive: true, force: true });
  });

  it("rejects out-of-order transitions, caller receipts, and provider commands", () => {
    initialize(subject);
    expect(
      command(subject.cycle, "advance", { phase: "BUILD" }).json.code,
    ).toBe("OUT_OF_ORDER");
    expect(
      command(subject.cycle, "verify", {
        obligation: "unit-1",
        receipt: "/tmp/x",
      }).json.code,
    ).toBe("INVALID_ARGUMENT");
    expect(command(subject.cycle, "provider-run").json.code).toBe(
      "INVALID_ARGUMENT",
    );
  });

  it("binds a clean committed descendant build and rejects dirty or unchanged candidates", () => {
    reachBuild(subject);
    expect(command(subject.cycle, "record-build").json.code).toBe(
      "NO_BUILD_COMMIT",
    );
    fs.appendFileSync(path.join(subject.repo, "product.js"), "dirty\n");
    expect(command(subject.cycle, "record-build").json.code).toBe(
      "DIRTY_REPOSITORY",
    );
    runGit(subject.repo, ["restore", "product.js"]);
    commitBuild(subject);
    expect(
      command(subject.cycle, "advance", {
        phase: "BUILD",
        evidence: path.join(subject.cycle, "brief.md"),
      }).json.code,
    ).toBe("INVALID_ARGUMENT");
    const advanced = recordAndAdvanceBuild(subject);
    expect(advanced.status).toBe(0);
    expect(advanced.json.phase).toBe("UNIT_VERIFY");
    expect(advanced.json.candidateHead).toBe(
      runGit(subject.repo, ["rev-parse", "HEAD"]),
    );
  });

  it("recovers a clean descendant commit made during verification", () => {
    reachBuild(subject);
    commitBuild(subject);
    recordAndAdvanceBuild(subject);
    fs.appendFileSync(
      path.join(subject.repo, "product.js"),
      "module.exports.rework = true\n",
    );
    runGit(subject.repo, ["add", "product.js"]);
    runGit(subject.repo, ["commit", "-m", "early rework"]);
    const status = command(subject.cycle, "status");
    expect(status.json).toMatchObject({
      phase: "UNIT_VERIFY",
      nextAction: "record-build",
      repository: { candidateDiverged: true, dirty: false },
    });
    const recorded = command(subject.cycle, "record-build");
    expect(recorded.json.phase).toBe("BUILD");
    const advanced = command(subject.cycle, "advance", { phase: "BUILD" });
    expect(advanced.json.phase).toBe("UNIT_VERIFY");
    expect(advanced.json.candidateHead).toBe(
      runGit(subject.repo, ["rev-parse", "HEAD"]),
    );
  });

  it("rejects a committed build that is not a descendant of the candidate", () => {
    reachBuild(subject);
    runGit(subject.repo, ["checkout", "--orphan", "unrelated"]);
    runGit(subject.repo, ["commit", "--allow-empty", "-m", "unrelated"]);
    const result = command(subject.cycle, "record-build");
    expect(result.status).toBe(1);
    expect(result.json.code).toBe("GIT_FAILED");
  });

  it("runs the full V-cycle through creator-owned exact-candidate receipts", () => {
    reachBuild(subject);
    commitBuild(subject);
    recordAndAdvanceBuild(subject);
    for (const [phase, obligation] of [
      ["UNIT_VERIFY", "unit-1"],
      ["SYSTEM_VERIFY", "system-1"],
      ["RELEASE_VERIFY", "release-1"],
    ]) {
      const verified = command(subject.cycle, "verify", { obligation });
      expect(verified.status).toBe(0);
      expect(verified.json.exitCode).toBe(0);
      expect(command(subject.cycle, "advance", { phase }).status).toBe(0);
    }
    const result = command(subject.cycle, "status");
    expect(result.json).toMatchObject({
      phase: "COMPLETE",
      nextAction: null,
      incompleteObligations: [],
    });
  });

  it("records a failed verification and returns the cycle to BUILD", () => {
    reachBuild(subject);
    commitBuild(subject);
    recordAndAdvanceBuild(subject);
    const failed = invoke(
      ["verify", "--cycle", subject.cycle, "--obligation", "unit-1"],
      { VCYCLE_FAIL_LINT: "1" },
    );
    expect(failed.status).toBe(0);
    expect(failed.json.exitCode).toBe(1);
    const advanced = command(subject.cycle, "advance", {
      phase: "UNIT_VERIFY",
    });
    expect(advanced.json.phase).toBe("BUILD");
    const state = JSON.parse(
      fs.readFileSync(path.join(subject.cycle, "cycle.json")),
    );
    expect(state.failedReceipts).toHaveLength(1);
    expect(state.failedReceipts[0]).toMatchObject({
      obligationId: "unit-1",
      exitCode: 1,
    });
  });

  it("rejects dirty verification and uncontrolled HEAD changes", () => {
    reachBuild(subject);
    commitBuild(subject);
    recordAndAdvanceBuild(subject);
    fs.appendFileSync(path.join(subject.repo, "product.js"), "dirty\n");
    expect(
      command(subject.cycle, "verify", { obligation: "unit-1" }).json.code,
    ).toBe("DIRTY_REPOSITORY");
    runGit(subject.repo, ["restore", "product.js"]);
    fs.appendFileSync(path.join(subject.repo, "product.js"), "next\n");
    runGit(subject.repo, ["add", "product.js"]);
    runGit(subject.repo, ["commit", "-m", "uncontrolled"]);
    expect(
      command(subject.cycle, "verify", { obligation: "unit-1" }).json.code,
    ).toBe("STALE_CANDIDATE");
  });

  it("requires replan when a committed build changes gate sources", () => {
    reachBuild(subject);
    const packageFile = path.join(subject.repo, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageFile));
    packageJson.description = "gate source changed";
    writeJson(packageFile, packageJson);
    runGit(subject.repo, ["add", "package.json"]);
    runGit(subject.repo, ["commit", "-m", "change gates"]);
    const advanced = recordAndAdvanceBuild(subject);
    expect(advanced.json.phase).toBe("REPLAN_REQUIRED");
    expect(
      command(subject.cycle, "verify", { obligation: "unit-1" }).json.code,
    ).toBe("OUT_OF_ORDER");
    expect(command(subject.cycle, "replan").json.phase).toBe("UNIT_VERIFY");
  });
});
