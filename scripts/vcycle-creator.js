#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCHEMA_VERSION = 1;
const MATRIX_VERSION = 1;
const LOCK_WAIT_MS = 25;
const LOCK_TIMEOUT_MS = 2_000;
const VERIFY_TIMEOUT_MS = 5 * 60 * 1_000;
const LEFT_PHASES = ["DISCOVER", "REQUIREMENTS", "ARCHITECTURE"];
const VERIFY_PHASES = ["UNIT_VERIFY", "SYSTEM_VERIFY", "RELEASE_VERIFY"];
const TERMINAL_PHASE = "COMPLETE";
const ALL_PHASES = [
  ...LEFT_PHASES,
  "BUILD",
  ...VERIFY_PHASES,
  TERMINAL_PHASE,
  "REPLAN_REQUIRED",
];
const GATE_NAMES = new Set(["lint", "test", "security"]);
const GATE_SOURCE_NAMES = new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  ".quality-gates.json",
  ".buildproven/test-impact.json",
]);
const waitArray = new Int32Array(new SharedArrayBuffer(4));

class VCycleError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "VCycleError";
    this.code = code;
  }
}

function fail(message, code = "INVALID_ARGUMENT") {
  throw new VCycleError(message, code);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function canonicalText(value) {
  return JSON.stringify(canonical(value));
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`, "INVALID_JSON");
  }
}

function parseArguments(argv) {
  const [command, ...tokens] = argv;
  if (!command) fail("a command is required");
  const options = {};
  for (let index = 0; index < tokens.length; index += 2) {
    const flag = tokens[index];
    const value = tokens[index + 1];
    if (!flag?.startsWith("--") || flag.includes("=") || !value) {
      fail(`invalid argument near ${flag || "end of command"}`);
    }
    const name = flag.slice(2);
    if (Object.hasOwn(options, name)) fail(`duplicate option --${name}`);
    options[name] = value;
  }
  return { command, options };
}

function requireOption(options, name) {
  const value = options[name];
  if (typeof value !== "string" || !value) fail(`--${name} is required`);
  return value;
}

function assertOptions(options, allowed) {
  for (const name of Object.keys(options)) {
    if (!allowed.includes(name)) fail(`unexpected option --${name}`);
  }
}

function assertSafeExistingPath(target, kind) {
  const resolved = path.resolve(target);
  if (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink()) {
    fail(`refusing symlinked ${kind}: ${resolved}`, "UNSAFE_PATH");
  }
  return resolved;
}

function readRegularFile(file, label) {
  const resolved = assertSafeExistingPath(file, label);
  let descriptor;
  try {
    descriptor = fs.openSync(
      resolved,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    );
    if (!fs.fstatSync(descriptor).isFile()) {
      fail(`${label} is not a regular file`, "UNSAFE_PATH");
    }
    return fs.readFileSync(descriptor);
  } catch (error) {
    if (error instanceof VCycleError) throw error;
    fail(`cannot read ${label}: ${error.message}`, "UNSAFE_PATH");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function writeAtomic(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

function statePath(directory) {
  return path.join(path.resolve(directory), "cycle.json");
}

function readState(directory) {
  const file = statePath(directory);
  const raw = readRegularFile(file, "cycle state");
  const state = parseJson(raw.toString("utf8"), "cycle state");
  if (
    state.schemaVersion !== SCHEMA_VERSION ||
    typeof state.cycleId !== "string" ||
    !ALL_PHASES.includes(state.phase)
  ) {
    fail("cycle state has an unsupported schema", "INVALID_STATE");
  }
  return state;
}

function withLock(directory, callback) {
  const resolved = assertSafeExistingPath(directory, "evidence directory");
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  fs.chmodSync(resolved, 0o700);
  const lock = path.join(resolved, ".vcycle.lock");
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      fs.mkdirSync(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) fail("cycle state is busy", "LOCK_TIMEOUT");
      Atomics.wait(waitArray, 0, 0, LOCK_WAIT_MS);
    }
  }
  try {
    return callback(resolved);
  } finally {
    fs.rmdirSync(lock);
  }
}

function git(repo, args, options = {}) {
  const result = spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  if (result.error || result.status !== 0) {
    fail(`git ${args[0]} failed`, "GIT_FAILED");
  }
  return result.stdout.trim();
}

function repositoryIdentity(repoInput) {
  const repo = fs.realpathSync(assertSafeExistingPath(repoInput, "repository"));
  const root = fs.realpathSync(git(repo, ["rev-parse", "--show-toplevel"]));
  if (root !== repo) fail("--repo must be the repository root");
  return {
    realpath: root,
    commonDirHash: sha256(
      fs.realpathSync(
        path.resolve(root, git(root, ["rev-parse", "--git-common-dir"])),
      ),
    ),
  };
}

function head(repo) {
  return git(repo, ["rev-parse", "HEAD"]);
}

function tree(repo, revision = "HEAD") {
  return git(repo, ["rev-parse", `${revision}^{tree}`]);
}

function assertClean(repo) {
  if (git(repo, ["status", "--porcelain=v1", "--untracked-files=all"])) {
    fail("repository must be clean", "DIRTY_REPOSITORY");
  }
}

function assertCandidate(state) {
  assertClean(state.repo.realpath);
  if (head(state.repo.realpath) !== state.candidateHead) {
    fail(
      "repository HEAD differs from the controlled candidate",
      "STALE_CANDIDATE",
    );
  }
  if (tree(state.repo.realpath) !== state.candidateTree) {
    fail(
      "repository tree differs from the controlled candidate",
      "STALE_CANDIDATE",
    );
  }
}

function history(state, event, detail = {}) {
  state.history.push({ at: new Date().toISOString(), event, ...detail });
}

function init(options) {
  assertOptions(options, ["repo", "evidence-dir", "brief"]);
  const evidence = path.resolve(requireOption(options, "evidence-dir"));
  const repo = repositoryIdentity(requireOption(options, "repo"));
  const brief = readRegularFile(
    requireOption(options, "brief"),
    "product brief",
  );
  return withLock(evidence, (directory) => {
    if (fs.existsSync(statePath(directory))) {
      fail("cycle state already exists", "ALREADY_EXISTS");
    }
    assertClean(repo.realpath);
    const candidateHead = head(repo.realpath);
    const state = {
      schemaVersion: SCHEMA_VERSION,
      cycleId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      repo,
      brief: {
        path: path.resolve(options.brief),
        sha256: sha256(brief),
      },
      phase: "DISCOVER",
      candidateHead,
      candidateTree: tree(repo.realpath, candidateHead),
      matrix: null,
      gateContract: null,
      receipts: {},
      failedReceipts: [],
      phaseEvidence: {},
      history: [],
    };
    history(state, "initialized", { candidateHead });
    writeAtomic(statePath(directory), state);
    return {
      cycleId: state.cycleId,
      statePath: statePath(directory),
      phase: state.phase,
    };
  });
}

function validateArtifacts(artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    fail("traceability matrix has no left-side artifacts", "INVALID_MATRIX");
  }
  for (const phase of LEFT_PHASES) {
    if (
      !artifacts.some(
        (artifact) =>
          artifact?.phase === phase &&
          typeof artifact.reference === "string" &&
          artifact.reference.trim(),
      )
    ) {
      fail(
        `traceability matrix is missing a ${phase} artifact`,
        "INVALID_MATRIX",
      );
    }
  }
}

function validateRequirementIds(requirements) {
  if (!Array.isArray(requirements) || requirements.length === 0) {
    fail("traceability matrix has no requirements", "INVALID_MATRIX");
  }
  const requirementIds = requirements.map((item) => item?.id);
  if (requirementIds.some((id) => typeof id !== "string" || !id.trim())) {
    fail("requirement IDs must be non-empty strings", "INVALID_MATRIX");
  }
  if (new Set(requirementIds).size !== requirementIds.length) {
    fail("requirement IDs must be unique", "INVALID_MATRIX");
  }
  return requirementIds;
}

function matrixObligations(requirements) {
  const obligations = requirements.flatMap((requirement) =>
    Array.isArray(requirement.obligations)
      ? requirement.obligations.map((obligation) => ({
          ...obligation,
          requirementId: requirement.id,
        }))
      : [],
  );
  const obligationIds = obligations.map((item) => item.id);
  if (
    obligations.length === 0 ||
    obligationIds.some((id) => typeof id !== "string" || !id.trim()) ||
    new Set(obligationIds).size !== obligationIds.length
  ) {
    fail(
      "verification obligation IDs must be non-empty and unique",
      "INVALID_MATRIX",
    );
  }
  return obligations;
}

function validateObligationCoverage(obligations, requirementIds) {
  for (const obligation of obligations) {
    if (
      !VERIFY_PHASES.includes(obligation.phase) ||
      !GATE_NAMES.has(obligation.gate)
    ) {
      fail(
        `obligation ${obligation.id} has an invalid phase or gate`,
        "INVALID_MATRIX",
      );
    }
  }
  for (const phase of VERIFY_PHASES) {
    if (!obligations.some((item) => item.phase === phase)) {
      fail(`traceability matrix is missing ${phase}`, "INVALID_MATRIX");
    }
  }
  for (const requirementId of requirementIds) {
    if (
      !obligations.some(
        (item) =>
          item.requirementId === requirementId &&
          item.phase === "RELEASE_VERIFY",
      )
    ) {
      fail(
        `requirement ${requirementId} has no RELEASE_VERIFY obligation`,
        "INVALID_MATRIX",
      );
    }
  }
}

function validateMatrix(matrix) {
  if (matrix?.schemaVersion !== MATRIX_VERSION) {
    fail("traceability matrix must use schemaVersion 1", "INVALID_MATRIX");
  }
  validateArtifacts(matrix.artifacts);
  const requirementIds = validateRequirementIds(matrix.requirements);
  const obligations = matrixObligations(matrix.requirements);
  validateObligationCoverage(obligations, requirementIds);
  return { snapshot: canonical(matrix), obligations };
}

function gateSources(repo) {
  const sources = {};
  for (const relative of GATE_SOURCE_NAMES) {
    const file = path.join(repo, relative);
    if (fs.existsSync(file))
      sources[relative] = sha256(readRegularFile(file, "gate source"));
  }
  return sources;
}

function packageGateContract(repo) {
  const packageFile = path.join(repo, "package.json");
  if (!fs.existsSync(packageFile))
    fail(
      "package.json is required for the initial gate contract",
      "GATES_UNAVAILABLE",
    );
  const packageJson = parseJson(
    readRegularFile(packageFile, "package.json").toString("utf8"),
    "package.json",
  );
  const scripts = packageJson.scripts || {};
  const securityScript = scripts["security:scan"]
    ? "security:scan"
    : scripts["security:audit"]
      ? "security:audit"
      : null;
  if (!scripts.lint || !scripts.test || !securityScript) {
    fail(
      "package.json must define lint, test, and security:scan or security:audit",
      "GATES_UNAVAILABLE",
    );
  }
  for (const name of ["lint", "test", securityScript]) {
    const script = scripts[name];
    if (
      typeof script !== "string" ||
      /(^|[;&|]\s*|\s)(gh|curl|wget|ssh|scp)(\s|$)|\b(deploy|publish)\b|\b(npm|pnpm|yarn)\s+(i|install|add|publish)\b/i.test(
        script,
      )
    ) {
      fail(
        `package script ${name} is not an allowed non-mutating gate`,
        "UNSAFE_GATE",
      );
    }
  }
  return {
    candidateHead: head(repo),
    sources: gateSources(repo),
    gates: {
      lint: { executable: "npm", args: ["run", "lint"] },
      test: { executable: "npm", args: ["test"] },
      security: { executable: "npm", args: ["run", securityScript] },
    },
  };
}

function plan(options) {
  assertOptions(options, ["cycle", "matrix"]);
  const directory = path.resolve(requireOption(options, "cycle"));
  return withLock(directory, () => {
    const state = readState(directory);
    if (state.phase !== "REQUIREMENTS")
      fail("plan requires REQUIREMENTS phase", "OUT_OF_ORDER");
    assertCandidate(state);
    const raw = readRegularFile(
      requireOption(options, "matrix"),
      "traceability matrix",
    );
    const { snapshot, obligations } = validateMatrix(
      parseJson(raw.toString("utf8"), "traceability matrix"),
    );
    const gateContract = packageGateContract(state.repo.realpath);
    state.matrix = {
      schemaVersion: MATRIX_VERSION,
      sourcePath: path.resolve(options.matrix),
      snapshot,
      sha256: sha256(canonicalText(snapshot)),
      obligations,
      sourceDirectory: path.dirname(path.resolve(options.matrix)),
    };
    const discoverPath = state.phaseEvidence.DISCOVER?.path;
    const allowedDiscover = snapshot.artifacts
      .filter((artifact) => artifact.phase === "DISCOVER")
      .map((artifact) =>
        path.resolve(state.matrix.sourceDirectory, artifact.reference),
      );
    if (!discoverPath || !allowedDiscover.includes(discoverPath)) {
      fail(
        "DISCOVER evidence is not declared by the traceability matrix",
        "UNKNOWN_EVIDENCE",
      );
    }
    state.gateContract = gateContract;
    history(state, "planned", { matrixSha256: state.matrix.sha256 });
    writeAtomic(statePath(directory), state);
    return {
      cycleId: state.cycleId,
      phase: state.phase,
      matrixSha256: state.matrix.sha256,
    };
  });
}

function recordEvidence(state, phase, file) {
  const content = readRegularFile(file, `${phase} evidence`);
  state.phaseEvidence[phase] = {
    path: path.resolve(file),
    sha256: sha256(content),
    candidateHead: state.candidateHead,
  };
}

function receiptDigest(receipt) {
  return sha256(canonicalText({ ...receipt, digest: undefined }));
}

function recordBuild(options) {
  assertOptions(options, ["cycle"]);
  const directory = path.resolve(requireOption(options, "cycle"));
  return withLock(directory, () => {
    const state = readState(directory);
    if (state.phase !== "BUILD")
      fail("record-build requires BUILD phase", "OUT_OF_ORDER");
    assertClean(state.repo.realpath);
    const postBuildHead = head(state.repo.realpath);
    if (postBuildHead === state.candidateHead)
      fail("build must create a new committed candidate", "NO_BUILD_COMMIT");
    git(state.repo.realpath, [
      "merge-base",
      "--is-ancestor",
      state.candidateHead,
      postBuildHead,
    ]);
    const receipt = {
      schemaVersion: 1,
      kind: "build",
      cycleId: state.cycleId,
      preBuildHead: state.candidateHead,
      postBuildHead,
      postBuildTree: tree(state.repo.realpath, postBuildHead),
      recordedAt: new Date().toISOString(),
    };
    receipt.digest = receiptDigest(receipt);
    state.receipts.build = receipt;
    history(state, "build-recorded", { postBuildHead });
    writeAtomic(statePath(directory), state);
    return {
      cycleId: state.cycleId,
      phase: state.phase,
      receipt: "build",
      postBuildHead,
    };
  });
}

function obligation(state, id) {
  const found = state.matrix?.obligations?.find((item) => item.id === id);
  if (!found) fail(`unknown obligation ${id}`, "UNKNOWN_OBLIGATION");
  return found;
}

function verify(options) {
  assertOptions(options, ["cycle", "obligation"]);
  const directory = path.resolve(requireOption(options, "cycle"));
  return withLock(directory, () => {
    const state = readState(directory);
    if (!VERIFY_PHASES.includes(state.phase))
      fail("verify requires a verification phase", "OUT_OF_ORDER");
    assertCandidate(state);
    const item = obligation(state, requireOption(options, "obligation"));
    if (item.phase !== state.phase)
      fail(`obligation ${item.id} belongs to ${item.phase}`, "OUT_OF_ORDER");
    const command = state.gateContract?.gates?.[item.gate];
    if (
      !command ||
      command.executable !== "npm" ||
      !Array.isArray(command.args)
    ) {
      fail(
        `gate ${item.gate} is not in the immutable contract`,
        "INVALID_STATE",
      );
    }
    const startedAt = new Date().toISOString();
    const result = spawnSync(command.executable, command.args, {
      cwd: state.repo.realpath,
      encoding: "utf8",
      timeout: VERIFY_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "true" },
    });
    assertCandidate(state);
    const exitCode = Number.isInteger(result.status) ? result.status : 1;
    const receipt = {
      schemaVersion: 1,
      kind: "verification",
      cycleId: state.cycleId,
      obligationId: item.id,
      requirementId: item.requirementId,
      phase: item.phase,
      gate: item.gate,
      candidateHead: state.candidateHead,
      candidateTree: state.candidateTree,
      command,
      startedAt,
      finishedAt: new Date().toISOString(),
      exitCode,
      outputSha256: sha256(`${result.stdout || ""}\0${result.stderr || ""}`),
      cleanBefore: true,
      cleanAfter: true,
    };
    receipt.digest = receiptDigest(receipt);
    state.receipts[item.id] = receipt;
    history(state, "verification-recorded", {
      obligationId: item.id,
      exitCode,
    });
    writeAtomic(statePath(directory), state);
    return {
      cycleId: state.cycleId,
      phase: state.phase,
      obligationId: item.id,
      exitCode,
    };
  });
}

function verifyReceipt(state, item) {
  const receipt = state.receipts[item.id];
  if (
    receipt?.kind !== "verification" ||
    receipt.cycleId !== state.cycleId ||
    receipt.obligationId !== item.id ||
    receipt.requirementId !== item.requirementId ||
    receipt.phase !== item.phase ||
    receipt.candidateHead !== state.candidateHead ||
    receipt.candidateTree !== state.candidateTree ||
    receipt.cleanBefore !== true ||
    receipt.cleanAfter !== true ||
    canonicalText(receipt.command) !==
      canonicalText(state.gateContract.gates[item.gate]) ||
    receipt.digest !== receiptDigest(receipt)
  ) {
    fail(
      `missing or invalid creator receipt for ${item.id}`,
      "RECEIPT_INVALID",
    );
  }
  return receipt;
}

function advanceLeft(state, options) {
  const phase = state.phase;
  if (options.phase !== phase)
    fail(`advance must name current phase ${phase}`, "OUT_OF_ORDER");
  if (state.matrix) {
    const evidencePath = path.resolve(requireOption(options, "evidence"));
    const declared = state.matrix.snapshot.artifacts
      .filter((artifact) => artifact.phase === phase)
      .map((artifact) =>
        path.resolve(state.matrix.sourceDirectory, artifact.reference),
      );
    if (!declared.includes(evidencePath)) {
      fail(
        `${phase} evidence is not declared by the traceability matrix`,
        "UNKNOWN_EVIDENCE",
      );
    }
  }
  recordEvidence(state, phase, requireOption(options, "evidence"));
  const index = LEFT_PHASES.indexOf(phase);
  if (phase === "REQUIREMENTS" && !state.matrix)
    fail("REQUIREMENTS cannot advance before plan", "PLAN_REQUIRED");
  state.phase =
    index === LEFT_PHASES.length - 1 ? "BUILD" : LEFT_PHASES[index + 1];
}

function advanceBuild(state, options) {
  if (options.phase !== "BUILD")
    fail("advance must name current phase BUILD", "OUT_OF_ORDER");
  const receipt = state.receipts.build;
  if (
    receipt?.cycleId !== state.cycleId ||
    receipt.kind !== "build" ||
    receipt.preBuildHead !== state.candidateHead ||
    typeof receipt.postBuildHead !== "string" ||
    typeof receipt.postBuildTree !== "string" ||
    receipt.digest !== receiptDigest(receipt)
  ) {
    fail("missing or invalid creator build receipt", "RECEIPT_INVALID");
  }
  assertClean(state.repo.realpath);
  if (
    head(state.repo.realpath) !== receipt.postBuildHead ||
    tree(state.repo.realpath) !== receipt.postBuildTree
  ) {
    fail(
      "build receipt does not match the checked-out candidate",
      "STALE_CANDIDATE",
    );
  }
  git(state.repo.realpath, [
    "merge-base",
    "--is-ancestor",
    state.candidateHead,
    receipt.postBuildHead,
  ]);
  state.candidateHead = receipt.postBuildHead;
  state.candidateTree = receipt.postBuildTree;
  state.receipts = { build: receipt };
  if (
    canonicalText(gateSources(state.repo.realpath)) !==
    canonicalText(state.gateContract.sources)
  ) {
    state.phase = "REPLAN_REQUIRED";
  } else {
    state.phase = "UNIT_VERIFY";
  }
}

function advanceVerification(state, options) {
  if (options.phase !== state.phase)
    fail(`advance must name current phase ${state.phase}`, "OUT_OF_ORDER");
  const obligations = state.matrix.obligations.filter(
    (item) => item.phase === state.phase,
  );
  const receipts = obligations.map((item) => verifyReceipt(state, item));
  if (receipts.some((receipt) => receipt.exitCode !== 0)) {
    history(state, "verification-failed", { phase: state.phase });
    const failedIndex = VERIFY_PHASES.indexOf(state.phase);
    for (const [id, receipt] of Object.entries(state.receipts)) {
      if (
        receipt.kind === "verification" &&
        VERIFY_PHASES.indexOf(receipt.phase) >= failedIndex
      ) {
        state.failedReceipts.push(receipt);
        delete state.receipts[id];
      }
    }
    delete state.receipts.build;
    state.phase = "BUILD";
    return;
  }
  const index = VERIFY_PHASES.indexOf(state.phase);
  state.phase =
    index === VERIFY_PHASES.length - 1
      ? TERMINAL_PHASE
      : VERIFY_PHASES[index + 1];
}

function advance(options) {
  assertOptions(options, ["cycle", "phase", "evidence"]);
  const directory = path.resolve(requireOption(options, "cycle"));
  return withLock(directory, () => {
    const state = readState(directory);
    if ([TERMINAL_PHASE, "REPLAN_REQUIRED"].includes(state.phase))
      fail("cycle cannot advance in its current phase", "OUT_OF_ORDER");
    if (state.phase === "BUILD") assertClean(state.repo.realpath);
    else assertCandidate(state);
    const from = state.phase;
    if (LEFT_PHASES.includes(state.phase)) advanceLeft(state, options);
    else if (state.phase === "BUILD") advanceBuild(state, options);
    else advanceVerification(state, options);
    history(state, "advanced", { from, to: state.phase });
    writeAtomic(statePath(directory), state);
    return {
      cycleId: state.cycleId,
      phase: state.phase,
      candidateHead: state.candidateHead,
    };
  });
}

function replan(options) {
  assertOptions(options, ["cycle"]);
  const directory = path.resolve(requireOption(options, "cycle"));
  return withLock(directory, () => {
    const state = readState(directory);
    if (state.phase !== "REPLAN_REQUIRED")
      fail("replan requires REPLAN_REQUIRED phase", "OUT_OF_ORDER");
    assertCandidate(state);
    validateMatrix(state.matrix.snapshot);
    state.gateContract = packageGateContract(state.repo.realpath);
    state.receipts = {};
    state.phase = "UNIT_VERIFY";
    history(state, "replanned", { candidateHead: state.candidateHead });
    writeAtomic(statePath(directory), state);
    return {
      cycleId: state.cycleId,
      phase: state.phase,
      candidateHead: state.candidateHead,
    };
  });
}

function status(options) {
  assertOptions(options, ["cycle"]);
  const state = readState(path.resolve(requireOption(options, "cycle")));
  const obligations = state.matrix?.obligations || [];
  const incomplete = obligations
    .filter((item) => {
      const receipt = state.receipts[item.id];
      return (
        receipt?.exitCode !== 0 || receipt.candidateHead !== state.candidateHead
      );
    })
    .map((item) => item.id);
  return {
    cycleId: state.cycleId,
    phase: state.phase,
    candidateHead: state.candidateHead,
    nextAction: {
      DISCOVER: "advance",
      REQUIREMENTS: state.matrix ? "advance" : "plan",
      ARCHITECTURE: "advance",
      BUILD: "record-build",
      UNIT_VERIFY: "verify",
      SYSTEM_VERIFY: "verify",
      RELEASE_VERIFY: "verify",
      REPLAN_REQUIRED: "replan",
      COMPLETE: null,
    }[state.phase],
    incompleteObligations: incomplete,
  };
}

function run(argv = process.argv.slice(2)) {
  const { command, options } = parseArguments(argv);
  const handlers = {
    init,
    plan,
    advance,
    status,
    "record-build": recordBuild,
    verify,
    replan,
  };
  if (!Object.hasOwn(handlers, command)) fail(`unknown command ${command}`);
  const result = handlers[command](options);
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
}

module.exports = {
  VCycleError,
  canonicalText,
  parseArguments,
  receiptDigest,
  run,
  validateMatrix,
};

if (require.main === module) {
  try {
    run();
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ ok: false, code: error.code || "INTERNAL", error: error.message })}\n`,
    );
    process.exitCode = 1;
  }
}
