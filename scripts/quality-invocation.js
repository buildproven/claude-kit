#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const riskScore = require("./risk-score.js");

const SCHEMA_VERSION = 1;
const REQUIRED_GATES_POLICY_VERSION = 2;
const NEEDS_REQUIRED_GATES_MIGRATION = Symbol("needs-required-gates-migration");

function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`, {
      cause: error,
    });
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function canonicalRoot(input) {
  const resolved = fs.realpathSync(input);
  return fs.realpathSync(git(resolved, ["rev-parse", "--show-toplevel"]));
}

// Stable identity for "the reviewed diff" that survives a pure rebase (same
// tree changes replayed onto a newer base, no new content). `git patch-id`
// hashes the diff hunks independent of blob/commit SHAs, so a rebase-only
// HEAD change yields the same patch-id while any real content change does
// not. Returns null if the ref has no diff against base (e.g. identical to
// base) or patch-id computation fails, so callers must treat null as
// "cannot prove equivalence" rather than a wildcard match.
function computePatchId(root, base, head) {
  try {
    const diff = execFileSync("git", ["diff", `${base}..${head}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 1024 * 1024 * 64,
    });
    if (!diff.trim()) return null;
    const patchId = execFileSync("git", ["patch-id", "--stable"], {
      cwd: root,
      encoding: "utf8",
      input: diff,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const hash = patchId.split(/\s+/)[0];
    return /^[0-9a-f]{40}$/.test(hash) ? hash : null;
  } catch {
    return null;
  }
}

// Patch-id of the currently reviewed HEAD against a freshly resolved base.
// Always recompute the base from the live ref rather than the manifest's
// stored baseSha snapshot — the stored value is fixed at creation time and
// would make every post-creation rebase look like a diff change even when
// only the base moved.
function currentPatchId(manifest, root) {
  const baseRef = manifest.revisions.baseRef;
  if (!baseRef) return null;
  let base;
  try {
    base = git(root, ["merge-base", "HEAD", baseRef]);
  } catch {
    return null;
  }
  return computePatchId(root, base, "HEAD");
}

function isAncestorOf(root, ancestor, descendant) {
  try {
    git(root, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

function gitCommonDir(root) {
  const value = git(root, ["rev-parse", "--git-common-dir"]);
  return fs.realpathSync(path.resolve(root, value));
}

function originIdentity(root) {
  const value = git(root, ["remote", "get-url", "origin"]);
  if (!value) throw new Error("quality requires an origin remote identity");
  return value;
}

function repoKey(root) {
  return crypto
    .createHash("sha256")
    .update(gitCommonDir(root))
    .digest("hex")
    .slice(0, 16);
}

function deterministicInvocationId(identity) {
  const digest = crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalJson(identity)))
    .digest("hex")
    .slice(0, 32)
    .split("");
  digest[12] = "5";
  digest[16] = (8 + (parseInt(digest[16], 16) % 4)).toString(16);
  const value = digest.join("");
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20),
  ].join("-");
}

function qualityTmpRoot() {
  return fs.realpathSync(process.env.TMPDIR || os.tmpdir());
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

function atomicCreate(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.create`,
  );
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  try {
    fs.linkSync(temporary, file);
    fs.chmodSync(file, 0o600);
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  } finally {
    fs.unlinkSync(temporary);
  }
}

function normalizeGovernor(manifest) {
  manifest.governor ??= {};
  manifest.governor.authorizedAttempts ??= [];
  manifest.governor.maxProviderAttempts ??= 6;
  manifest.governor.providerWindowSeconds ??= 3600;
  manifest.governor.providerDeadlineEpoch ??=
    manifest.governor.startedAtEpoch + manifest.governor.providerWindowSeconds;
  manifest.governor.providerDeadlineHead ??= null;
  manifest.governor.providerDeadlineProvider ??= null;
  manifest.governor.providerAttempts ??= [];
  manifest.governor.campaignSeconds ??=
    manifest.governor.providerWindowSeconds +
    manifest.governor.remediationSeconds +
    manifest.governor.reReviewReserveSeconds;
  manifest.governor.campaignDeadlineEpoch ??=
    manifest.governor.startedAtEpoch + manifest.governor.campaignSeconds;
  manifest.governor.validationDeadlineEpoch ??= null;
}

function normalizeManifestCollections(manifest) {
  manifest.reviews ??= [];
  manifest.gates ??= [];
  manifest.merge ??= {};
  manifest.merge.invalidatedStamps ??= [];
  normalizeGovernor(manifest);
  if (
    manifest.requiredGatesPolicyVersion === undefined ||
    manifest.requiredGatesPolicyVersion === 1
  ) {
    Object.defineProperty(manifest, NEEDS_REQUIRED_GATES_MIGRATION, {
      value: true,
      writable: true,
    });
  } else if (
    manifest.requiredGatesPolicyVersion !== REQUIRED_GATES_POLICY_VERSION
  ) {
    throw new Error(
      `unsupported required-gates policy version ${manifest.requiredGatesPolicyVersion}`,
    );
  }
  manifest.requiredGates ??= [];
}

function loadManifest(file) {
  const requested = path.resolve(file);
  const stat = fs.lstatSync(requested);
  if (stat.isSymbolicLink()) {
    throw new Error("quality manifest must not be a symlink");
  }
  const manifestPath = fs.realpathSync(requested);
  const manifest = parseJson(
    fs.readFileSync(manifestPath, "utf8"),
    "quality manifest",
  );
  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `unsupported quality manifest schema ${manifest.schemaVersion}`,
    );
  }
  normalizeManifestCollections(manifest);
  if (
    !manifest.invocationId ||
    !manifest.repo?.realpath ||
    !manifest.revisions?.baseSha ||
    !manifest.revisions?.currentHead
  ) {
    throw new Error("quality manifest is missing required identity fields");
  }
  const expectedPath = path.join(manifest.stateRoot, "invocation.json");
  if (path.resolve(expectedPath) !== manifestPath) {
    throw new Error("quality manifest path does not match its stateRoot");
  }
  const expectedStateRoot = path.join(
    qualityTmpRoot(),
    "bs-quality",
    manifest.repo.key,
    `pr-${manifest.repo.pr ?? "none"}`,
    manifest.revisions.baseSha,
    manifest.invocationId,
  );
  if (path.resolve(expectedStateRoot) !== path.resolve(manifest.stateRoot)) {
    throw new Error("quality manifest stateRoot identity is invalid");
  }
  return { manifest, manifestPath };
}

function saveManifest(file, manifest) {
  manifest.updatedAt = new Date().toISOString();
  manifest.manifestRevision = (manifest.manifestRevision || 0) + 1;
  atomicWrite(file, manifest);
}

// manifest.revisions.baseSha is an immutable creation-time snapshot (it also
// namespaces stateRoot and anchors review-trailer provenance, so it is never
// reassigned). A base that has legitimately moved since then (main advanced
// and the PR branch was rebased onto it) always fails an exact-match against
// actualBase — that used to be unreachable because advanceHead() refused any
// HEAD that wasn't a strict descendant of the reviewed head. BUI-380 lets a
// proven rebase-only replay (patch-id identical) through advanceHead(),
// which records that proof in manifest.revisions.baseRebaseCarry: { head,
// baseSha } naming the head and live base reconciled at the moment of the
// rebase. baseSha permanently mismatches actualBase after that (merge-base
// is now computed against a different, later base forever), so trust is
// anchored on baseRebaseCarry.baseSha instead, once a carry exists.
// currentHead is accepted either as the exact carried head (the rebase
// replay itself) or as a normal git-ancestry descendant of it (ordinary new
// commits stacked afterward, same as pre-BUI-380 behavior relative to the
// original base) — descendants are NOT required to patch-id match anything;
// that requirement only ever applied to the rebase replay commit itself.
function baseIdentityMatches(manifest, actualRoot, currentHead, actualBase) {
  if (actualBase === manifest.revisions.baseSha) return true;
  const carry = manifest.revisions.baseRebaseCarry;
  return Boolean(
    carry &&
    typeof carry.baseSha === "string" &&
    carry.baseSha === actualBase &&
    (carry.head === currentHead ||
      isAncestorOf(actualRoot, carry.head, currentHead)),
  );
}

function validateIdentity(manifest, cwd, { requireHead = true } = {}) {
  const actualRoot = canonicalRoot(cwd);
  if (actualRoot !== manifest.repo.realpath) {
    throw new Error(
      `quality repository identity mismatch: expected ${manifest.repo.realpath}, got ${actualRoot}`,
    );
  }
  if (gitCommonDir(actualRoot) !== manifest.repo.gitCommonDir) {
    throw new Error("quality git common-dir identity mismatch");
  }
  if (originIdentity(actualRoot) !== manifest.repo.origin) {
    throw new Error("quality origin remote identity mismatch");
  }
  const currentHead = git(actualRoot, ["rev-parse", "HEAD"]);
  if (requireHead && currentHead !== manifest.revisions.currentHead) {
    if (!isEmptyStampCommit(actualRoot, manifest.revisions.currentHead)) {
      throw new Error(
        `quality revision identity mismatch: expected ${manifest.revisions.currentHead}, got ${currentHead}`,
      );
    }
  }
  // requireHead:false marks the pre-advance identity check in runAdvance()
  // (see below): HEAD may already be a rebased commit whose base-relative
  // identity is not yet proven (that's exactly what advanceHead() is about
  // to establish, recording proof in baseRebaseCarry for the post-advance
  // re-check with requireHead left at its default). Skip the base check
  // here rather than duplicating advanceHead()'s rebase-equivalence logic
  // ahead of time.
  if (!requireHead) return { actualRoot, currentHead };
  const actualBase = git(actualRoot, [
    "merge-base",
    currentHead,
    manifest.revisions.baseRef,
  ]);
  if (!baseIdentityMatches(manifest, actualRoot, currentHead, actualBase)) {
    throw new Error(
      `quality base identity mismatch: expected ${manifest.revisions.baseSha}, got ${actualBase}`,
    );
  }
  return { actualRoot, currentHead };
}

function isEmptyStampCommit(root, reviewedHead, stampHead = "HEAD") {
  try {
    const parent = git(root, ["rev-parse", `${stampHead}~1`]);
    execFileSync("git", ["diff", "--quiet", `${stampHead}~1`, stampHead], {
      cwd: root,
      stdio: "ignore",
    });
    return parent === reviewedHead;
  } catch {
    return false;
  }
}

function parseInteger(value, name, { minimum = 0 } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return parsed;
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== "");
}

function committedFile(root, head, file) {
  try {
    return git(root, ["show", `${head}:${file}`]);
  } catch {
    return null;
  }
}

function committedPathExists(root, head, pathspec) {
  try {
    return (
      git(root, ["ls-tree", "-r", "--name-only", head, "--", pathspec]) !== ""
    );
  } catch {
    return false;
  }
}

function packageManagerAt(root, head, packageJson) {
  const declared = String(packageJson.packageManager || "").split("@")[0];
  if (["npm", "pnpm", "yarn", "bun"].includes(declared)) return declared;
  if (committedFile(root, head, "pnpm-lock.yaml") !== null) return "pnpm";
  if (committedFile(root, head, "yarn.lock") !== null) return "yarn";
  if (
    committedFile(root, head, "bun.lock") !== null ||
    committedFile(root, head, "bun.lockb") !== null
  ) {
    return "bun";
  }
  return "npm";
}

function scriptGate(name, script, manager, allowSkip = false) {
  return {
    name,
    source: `package-script:${script}`,
    command: `${manager} run ${script}`,
    executable: manager,
    args: ["run", script],
    allowSkip,
  };
}

function baselineGate(name, scripts, candidates, manager, allowSkip = false) {
  const script = candidates.find((candidate) =>
    Object.hasOwn(scripts, candidate),
  );
  if (script) return scriptGate(name, script, manager, allowSkip);
  return allowSkip
    ? {
        name,
        source: "baseline-policy",
        command: `external:${name}`,
        executable: null,
        args: [],
        allowSkip,
      }
    : null;
}

function directGate(name, source, executable, args, allowSkip = false) {
  return {
    name,
    source,
    command: [executable, ...args]
      .map((part) => JSON.stringify(part))
      .join(" "),
    executable,
    args,
    allowSkip,
  };
}

function hasPythonTool(pyproject, tool) {
  return new RegExp(`^\\s*\\[tool\\.${tool}(?:[.\\]]|$)`, "m").test(pyproject);
}

function pythonGate(root, head, name, pyproject, allowSkip = false) {
  if (name === "lint" && hasPythonTool(pyproject, "ruff")) {
    return directGate(name, "python:ruff", "ruff", ["check", "."], allowSkip);
  }
  if (
    name === "test" &&
    (hasPythonTool(pyproject, "pytest") ||
      committedFile(root, head, "pytest.ini") !== null ||
      committedFile(root, head, "tox.ini") !== null ||
      committedPathExists(root, head, "tests"))
  ) {
    return directGate(name, "python:pytest", "pytest", [], allowSkip);
  }
  if (name === "security") {
    return directGate(name, "python:pip-audit", "pip-audit", [], allowSkip);
  }
  if (name === "type" && hasPythonTool(pyproject, "mypy")) {
    return directGate(name, "python:mypy", "mypy", [], allowSkip);
  }
  return null;
}

function preferredRequiredGate({
  root,
  head,
  nativeGates,
  scripts,
  manager,
  pyproject,
  name,
  candidates,
  allowSkip = false,
}) {
  if (nativeGates.has(name)) {
    return nativeGate(name, nativeGates.get(name), allowSkip);
  }
  return (
    baselineGate(name, scripts, candidates, manager, allowSkip) ||
    pythonGate(root, head, name, pyproject, allowSkip)
  );
}

function optionalTypeGate({
  root,
  head,
  nativeGates,
  scripts,
  manager,
  pyproject,
}) {
  if (nativeGates.has("type")) {
    return nativeGate("type", nativeGates.get("type"));
  }
  const typeScript = ["type-check:all", "type-check", "typecheck"].find(
    (name) => typeof scripts[name] === "string",
  );
  return typeScript
    ? scriptGate("type", typeScript, manager)
    : pythonGate(root, head, "type", pyproject);
}

const NATIVE_GATES_FILE = ".quality-gates.json";
const NATIVE_GATE_NAMES = new Set([
  "lint",
  "test",
  "security",
  "build",
  "type",
  "consumer",
]);

function nativeGate(name, definition, allowSkip = false) {
  const argv = [definition.executable, ...definition.args];
  return {
    name,
    source: `quality-gates:${NATIVE_GATES_FILE}#${name}`,
    command: argv.map((part) => JSON.stringify(part)).join(" "),
    executable: definition.executable,
    args: definition.args,
    allowSkip,
  };
}

function validateNativeGateDefinition(name, definition) {
  const invalid =
    !definition ||
    Array.isArray(definition) ||
    typeof definition !== "object" ||
    typeof definition.executable !== "string" ||
    definition.executable.trim() === "" ||
    definition.executable.includes("\0") ||
    !Array.isArray(definition.args) ||
    definition.args.some(
      (argument) => typeof argument !== "string" || argument.includes("\0"),
    );
  if (invalid) {
    throw new Error(
      `${NATIVE_GATES_FILE} gate '${name}' requires a non-empty executable and string args array`,
    );
  }
  const unsupported = Object.keys(definition).filter(
    (key) => !["executable", "args"].includes(key),
  );
  if (unsupported.length > 0) {
    throw new Error(
      `${NATIVE_GATES_FILE} gate '${name}' has unsupported fields: ${unsupported.join(", ")}`,
    );
  }
  return definition;
}

function discoverNativeGates(root, head) {
  const content = committedFile(root, head, NATIVE_GATES_FILE);
  if (content === null) return new Map();
  const policy = parseJson(content, `${NATIVE_GATES_FILE} at ${head}`);
  if (
    !policy ||
    Array.isArray(policy) ||
    policy.version !== 1 ||
    !policy.gates ||
    Array.isArray(policy.gates) ||
    typeof policy.gates !== "object"
  ) {
    throw new Error(
      `${NATIVE_GATES_FILE} must contain version 1 and a gates object`,
    );
  }

  const gates = new Map();
  for (const [name, definition] of Object.entries(policy.gates)) {
    if (!NATIVE_GATE_NAMES.has(name)) {
      throw new Error(
        `${NATIVE_GATES_FILE} declares unsupported gate '${name}'`,
      );
    }
    gates.set(name, validateNativeGateDefinition(name, definition));
  }
  return gates;
}

function discoverRequiredGates(
  root,
  options,
  head = git(root, ["rev-parse", "HEAD"]),
) {
  const packageContent = committedFile(root, head, "package.json");
  let scripts = {};
  let packageJson = {};
  if (packageContent !== null) {
    packageJson = parseJson(packageContent, `package.json at ${head}`);
    scripts = packageJson.scripts || {};
  }
  const manager = packageManagerAt(root, head, packageJson);
  const pyproject = committedFile(root, head, "pyproject.toml") || "";
  const nativeGates = discoverNativeGates(root, head);
  const requiredGate = (name, candidates, allowSkip = false) =>
    preferredRequiredGate({
      root,
      head,
      nativeGates,
      scripts,
      manager,
      pyproject,
      name,
      candidates,
      allowSkip,
    });
  const required = [
    requiredGate("lint", ["lint", "lint:check"]),
    requiredGate(
      "test",
      ["test", "test:unit", "test:ci"],
      options["skip-tests"] === true,
    ),
    requiredGate("security", ["security:audit", "security:check", "security"]),
  ].filter(Boolean);
  const missing = ["lint", "security"].filter(
    (name) => !required.some((gate) => gate.name === name),
  );
  if (
    options["skip-tests"] !== true &&
    !required.some((gate) => gate.name === "test")
  ) {
    missing.push("test");
  }
  if (missing.length > 0) {
    throw new Error(
      `quality requires executable npm or Python repository gates for: ${missing.join(", ")}`,
    );
  }
  if (nativeGates.has("build")) {
    required.push(nativeGate("build", nativeGates.get("build")));
  } else if (typeof scripts.build === "string") {
    required.push(scriptGate("build", "build", manager));
  }
  const typeGate = optionalTypeGate({
    root,
    head,
    nativeGates,
    scripts,
    manager,
    pyproject,
  });
  if (typeGate) required.push(typeGate);
  const consumerScript = Object.keys(scripts).find((name) =>
    /^test:consumer(?:$|[-:])/.test(name),
  );
  const consumerFixture =
    committedFile(root, head, "tests/consumer-workflow-integration.test.js") !==
    null;
  if (nativeGates.has("consumer")) {
    required.push(nativeGate("consumer", nativeGates.get("consumer")));
  } else if (consumerScript || consumerFixture) {
    required.push(
      consumerScript
        ? scriptGate("consumer", consumerScript, manager)
        : {
            name: "consumer",
            source: "fixture:tests/consumer-workflow-integration.test.js",
            command: "node tests/consumer-workflow-integration.test.js",
            executable: process.execPath,
            args: ["tests/consumer-workflow-integration.test.js"],
            allowSkip: false,
          },
    );
  }
  return required;
}

function unionRequiredGates(existing, discovered) {
  const required = [...existing];
  for (const gate of discovered) {
    if (!required.some((current) => current.name === gate.name)) {
      required.push(gate);
    }
  }
  return required;
}

function buildProvider(options) {
  return {
    primaryOverride: firstValue(
      options.primary,
      process.env.BS_QUALITY_PRIMARY,
      "",
    ),
    fallbackOverride: firstValue(
      options.fallback,
      process.env.BS_QUALITY_FALLBACK,
      "",
    ),
    config: firstValue(
      options["provider-config"],
      process.env.BS_QUALITY_PROVIDER_CONFIG,
      "",
    ),
  };
}

function governorInteger(name, fallback, label, minimum = 0) {
  return parseInteger(firstValue(process.env[name], fallback), label, {
    minimum,
  });
}

function buildGovernor(head) {
  const startedAtEpoch = Math.floor(Date.now() / 1000);
  const providerDeadlineSeconds = governorInteger(
    "BS_QUALITY_MAX_PROVIDER_SECONDS",
    "3600",
    "provider deadline seconds",
    1,
  );
  return {
    startedAtEpoch,
    maxFixCommits: governorInteger(
      "BS_QUALITY_MAX_FIX_COMMITS",
      "4",
      "max fix commits",
    ),
    maxReviewRounds: governorInteger(
      "BS_QUALITY_MAX_REVIEW_ROUNDS",
      "2",
      "max review rounds",
      1,
    ),
    maxReviewRoundsExplicit:
      process.env.BS_QUALITY_MAX_REVIEW_ROUNDS !== undefined,
    remediationSeconds: governorInteger(
      "BS_QUALITY_MAX_REMEDIATION_SECONDS",
      "900",
      "remediation seconds",
      1,
    ),
    reReviewReserveSeconds: governorInteger(
      "BS_QUALITY_REREVIEW_RESERVE_SECONDS",
      "900",
      "re-review reserve seconds",
      1,
    ),
    roundsUsed: 0,
    authorizedAttempts: [],
    maxProviderAttempts: governorInteger(
      "BS_QUALITY_MAX_PROVIDER_ATTEMPTS",
      "6",
      "max provider attempts",
      1,
    ),
    providerWindowSeconds: providerDeadlineSeconds,
    providerDeadlineEpoch: startedAtEpoch + providerDeadlineSeconds,
    providerDeadlineHead: head,
    providerAttempts: [],
    campaignSeconds: providerDeadlineSeconds,
    campaignDeadlineEpoch: startedAtEpoch + providerDeadlineSeconds,
    validationDeadlineEpoch: null,
    remediationStartedAtEpoch: null,
    findingsSeen: [],
    startCommitSha: head,
  };
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      throw new Error(
        `unexpected positional argument '${token}'; use --pr <number> explicitly`,
      );
    }
    const equals = token.indexOf("=");
    const name = equals === -1 ? token : token.slice(0, equals);
    const inlineValue = equals === -1 ? null : token.slice(equals + 1);
    if (["--merge", "--skip-tests", "--skip"].includes(name)) {
      if (inlineValue !== null && !["true", "false"].includes(inlineValue)) {
        throw new Error(`${name} accepts only true or false`);
      }
      if (name === "--merge" && inlineValue === "false") {
        throw new Error("--merge=false is invalid; omit --merge instead");
      }
      options[name.slice(2)] = inlineValue === null || inlineValue === "true";
      continue;
    }
    const value = inlineValue ?? args[++index];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${name} requires a value`);
    }
    options[name.slice(2)] = value;
  }
  return options;
}

function executableScope(options) {
  const scope = firstValue(options.scope, "branch");
  if (scope !== "branch") {
    throw new Error(
      `quality scope '${scope}' is not executable; only revision-bound branch scope is supported`,
    );
  }
  return scope;
}

function resolvePrIdentity(options) {
  const pr =
    options.pr === undefined
      ? null
      : parseInteger(options.pr, "pr", { minimum: 1 });
  const githubRepository = firstValue(options["github-repo"], null);
  const headRefName = firstValue(options["head-ref"], null);
  const headRepository = firstValue(options["head-repository"], null);
  const crossRepositoryValue = options["cross-repository"];
  const isCrossRepository =
    crossRepositoryValue === "true"
      ? true
      : crossRepositoryValue === "false"
        ? false
        : null;
  if (
    pr !== null &&
    (!githubRepository ||
      !headRefName ||
      !headRepository ||
      isCrossRepository === null)
  ) {
    throw new Error(
      "PR manifests require base/head repository, head ref, and cross-repository identity",
    );
  }
  if (
    pr !== null &&
    isCrossRepository !== (githubRepository !== headRepository)
  ) {
    throw new Error("PR cross-repository identity is inconsistent");
  }
  if (isCrossRepository === true) {
    throw new Error(
      "cross-repository quality requires trusted CI evidence ingestion and is not yet supported",
    );
  }
  return {
    pr,
    githubRepository,
    headRefName,
    headRepository,
    isCrossRepository,
  };
}

function existingCampaign(manifestPath, campaignIdentity) {
  const existing = loadManifest(manifestPath).manifest;
  const existingIdentity = {
    root: existing.repo.realpath,
    gitCommonDir: existing.repo.gitCommonDir,
    origin: existing.repo.origin,
    pr: existing.repo.pr,
    githubRepository: existing.repo.githubRepository,
    headRefName: existing.repo.headRefName,
    headRepository: existing.repo.headRepository,
    isCrossRepository: existing.repo.isCrossRepository,
    baseRef: existing.revisions.baseRef,
    baseSha: existing.revisions.baseSha,
    baseHeadSha: existing.revisions.baseHeadSha,
    head: existing.revisions.currentHead,
    options: existing.options,
    provider: {
      primaryOverride: existing.provider?.primaryOverride,
      fallbackOverride: existing.provider?.fallbackOverride,
      config: existing.provider?.config,
    },
  };
  if (
    JSON.stringify(canonicalJson(existingIdentity)) !==
    JSON.stringify(canonicalJson(campaignIdentity))
  ) {
    throw new Error("deterministic quality campaign identity collision");
  }
  return manifestPath;
}

function createManifest(options) {
  const root = canonicalRoot(firstValue(options.repo, process.cwd()));
  const baseRef = firstValue(options["base-ref"], "origin/main");
  const head = git(root, ["rev-parse", "HEAD"]);
  const baseSha = git(root, ["merge-base", head, baseRef]);
  const {
    pr,
    githubRepository,
    headRefName,
    headRepository,
    isCrossRepository,
  } = resolvePrIdentity(options);
  const scope = executableScope(options);
  if (options.manifest !== undefined) {
    throw new Error("create does not accept a custom manifest path");
  }
  const baseHeadSha = firstValue(options["base-head-sha"], baseSha);
  const manifestOptions = {
    merge: options.merge === true,
    level: firstValue(options.level, "auto"),
    scope,
    skipTests: options["skip-tests"] === true,
  };
  const provider = buildProvider(options);
  const campaignIdentity = {
    root,
    gitCommonDir: gitCommonDir(root),
    origin: originIdentity(root),
    pr,
    githubRepository,
    headRefName,
    headRepository,
    isCrossRepository,
    baseRef,
    baseSha,
    baseHeadSha,
    head,
    options: manifestOptions,
    provider,
  };
  // Provider policy is part of the immutable campaign identity, but not its
  // deterministic key. A caller cannot create a fresh budget merely by
  // swapping primary/fallback order for the same exact work: it resolves to
  // the existing campaign path and fails the identity comparison below.
  const campaignKeyIdentity = { ...campaignIdentity };
  delete campaignKeyIdentity.provider;
  delete campaignKeyIdentity.root;
  delete campaignKeyIdentity.gitCommonDir;
  const invocationId = deterministicInvocationId(campaignKeyIdentity);
  if (
    options["invocation-id"] !== undefined &&
    options["invocation-id"] !== invocationId
  ) {
    throw new Error(
      "invocation-id is deterministic for this campaign and cannot be overridden",
    );
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      invocationId,
    )
  ) {
    throw new Error("invocation-id must be a UUID");
  }
  const stateRoot = path.join(
    qualityTmpRoot(),
    "bs-quality",
    repoKey(root),
    `pr-${pr ?? "none"}`,
    baseSha,
    invocationId,
  );
  const manifestPath = path.join(stateRoot, "invocation.json");
  if (fs.existsSync(manifestPath)) {
    return existingCampaign(manifestPath, campaignIdentity);
  }
  const now = new Date().toISOString();
  const key = repoKey(root);
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    manifestRevision: 0,
    invocationId,
    createdAt: now,
    updatedAt: now,
    stateRoot,
    options: manifestOptions,
    repo: {
      realpath: root,
      key,
      pr,
      githubRepository,
      headRefName,
      headRepository,
      isCrossRepository,
      gitCommonDir: gitCommonDir(root),
      origin: originIdentity(root),
    },
    revisions: {
      baseRef,
      baseSha,
      baseHeadSha,
      initialHead: head,
      currentHead: head,
    },
    approval: { approved: false },
    approvalTrust: null,
    approvalChallengeSha256: null,
    risk: {
      requestedLevel: firstValue(options.level, "auto"),
      resolved: false,
    },
    agents: [],
    provider,
    reviews: [],
    governor: buildGovernor(head),
    requiredGates: discoverRequiredGates(root, options),
    requiredGatesPolicyVersion: REQUIRED_GATES_POLICY_VERSION,
    gates: [],
  };
  return atomicCreate(manifestPath, manifest)
    ? manifestPath
    : existingCampaign(manifestPath, campaignIdentity);
}

function strongerReviewForCurrentHead(manifest, root) {
  if (manifest.risk?.resolved !== true) return null;
  const config = riskScore.loadConfig(root);
  const rescored = riskScore.score({
    base: manifest.revisions.baseRef,
    repoRoot: root,
    gitRunner: (args) => git(root, args),
    config,
    taskType: manifest.risk.taskType || "unknown",
  });
  const minimumScore = {
    medium: 20,
    high: 50,
    critical: riskScore.CRITICAL_RISK_SCORE,
    95: 50,
    98: riskScore.CRITICAL_RISK_SCORE,
  }[manifest.risk.requestedLevel];
  const rescoredRisk = Number.isFinite(rescored.riskScore)
    ? rescored.riskScore
    : 100;
  const effectiveScore = Math.max(rescoredRisk, minimumScore || 0);
  const requiredKnobs = riskScore.scoreToKnobs(effectiveScore, config);
  const tierForScore = (score) => {
    if (score >= riskScore.CRITICAL_RISK_SCORE) return "critical";
    if (score >= 50) return "high";
    if (score >= 20) return "medium";
    return "low";
  };
  const tierRank = { low: 0, medium: 1, high: 2, critical: 3 };
  const codexRank = { skip: 0, low: 0, medium: 1, high: 2, xhigh: 3 };
  const nextTier = tierForScore(effectiveScore);
  const stronger =
    tierRank[nextTier] > tierRank[manifest.risk.tier] ||
    requiredKnobs.agents > manifest.risk.agentTarget ||
    (codexRank[requiredKnobs.codex] ?? -1) >
      (codexRank[manifest.risk.codexDepth] ?? -1) ||
    requiredKnobs.codexRounds > manifest.risk.codexRounds;
  return stronger ? { ...requiredKnobs, tier: nextTier } : null;
}

function assertCurrentReviewStrength(manifest, root) {
  const stronger = strongerReviewForCurrentHead(manifest, root);
  if (!stronger) return;
  throw new Error(
    `quality resume requires stronger review at HEAD ${manifest.revisions.currentHead} ` +
      `(was ${manifest.risk.tier}/${manifest.risk.agentTarget}/${manifest.risk.codexDepth}, ` +
      `now ${stronger.tier}/${stronger.agents}/${stronger.codex}); start a fresh invocation`,
  );
}

// A real rebase rewrites commits, so nextHead is typically NOT a descendant
// of priorHead even when the reviewed diff is unchanged (only the base
// moved). Returns true only when the diff against each head's own live base
// is provably identical (patch-id match) — a rebase-only replay, not new
// content.
function isRebaseOnlyReplay(manifest, root, priorHead) {
  const baseRef = manifest.revisions.baseRef;
  let priorBase;
  try {
    priorBase = baseRef && git(root, ["merge-base", priorHead, baseRef]);
  } catch {
    priorBase = null;
  }
  const priorPatchId = priorBase && computePatchId(root, priorBase, priorHead);
  const nextPatchId = currentPatchId(manifest, root);
  return Boolean(priorPatchId && nextPatchId && priorPatchId === nextPatchId);
}

// Persist proof that baseSha (immutable — it namespaces stateRoot and
// anchors review-trailer provenance, so it is never reassigned) no longer
// reflects the live base, but nextHead's diff against the fresh live base
// is provably identical to what was already reviewed. baseSha permanently
// mismatches actualBase from this point on (rebase moves the merge-base
// forever), so validateIdentity() anchors trust on this record's own
// baseSha/head instead. A later normal descendant of nextHead (the
// isAncestor branch on the next advance call) must NOT clear this record —
// it still correctly names the reconciled live base for the whole
// descendant chain.
function recordBaseRebaseCarry(manifest, root, nextHead) {
  const baseRef = manifest.revisions.baseRef;
  const freshBaseSha = baseRef
    ? git(root, ["merge-base", nextHead, baseRef])
    : null;
  manifest.revisions.baseRebaseCarry = {
    head: nextHead,
    baseSha: freshBaseSha,
    recordedAt: new Date().toISOString(),
  };
  // baseHeadSha (unlike baseSha) does not namespace stateRoot or anchor
  // trailer provenance — it exists solely so quality-authorize-merge.sh can
  // do a final live-freshness check at merge time. Advance it with the
  // rebase so that check compares against the base this rebase actually
  // reconciled onto, not a base from before the rebase, which would
  // otherwise permanently mismatch and wrongly block an up-to-date merge.
  if (freshBaseSha) manifest.revisions.baseHeadSha = freshBaseSha;
}

function invalidateOrCarryApproval(manifest, root, nextHead, rebaseOnly) {
  if (
    manifest.approval?.approved !== true ||
    manifest.approval.head === nextHead
  ) {
    return;
  }
  if (
    rebaseOnly &&
    typeof manifest.approval.patchId === "string" &&
    manifest.approval.patchId === currentPatchId(manifest, root)
  ) {
    // Rebase-only HEAD change with a patch-id-identical diff: the approved
    // capability's signed payload still names the old head, so it cannot
    // authorize a merge of nextHead directly (approvalValid() checks the
    // signature payload, not this cache), but preserve the record instead
    // of discarding it — the rebase-tolerant check in approvalValid()
    // re-derives validity from the patch-id match, not this flag alone.
    manifest.approval.rebaseCarriedHead = nextHead;
  } else {
    manifest.approval = {
      approved: false,
      invalidatedAt: new Date().toISOString(),
      reason: `HEAD advanced from ${manifest.approval.head} to ${nextHead}`,
    };
  }
}

function advanceHead(manifest, root) {
  const nextHead = git(root, ["rev-parse", "HEAD"]);
  const priorHead = manifest.revisions.currentHead;
  // Revalidate even when HEAD has not moved. A manifest created by an older
  // runtime can persist a review contract that the current policy considers
  // underpowered (for example, the former 75–84 critical boundary gap).
  // Returning before this assertion would grandfather that stale contract.
  assertCurrentReviewStrength(manifest, root);
  if (nextHead === priorHead) return false;
  const stampHead = manifest.merge?.stampHead;
  if (stampHead) {
    if (!isEmptyStampCommit(root, priorHead, stampHead)) {
      throw new Error(
        `quality persisted stamp ${stampHead} is not an empty child of reviewed HEAD ${priorHead}`,
      );
    }
    if (nextHead === stampHead) return false;
  }
  const isAncestor = isAncestorOf(root, priorHead, nextHead);
  let rebaseOnly = false;
  if (!isAncestor) {
    rebaseOnly = isRebaseOnlyReplay(manifest, root, priorHead);
    if (!rebaseOnly) {
      throw new Error(
        `quality resume refused: ${priorHead} is not an ancestor of ${nextHead} ` +
          `and the diff is not a provable rebase-only replay`,
      );
    }
  }
  if (rebaseOnly) recordBaseRebaseCarry(manifest, root, nextHead);
  invalidateOrCarryApproval(manifest, root, nextHead, rebaseOnly);
  if (stampHead) {
    manifest.merge.invalidatedStamps.push({
      head: stampHead,
      invalidatedAt: new Date().toISOString(),
      reason: `HEAD advanced beyond reviewed stamp to ${nextHead}`,
    });
    delete manifest.merge.stampHead;
    delete manifest.merge.stampedAt;
    delete manifest.merge.stampPublication;
  }
  manifest.revisions.currentHead = nextHead;
  return true;
}

function recordStamp(manifest, root, options) {
  const stampHead = options.head;
  if (!stampHead) throw new Error("record-stamp requires --head");
  const actualHead = git(root, ["rev-parse", "HEAD"]);
  if (actualHead !== stampHead) {
    throw new Error(
      `quality stamp identity mismatch: expected local HEAD ${stampHead}, got ${actualHead}`,
    );
  }
  if (!isEmptyStampCommit(root, manifest.revisions.currentHead)) {
    throw new Error("quality stamp must be an empty child of reviewed HEAD");
  }
  if (manifest.merge.stampHead && manifest.merge.stampHead !== stampHead) {
    throw new Error(
      `quality stamp is immutable: expected ${manifest.merge.stampHead}, got ${stampHead}`,
    );
  }
  manifest.merge.stampHead = stampHead;
  manifest.merge.stampedAt ??= new Date().toISOString();
  const remote = options.remote;
  const expectedOldHead = options["expected-old-head"];
  if (!remote || !expectedOldHead) {
    throw new Error("record-stamp requires remote publication identity");
  }
  manifest.merge.stampPublication ??= {
    status: "local",
    remote,
    expectedOldHead,
    recordedAt: new Date().toISOString(),
  };
  if (
    manifest.merge.stampPublication.remote !== remote ||
    manifest.merge.stampPublication.expectedOldHead !== expectedOldHead
  ) {
    throw new Error("quality stamp publication identity is immutable");
  }
}

function recordStampPublished(manifest, options) {
  const stampHead = options.head;
  const remote = options.remote;
  const previousHead = options["previous-head"];
  if (
    !stampHead ||
    manifest.merge.stampHead !== stampHead ||
    manifest.merge.stampPublication?.remote !== remote
  ) {
    throw new Error("published stamp identity does not match persisted state");
  }
  if (
    previousHead !== stampHead &&
    previousHead !== manifest.merge.stampPublication.expectedOldHead
  ) {
    throw new Error("published stamp previous-head identity mismatch");
  }
  manifest.merge.stampPublication.status = "published";
  manifest.merge.stampPublication.publishedHead = stampHead;
  manifest.merge.stampPublication.publishedAt ??= new Date().toISOString();
}

function requestedRiskMinimum(requestedLevel) {
  if (requestedLevel === "98") return "critical";
  if (requestedLevel === "95") return "high";
  return ["low", "medium", "high", "critical"].includes(requestedLevel)
    ? requestedLevel
    : "low";
}

function buildRuntimePlan(manifest, options) {
  return {
    workload: options.workload || "unknown",
    workloadUnits: parseInteger(
      options["workload-units"] || "0",
      "workload units",
    ),
    diffFiles: parseInteger(options["diff-files"] || "0", "diff files"),
    diffLines: parseInteger(options["diff-lines"] || "0", "diff lines"),
    campaignSeconds: parseInteger(
      options["campaign-seconds"] ||
        String(manifest.governor.remediationSeconds),
      "campaign seconds",
      { minimum: 1 },
    ),
    reviewSeconds: parseInteger(
      options["review-seconds"] ||
        String(manifest.governor.providerWindowSeconds),
      "review seconds",
      { minimum: 1 },
    ),
    verificationSeconds: parseInteger(
      options["verification-seconds"] ||
        String(manifest.governor.reReviewReserveSeconds),
      "verification seconds",
      { minimum: 1 },
    ),
    checkSeconds: parseInteger(
      options["check-seconds"] || "300",
      "check seconds",
      {
        minimum: 1,
      },
    ),
    reviewReserveSeconds: parseInteger(
      options["review-reserve-seconds"] || "300",
      "review reserve seconds",
      { minimum: 1 },
    ),
    checkReserveSeconds: parseInteger(
      options["check-reserve-seconds"] || "300",
      "check reserve seconds",
      { minimum: 1 },
    ),
  };
}

function applyRuntimeGovernor(manifest, options, runtime) {
  const governor = manifest.governor;
  if (governor.maxReviewRoundsExplicit !== true) {
    governor.maxReviewRounds = parseInteger(
      options["max-review-rounds"] || "2",
      "max review rounds",
      { minimum: 1 },
    );
  }
  if (process.env.BS_QUALITY_MAX_FIX_COMMITS === undefined) {
    governor.maxFixCommits = parseInteger(
      options["max-fix-commits"] || "1",
      "max fix commits",
    );
  }
  if (process.env.BS_QUALITY_MAX_REMEDIATION_SECONDS === undefined) {
    governor.remediationSeconds = Math.max(
      60,
      runtime.campaignSeconds -
        runtime.reviewSeconds -
        runtime.verificationSeconds,
    );
  }
  if (process.env.BS_QUALITY_REREVIEW_RESERVE_SECONDS === undefined) {
    governor.reReviewReserveSeconds = runtime.verificationSeconds;
  }
  if (process.env.BS_QUALITY_MAX_PROVIDER_SECONDS === undefined) {
    governor.providerWindowSeconds = runtime.reviewSeconds;
    governor.providerDeadlineEpoch =
      governor.startedAtEpoch + runtime.reviewSeconds;
  }
  governor.campaignSeconds = runtime.campaignSeconds;
  governor.campaignDeadlineEpoch =
    governor.startedAtEpoch + runtime.campaignSeconds;
}

function parseMergeAuthority(value) {
  // Risk resolution always persists an explicit authority. A direct/legacy
  // caller that omits it must not mint autonomous merge authority.
  const mergeAuthority = value || "human-required";
  if (!["autonomous", "human-required"].includes(mergeAuthority)) {
    throw new Error(`invalid merge authority '${mergeAuthority}'`);
  }
  return mergeAuthority;
}

function setRisk(manifest, options) {
  const tier = options.tier;
  if (!["low", "medium", "high", "critical"].includes(tier)) {
    throw new Error(`invalid resolved tier '${tier}'`);
  }
  const tierRank = { low: 0, medium: 1, high: 2, critical: 3 };
  const requestedMinimum = requestedRiskMinimum(manifest.risk.requestedLevel);
  if (tierRank[tier] < tierRank[requestedMinimum]) {
    throw new Error(
      `resolved tier ${tier} is below requested minimum ${requestedMinimum}`,
    );
  }
  const taskType = options["task-type"] || "unknown";
  const mergeAuthority = parseMergeAuthority(options["merge-authority"]);
  if (
    ![
      "unknown",
      "chore",
      "docs",
      "build",
      "ci",
      "feature",
      "bugfix",
      "performance",
    ].includes(taskType)
  ) {
    throw new Error(`invalid resolved task type '${taskType}'`);
  }
  const resolved = {
    requestedLevel: manifest.risk.requestedLevel,
    resolved: true,
    tier,
    mergeAuthority,
    taskType,
    score:
      options.score === undefined || options.score === ""
        ? null
        : parseInteger(options.score, "risk score"),
    agentTarget: parseInteger(options.agents, "agent target", { minimum: 2 }),
    codexDepth: options["codex-depth"] || "medium",
    codexRounds: parseInteger(options["codex-rounds"] || "1", "codex rounds"),
    level: options.level || manifest.options.level,
    runtime: buildRuntimePlan(manifest, options),
  };
  if (manifest.risk?.resolved) {
    if (JSON.stringify(manifest.risk) === JSON.stringify(resolved)) return;
    throw new Error("risk resolution is immutable once persisted");
  }
  if (manifest.reviews.length > 0) {
    throw new Error("risk resolution is immutable once persisted");
  }
  applyRuntimeGovernor(manifest, options, resolved.runtime);
  manifest.risk = resolved;
}

function setAgents(manifest, names, { incomplete = false } = {}) {
  if (!manifest.risk?.resolved) {
    throw new Error("cannot select agents before risk resolution");
  }
  if (names.length < 2) {
    throw new Error("quality agent floor requires at least two agents");
  }
  if (
    manifest.agents.length > 0 &&
    JSON.stringify(manifest.agents) === JSON.stringify(names) &&
    Boolean(manifest.panel?.incomplete) === incomplete
  ) {
    return;
  }
  if (manifest.agents.length > 0 || manifest.reviews.length > 0) {
    throw new Error("quality agent selection is immutable once persisted");
  }
  manifest.agents = names;
  manifest.panel = {
    requiredAgents: manifest.risk.agentTarget,
    selectedAgents: names.length,
    incomplete,
  };
}

function prIdentityOptions(manifest, options) {
  return {
    githubRepository: firstValue(
      options["github-repo"],
      manifest.repo.githubRepository,
      null,
    ),
    headRefName: firstValue(
      options["head-ref"],
      manifest.repo.headRefName,
      null,
    ),
    headRepository: firstValue(
      options["head-repository"],
      manifest.repo.headRepository,
      null,
    ),
    isCrossRepository:
      options["cross-repository"] === "true"
        ? true
        : options["cross-repository"] === "false"
          ? false
          : firstValue(manifest.repo.isCrossRepository, null),
  };
}

function prIdentityComplete(identity) {
  return Boolean(
    identity.githubRepository &&
    identity.headRefName &&
    identity.headRepository &&
    typeof identity.isCrossRepository === "boolean" &&
    identity.isCrossRepository ===
      (identity.githubRepository !== identity.headRepository),
  );
}

function bindPrRepositoryIdentity(manifest, options) {
  if (manifest.repo.pr === null) return;
  const identityOptionNames = [
    "github-repo",
    "head-ref",
    "head-repository",
    "cross-repository",
  ];
  const supplied = identityOptionNames.some(
    (name) => options[name] !== undefined,
  );
  if (!supplied) {
    if (prIdentityComplete(manifest.repo)) return;
    throw new Error("resumed PR repository identity is incomplete");
  }
  const identity = prIdentityOptions(manifest, options);
  if (!prIdentityComplete(identity)) {
    throw new Error("resumed PR repository identity is incomplete");
  }
  for (const [key, value] of Object.entries(identity)) {
    if (manifest.repo[key] !== null && manifest.repo[key] !== undefined) {
      if (manifest.repo[key] !== value) {
        throw new Error(`resumed PR ${key} identity mismatch`);
      }
    } else {
      manifest.repo[key] = value;
    }
  }
}

// True when the approval's signed head no longer equals currentHead, but
// advanceHead() recorded it as carried across a provable rebase-only replay
// (identical patch-id) and that equivalence still holds right now. Recomputed
// fresh rather than trusting the cached flag alone, so a later real content
// change (which would call advanceHead again and clear rebaseCarriedHead,
// or leave a stale flag if inspected out-of-band) can never wrongly pass.
function approvalHeadCarriedByRebase(manifest, approval, root) {
  if (!root) return false;
  if (approval?.rebaseCarriedHead !== manifest.revisions.currentHead) {
    return false;
  }
  if (typeof approval.patchId !== "string") return false;
  return approval.patchId === currentPatchId(manifest, root);
}

function approvalRecordValid(manifest, approval, root) {
  const headMatches =
    approval?.head === manifest.revisions.currentHead ||
    approvalHeadCarriedByRebase(manifest, approval, root);
  const expected = {
    repoKey: manifest.repo.key,
    pr: manifest.repo.pr,
    invocationId: manifest.invocationId,
  };
  const identityMatches =
    headMatches &&
    Object.entries(expected).every(([key, value]) => approval?.[key] === value);
  return Boolean(
    approval?.approved === true &&
    identityMatches &&
    typeof approval.approver === "string" &&
    approval.approver.trim() !== "" &&
    Date.parse(approval.expiresAt) > Date.now() &&
    approval.artifactPath &&
    fs.existsSync(approval.artifactPath) &&
    sha256File(approval.artifactPath) === approval.artifactSha256,
  );
}

function capabilitySignatureValid(manifest, artifact) {
  const pinnedKey = manifest.approvalTrust?.publicKey;
  if (typeof pinnedKey !== "string" || artifact.publicKey !== undefined) {
    return false;
  }
  return crypto.verify(
    null,
    Buffer.from(JSON.stringify(canonicalJson(artifact.payload))),
    crypto.createPublicKey({
      key: Buffer.from(pinnedKey, "base64"),
      type: "spki",
      format: "der",
    }),
    Buffer.from(artifact.signature || "", "base64"),
  );
}

function approvalValid(manifest, root) {
  const approval = manifest.approval;
  if (!approvalRecordValid(manifest, approval, root)) return false;
  try {
    const artifact = parseJson(
      fs.readFileSync(approval.artifactPath, "utf8"),
      "approval capability",
    );
    const payload = artifact.payload;
    // The signed payload always names the head that was actually reviewed
    // and signed (approval.head), never currentHead directly — a rebase
    // never re-signs. approvalRecordValid() is what proves approval.head is
    // either literally currentHead, or a prior head whose patch-id equals
    // currentHead's patch-id right now (rebase-only replay).
    const identityMatches =
      payload?.repoKey === manifest.repo.key &&
      payload?.pr === manifest.repo.pr &&
      payload?.head === approval.head &&
      payload?.invocationId === manifest.invocationId &&
      payload?.approver === approval.approver &&
      payload?.expiresAt === approval.expiresAt;
    return identityMatches && capabilitySignatureValid(manifest, artifact);
  } catch {
    return false;
  }
}

function validateApprovalPayload(payload) {
  const issuedAt = Date.parse(payload?.issuedAt);
  const expiresAt = Date.parse(payload?.expiresAt);
  const validApprover =
    typeof payload?.approver === "string" && payload.approver.trim() !== "";
  const validTimes =
    Number.isFinite(issuedAt) &&
    Number.isFinite(expiresAt) &&
    issuedAt <= Date.now() + 300_000 &&
    expiresAt > Date.now() &&
    expiresAt - issuedAt <= 86_400_000;
  if (!validApprover || !validTimes) {
    throw new Error("approval capability approver/expiry is invalid");
  }
}

function attachApproval(manifest, options) {
  if (!options.artifact) {
    throw new Error("approval attachment requires --artifact");
  }
  const artifactPath = path.resolve(options.artifact);
  const stat = fs.lstatSync(artifactPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("approval capability must be a regular file");
  }
  const artifact = parseJson(
    fs.readFileSync(artifactPath, "utf8"),
    "approval capability",
  );
  const payload = artifact.payload;
  const requiredIdentity = {
    repoKey: manifest.repo.key,
    pr: manifest.repo.pr,
    head: manifest.revisions.currentHead,
    invocationId: manifest.invocationId,
  };
  if (
    !manifest.approvalChallengeSha256 ||
    typeof payload?.challenge !== "string" ||
    crypto.createHash("sha256").update(payload.challenge).digest("hex") !==
      manifest.approvalChallengeSha256
  ) {
    throw new Error("approval capability outer-wrapper challenge mismatch");
  }
  for (const [key, value] of Object.entries(requiredIdentity)) {
    if (payload?.[key] !== value) {
      throw new Error(`approval capability ${key} identity mismatch`);
    }
  }
  validateApprovalPayload(payload);
  if (!capabilitySignatureValid(manifest, artifact)) {
    throw new Error("approval capability signature is invalid");
  }
  manifest.approval = {
    approved: true,
    ...requiredIdentity,
    approver: payload.approver,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    source: "outer-wrapper-capability",
    artifactPath,
    artifactSha256: sha256File(artifactPath),
    // Patch-id of the reviewed diff at approval time, cached so a later
    // rebase-only HEAD change (advanceHead()) can prove the diff is still
    // identical without re-signing. Best-effort: null if unavailable (e.g.
    // empty diff against base), in which case rebase-carry never applies.
    patchId: currentPatchId(manifest, manifest.repo.realpath),
  };
  manifest.approvalChallengeSha256 = null;
}

function armApprovalChallenge(manifest, options) {
  const challenge = options.challenge;
  const publicKey = options.publicKey;
  if (!/^[0-9a-f]{64}$/.test(challenge || "")) {
    throw new Error("approval challenge must be a SHA-256 digest");
  }
  try {
    crypto.createPublicKey({
      key: Buffer.from(publicKey || "", "base64"),
      type: "spki",
      format: "der",
    });
  } catch {
    throw new Error("approval trust key is invalid");
  }
  if (approvalValid(manifest, manifest.repo.realpath)) {
    throw new Error("cannot replace a currently valid approval capability");
  }
  manifest.approvalChallengeSha256 = challenge;
  manifest.approvalTrust = {
    publicKey,
    pinnedAt: new Date().toISOString(),
  };
}

function providerPhaseDeadline(manifest) {
  const validation = manifest.governor.validationDeadlineEpoch;
  const campaign = manifest.governor.campaignDeadlineEpoch;
  return manifest.reviews.length > 0 && Number.isInteger(validation)
    ? Math.min(validation, campaign)
    : campaign;
}

function providerPhaseSeconds(manifest) {
  return manifest.reviews.length === 0
    ? (manifest.risk?.runtime?.reviewSeconds ??
        manifest.governor.providerWindowSeconds)
    : (manifest.risk?.runtime?.reviewReserveSeconds ?? 300);
}

function authorizeProviderAttempt(manifest, options) {
  const provider = options.provider;
  if (!["claude", "codex", "gemini"].includes(provider)) {
    throw new Error(`invalid review provider '${provider}'`);
  }
  const governor = manifest.governor;
  const now = Math.floor(Date.now() / 1000);
  if (
    !Number.isInteger(governor.maxProviderAttempts) ||
    !Number.isInteger(governor.providerDeadlineEpoch) ||
    !Array.isArray(governor.providerAttempts)
  ) {
    throw new Error("provider attempt governor is missing or invalid");
  }
  const currentHead = manifest.revisions.currentHead;
  const phaseDeadline = providerPhaseDeadline(manifest);
  const firstAttemptForProvider = !governor.providerAttempts.some(
    (attempt) =>
      attempt.head === currentHead &&
      attempt.provider === provider &&
      attempt.reviewCount === manifest.reviews.length,
  );
  if (firstAttemptForProvider) {
    const phaseSeconds = providerPhaseSeconds(manifest);
    governor.providerDeadlineEpoch = Math.min(
      now + phaseSeconds,
      phaseDeadline,
    );
    governor.providerDeadlineHead = currentHead;
    governor.providerDeadlineProvider = provider;
  }
  const deadline = Math.min(governor.providerDeadlineEpoch, phaseDeadline);
  if (now >= deadline) {
    throw new Error("absolute provider deadline exhausted");
  }
  if (governor.providerAttempts.length >= governor.maxProviderAttempts) {
    throw new Error("absolute provider attempt cap exhausted");
  }
  const attempt = {
    number: governor.providerAttempts.length + 1,
    provider,
    head: currentHead,
    reviewCount: manifest.reviews.length,
    startedAt: new Date().toISOString(),
  };
  governor.providerAttempts.push(attempt);
  return {
    ...attempt,
    remainingSeconds: deadline - now,
    maxAttempts: governor.maxProviderAttempts,
  };
}

function reviewInfo(manifest) {
  const successful = manifest.reviews.filter(
    (review) => review.status === "success",
  );
  const previous = successful.at(-1);
  if (previous?.to === manifest.revisions.currentHead) {
    throw new Error(
      "review retry requires a descendant HEAD; the current HEAD is already reviewed",
    );
  }
  return {
    round: successful.length + 1,
    attempt: manifest.governor.roundsUsed,
    from: previous?.to || manifest.revisions.baseSha,
    to: manifest.revisions.currentHead,
    previousReviewedHead: previous?.to || null,
    artifactDir: path.join(
      manifest.stateRoot,
      "reviews",
      manifest.revisions.currentHead,
      `round-${successful.length + 1}-attempt-${manifest.governor.roundsUsed}`,
    ),
  };
}

function agentsSha256(manifest) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(manifest.agents))
    .digest("hex");
}

function reviewIdentity(manifest) {
  const info = reviewInfo(manifest);
  return {
    schemaVersion: SCHEMA_VERSION,
    invocationId: manifest.invocationId,
    repositoryRealpath: manifest.repo.realpath,
    repositoryKey: manifest.repo.key,
    pr: manifest.repo.pr,
    baseSha: manifest.revisions.baseSha,
    diffBase: info.from,
    headSha: info.to,
    round: info.round,
    attempt: info.attempt,
    tier: manifest.risk.tier,
    agentsSha256: agentsSha256(manifest),
  };
}

function reviewedEvidence(manifest) {
  return manifest.reviews
    .filter((review) => review.status === "success")
    .map((review) => review.inventorySha256)
    .join(":");
}

function recordJudge(manifest, options) {
  const authorization = reviewCoverage(manifest);
  if (!options.artifact) {
    throw new Error("judge requires a structured --artifact");
  }
  const input = parseJson(
    fs.readFileSync(path.resolve(options.artifact), "utf8"),
    "judge artifact",
  );
  const context = judgeContext(manifest);
  for (const key of [
    "invocationId",
    "repositoryKey",
    "head",
    "reviewCount",
    "evidenceSha256",
  ]) {
    if (input[key] !== context[key]) {
      throw new Error(`judge artifact ${key} identity mismatch`);
    }
  }
  if (!Array.isArray(input.findings)) {
    throw new Error("judge artifact findings must be an array");
  }
  for (const finding of input.findings) {
    if (
      typeof finding.id !== "string" ||
      !["BLOCKING", "WARNING", "SUPPRESSED"].includes(finding.disposition)
    ) {
      throw new Error("judge findings require an id and valid disposition");
    }
    if (
      ["WARNING", "SUPPRESSED"].includes(finding.disposition) &&
      (typeof finding.reason !== "string" || finding.reason.trim() === "")
    ) {
      throw new Error("WARNING and SUPPRESSED judge findings require a reason");
    }
  }
  const expectedIds = context.findings.map((finding) => finding.id).sort();
  const actualIds = input.findings.map((finding) => finding.id).sort();
  if (JSON.stringify(expectedIds) !== JSON.stringify(actualIds)) {
    throw new Error("judge artifact does not classify every provider finding");
  }
  const immutableFinding = (finding) => {
    const immutable = { ...finding };
    delete immutable.disposition;
    delete immutable.reason;
    return immutable;
  };
  const expectedById = new Map(
    context.findings.map((finding) => [finding.id, immutableFinding(finding)]),
  );
  for (const finding of input.findings) {
    if (
      JSON.stringify(canonicalJson(immutableFinding(finding))) !==
      JSON.stringify(canonicalJson(expectedById.get(finding.id)))
    ) {
      throw new Error(
        `judge finding ${finding.id} changed immutable provider payload`,
      );
    }
  }
  const blockingCount = input.findings.filter(
    (finding) => finding.disposition === "BLOCKING",
  ).length;
  const evidenceSha256 = crypto
    .createHash("sha256")
    .update(reviewedEvidence(manifest))
    .digest("hex");
  const artifactPath = path.join(
    manifest.stateRoot,
    "judge",
    `${manifest.revisions.currentHead}.json`,
  );
  atomicWrite(artifactPath, {
    schemaVersion: 1,
    invocationId: context.invocationId,
    repositoryKey: context.repositoryKey,
    head: authorization.head,
    reviewCount: manifest.reviews.filter(
      (review) => review.status === "success",
    ).length,
    evidenceSha256,
    findings: input.findings,
  });
  manifest.judge = {
    head: authorization.head,
    reviewCount: manifest.reviews.filter(
      (review) => review.status === "success",
    ).length,
    blockingCount,
    evidenceSha256,
    artifactPath,
    artifactSha256: sha256File(artifactPath),
    recordedAt: new Date().toISOString(),
  };
}

function providerFindings(manifest) {
  const findings = [];
  for (const review of manifest.reviews.filter(
    (item) => item.status === "success",
  )) {
    const reviewFindingsStart = findings.length;
    const inventory = parseJson(
      fs.readFileSync(path.join(review.artifactDir, "artifact-inventory.json")),
      "provider artifact inventory",
    );
    const resultFiles = inventory.files.filter((file) =>
      file.name.endsWith(".json"),
    );
    const resultNames = new Set(resultFiles.map((file) => file.name));
    for (const item of resultFiles.filter((file) => {
      const rawPass = file.name.match(/^(codex|gemini)-(\d+)\.json$/);
      if (!rawPass) return true;
      const [, providerName, pass] = rawPass;
      return (
        !resultNames.has(`${providerName}-${pass}.normalized.json`) &&
        !resultNames.has(`primary-${providerName}-${pass}.result.json`)
      );
    })) {
      let parsed;
      try {
        parsed = parseJson(
          fs.readFileSync(path.join(review.artifactDir, item.name), "utf8"),
          `provider result ${item.name}`,
        );
      } catch {
        continue;
      }
      const items = parsed.findings || parsed.result?.findings;
      if (!Array.isArray(items)) continue;
      items.forEach((finding, index) => {
        findings.push({
          ...finding,
          id: crypto
            .createHash("sha256")
            .update(
              `${review.inventorySha256}:${item.name}:${index}:${JSON.stringify(finding)}`,
            )
            .digest("hex"),
          severity: finding.severity || "unknown",
          title: finding.title || "provider finding",
          provider: item.provider || inventory.provider,
          source: `${item.provider || inventory.provider}:${item.name}#${index}`,
        });
      });
    }
    const hasStructuredFindings = findings.length > reviewFindingsStart;
    for (const item of inventory.files.filter((file) =>
      file.name.endsWith(".findings.txt"),
    )) {
      if (
        hasStructuredFindings &&
        /^(?:codex|gemini)\.findings\.txt$/.test(item.name)
      ) {
        continue;
      }
      const text = fs
        .readFileSync(path.join(review.artifactDir, item.name), "utf8")
        .trim();
      const cleanLines = text.split(/\r?\n/);
      const isClean = cleanLines.every(
        (line) =>
          line === "NO FINDINGS." ||
          /^NO FINDINGS\. Verdict: (?:approve|pass)\. [^\r\n]+$/.test(line),
      );
      if (!text || isClean) continue;
      findings.push({
        id: crypto
          .createHash("sha256")
          .update(`${review.inventorySha256}:${item.name}:${text}`)
          .digest("hex"),
        severity: "blocking",
        title: text.split("\n")[0],
        body: text,
        source: item.name,
      });
    }
  }
  return findings;
}

function priorFindings(manifest) {
  const findings = providerFindings(manifest);
  if (!manifest.judge) {
    return findings.map((finding) => ({
      ...finding,
      disposition: "BLOCKING",
      reason:
        "Unclassified prior finding is conservatively treated as blocking.",
    }));
  }
  if (
    !fs.existsSync(manifest.judge.artifactPath) ||
    sha256File(manifest.judge.artifactPath) !== manifest.judge.artifactSha256
  ) {
    throw new Error("persisted judge artifact identity is invalid");
  }
  const artifact = parseJson(
    fs.readFileSync(manifest.judge.artifactPath, "utf8"),
    "persisted judge artifact",
  );
  const judgedById = new Map(
    (artifact.findings || []).map((finding) => [finding.id, finding]),
  );
  return findings.map((finding) => {
    const judged = judgedById.get(finding.id);
    return {
      ...finding,
      disposition: judged?.disposition || "BLOCKING",
      reason:
        judged?.reason ||
        "Unclassified prior finding is conservatively treated as blocking.",
    };
  });
}

function judgeContext(manifest) {
  const authorization = reviewCoverage(manifest);
  return {
    schemaVersion: 1,
    invocationId: manifest.invocationId,
    repositoryKey: manifest.repo.key,
    head: authorization.head,
    reviewCount: manifest.reviews.filter(
      (review) => review.status === "success",
    ).length,
    evidenceSha256: crypto
      .createHash("sha256")
      .update(reviewedEvidence(manifest))
      .digest("hex"),
    findings: providerFindings(manifest),
  };
}

function recordReview(manifest, options) {
  const expected = reviewInfo(manifest);
  const authorizedAttempt = manifest.governor.authorizedAttempts.find(
    (attempt) =>
      attempt.number === expected.attempt &&
      attempt.head === manifest.revisions.currentHead &&
      attempt.consumedAt === null &&
      !attempt.invalidatedAt,
  );
  if (!authorizedAttempt) {
    throw new Error("review attempt was not authorized by the governor");
  }
  const boundExpected = {
    ...expected,
    tier: manifest.risk.tier,
    agentsSha256: agentsSha256(manifest),
  };
  if (
    options.from !== expected.from ||
    options.to !== expected.to ||
    path.resolve(options["artifact-dir"]) !== path.resolve(expected.artifactDir)
  ) {
    throw new Error("review artifact identity does not match manifest");
  }
  verifyReviewArtifact(manifest, {
    ...boundExpected,
    artifactDir: options["artifact-dir"],
    diffSha256: options["diff-sha"],
    provider: options.provider,
  });
  manifest.reviews.push({
    round: expected.round,
    attempt: expected.attempt,
    from: options.from,
    to: options.to,
    provider: options.provider,
    diffSha256: options["diff-sha"],
    inventorySha256: sha256File(
      path.join(
        path.resolve(options["artifact-dir"]),
        "artifact-inventory.json",
      ),
    ),
    artifactDir: path.resolve(options["artifact-dir"]),
    status: "success",
    tier: boundExpected.tier,
    agentsSha256: boundExpected.agentsSha256,
    incompletePanel: Boolean(manifest.panel?.incomplete),
    governorAttemptToken: authorizedAttempt.token,
    completedAt: new Date().toISOString(),
  });
  manifest.provider = {
    ...manifest.provider,
    primary: options.primary,
    fallback: options.fallback,
    reviewer: options.provider,
  };
  authorizedAttempt.consumedAt = new Date().toISOString();
}

function sha256File(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

function writeArtifactInventory(manifest, artifactDir, provider) {
  const resolved = path.resolve(artifactDir);
  const info = reviewInfo(manifest);
  if (resolved !== path.resolve(info.artifactDir)) {
    throw new Error("artifact inventory directory identity mismatch");
  }
  const names = fs
    .readdirSync(resolved)
    .filter(
      (name) =>
        name.endsWith(".findings.txt") ||
        name.endsWith(".result.json") ||
        /^(?:codex|gemini)-\d+(?:\.normalized)?\.json$/.test(name),
    )
    .sort();
  const findings = names.filter((name) => name.endsWith(".findings.txt"));
  if (findings.length === 0) throw new Error("provider findings are missing");
  if (
    findings.some((name) =>
      fs
        .readFileSync(path.join(resolved, name), "utf8")
        .split(/\r?\n/)
        .some((line) => line.startsWith("INCONCLUSIVE:")),
    )
  ) {
    throw new Error("inconclusive provider findings cannot be inventoried");
  }
  if (provider === "claude" && findings.length !== manifest.agents.length) {
    throw new Error(
      "Claude findings inventory does not cover the mandatory panel",
    );
  }
  const inventory = {
    schemaVersion: 1,
    invocationId: manifest.invocationId,
    headSha: manifest.revisions.currentHead,
    provider,
    status: "success",
    panel: manifest.panel || {
      requiredAgents: manifest.agents.length,
      selectedAgents: manifest.agents.length,
      incomplete: false,
    },
    files: names.map((name) => {
      // Preserved artifacts encode their authoring provider in the filename
      // itself (e.g. primary-codex-1.result.json). manifest.provider.primary
      // is not yet populated on a campaign's first round — recordReview()
      // sets it after this inventory is written — so it cannot be trusted
      // here; the filename is always correct regardless of round ordering.
      const preservedMatch = name.match(/^primary-(codex|gemini|claude)-/);
      return {
        name,
        provider: preservedMatch ? preservedMatch[1] : provider,
        sha256: sha256File(path.join(resolved, name)),
      };
    }),
  };
  atomicWrite(path.join(resolved, "artifact-inventory.json"), inventory);
}

function artifactPaths(manifest, review) {
  const artifactDir = path.resolve(review.artifactDir);
  const expectedDir = path.resolve(
    manifest.stateRoot,
    "reviews",
    review.to,
    `round-${review.round}-attempt-${review.attempt}`,
  );
  if (
    artifactDir !== expectedDir ||
    !artifactDir.startsWith(`${manifest.stateRoot}${path.sep}`)
  ) {
    throw new Error("review artifact directory identity mismatch");
  }
  if (fs.lstatSync(artifactDir).isSymbolicLink()) {
    throw new Error("review artifact directory must not be a symlink");
  }
  return {
    artifactDir,
    identityFile: path.join(artifactDir, "identity.json"),
    diffFile: path.join(artifactDir, "diff.txt"),
    inventoryFile: path.join(artifactDir, "artifact-inventory.json"),
  };
}

function verifyIdentityFile(manifest, review, identityFile) {
  const identity = parseJson(
    fs.readFileSync(identityFile, "utf8"),
    "review identity",
  );
  const expected = {
    invocationId: manifest.invocationId,
    repositoryRealpath: manifest.repo.realpath,
    repositoryKey: manifest.repo.key,
    pr: manifest.repo.pr,
    baseSha: manifest.revisions.baseSha,
    diffBase: review.from,
    headSha: review.to,
    round: review.round,
    attempt: review.attempt,
    tier: review.tier,
    agentsSha256: review.agentsSha256,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (identity[key] !== value) {
      throw new Error(`review artifact ${key} identity mismatch`);
    }
  }
}

function verifyInventory(manifest, review, inventoryFile, artifactDir) {
  const inventory = parseJson(
    fs.readFileSync(inventoryFile, "utf8"),
    "provider artifact inventory",
  );
  if (
    review.inventorySha256 &&
    sha256File(inventoryFile) !== review.inventorySha256
  ) {
    throw new Error("provider artifact inventory hash mismatch");
  }
  const identityMatches =
    inventory.invocationId === manifest.invocationId &&
    inventory.headSha === review.to &&
    inventory.provider === review.provider;
  const usable =
    inventory.status === "success" &&
    Array.isArray(inventory.files) &&
    inventory.files.length > 0;
  if (!identityMatches || !usable) {
    throw new Error("provider artifact inventory identity/status mismatch");
  }
  for (const item of inventory.files) {
    const file = path.join(artifactDir, item.name);
    const invalid =
      path.dirname(file) !== artifactDir ||
      fs.lstatSync(file).isSymbolicLink() ||
      sha256File(file) !== item.sha256;
    if (invalid)
      throw new Error(`provider artifact hash mismatch: ${item.name}`);
  }
}

function verifyReviewArtifact(manifest, review) {
  const { artifactDir, identityFile, diffFile, inventoryFile } = artifactPaths(
    manifest,
    review,
  );
  for (const file of [identityFile, diffFile, inventoryFile]) {
    if (fs.lstatSync(file).isSymbolicLink()) {
      throw new Error("review artifact files must not be symlinks");
    }
  }
  verifyIdentityFile(manifest, review, identityFile);
  if (sha256File(diffFile) !== review.diffSha256) {
    throw new Error("review diff hash mismatch");
  }
  const canonicalDiff = execFileSync(
    "git",
    ["diff", `${review.from}..${review.to}`],
    { cwd: manifest.repo.realpath },
  );
  const canonicalSha256 = crypto
    .createHash("sha256")
    .update(canonicalDiff)
    .digest("hex");
  if (canonicalSha256 !== review.diffSha256) {
    throw new Error("review diff does not match canonical Git diff");
  }
  if (
    review.tier !== manifest.risk.tier ||
    review.agentsSha256 !== agentsSha256(manifest)
  ) {
    throw new Error("review risk/agent identity mismatch");
  }
  verifyInventory(manifest, review, inventoryFile, artifactDir);
}

function reviewCoverage(manifest) {
  const successful = manifest.reviews.filter(
    (review) => review.status === "success",
  );
  if (successful.length === 0) throw new Error("no successful review coverage");
  let expectedFrom = manifest.revisions.baseSha;
  for (const review of successful) {
    if (review.from !== expectedFrom) {
      throw new Error("review coverage is not contiguous");
    }
    verifyReviewArtifact(manifest, review);
    const authorizedAttempt = manifest.governor.authorizedAttempts.find(
      (attempt) =>
        attempt.token === review.governorAttemptToken &&
        attempt.head === review.to &&
        attempt.consumedAt !== null &&
        !attempt.invalidatedAt,
    );
    if (!authorizedAttempt) {
      throw new Error("review lacks an authorized governor attempt");
    }
    if (review.incompletePanel) {
      throw new Error(
        "an incomplete reduced panel cannot satisfy merge review coverage",
      );
    }
    expectedFrom = review.to;
  }
  if (expectedFrom !== manifest.revisions.currentHead) {
    throw new Error("final HEAD has not been successfully reviewed");
  }
  if (
    !manifest.provider?.reviewer ||
    !manifest.provider?.primary ||
    manifest.provider?.fallback === undefined
  ) {
    throw new Error("review provider evidence is incomplete");
  }
  verifyGateEvidence(manifest);
  return {
    base: manifest.revisions.baseSha,
    head: manifest.revisions.currentHead,
    provider: manifest.provider.reviewer,
    primary: manifest.provider.primary,
    fallback: manifest.provider.fallback,
    tier: manifest.risk.tier,
  };
}

function gateEvidenceIdentity(manifest, options) {
  const name = options.name;
  const command = options.command;
  const source = options.source;
  const log = options.log ? path.resolve(options.log) : null;
  if (!name || !source || !command || !fs.existsSync(log)) {
    throw new Error(
      "gate evidence requires --name, --source, --command, and --log",
    );
  }
  const required = manifest.requiredGates.find((gate) => gate.name === name);
  if (!required) throw new Error(`gate '${name}' is not required by policy`);
  if (source !== required.source || command !== required.command) {
    throw new Error(`gate '${name}' evidence does not match required source`);
  }
  return { name, command, source, log, required };
}

function gateEvidenceInput(manifest, options) {
  const identity = gateEvidenceIdentity(manifest, options);
  const status = options.status || "success";
  const reason = options.reason?.trim() || null;
  if (!["success", "skipped"].includes(status)) {
    throw new Error(`invalid gate evidence status '${status}'`);
  }
  if (
    status === "skipped" &&
    (identity.name !== "test" ||
      identity.required.allowSkip !== true ||
      !reason)
  ) {
    throw new Error(
      "test gate skipping requires --skip-tests and an explicit skip reason",
    );
  }
  return { ...identity, status, reason };
}

function recordGate(manifest, options) {
  const { name, command, source, log, status, reason } = gateEvidenceInput(
    manifest,
    options,
  );
  manifest.gates = manifest.gates.filter(
    (gate) =>
      gate.head !== manifest.revisions.currentHead || gate.name !== name,
  );
  manifest.gates.push({
    name,
    source,
    command,
    head: manifest.revisions.currentHead,
    status,
    reason,
    log,
    logSha256: sha256File(log),
    completedAt: new Date().toISOString(),
  });
}

function recordSkippedGate(manifest, required, name, log, options) {
  const reason = options.reason?.trim();
  fs.writeFileSync(log, `SKIPPED: ${reason || ""}\n`, { mode: 0o600 });
  recordGate(manifest, {
    name,
    source: required.source,
    command: required.command,
    log,
    status: "skipped",
    reason,
  });
}

function executeGate(manifest, required, name, log) {
  const gateSeconds = manifest.risk?.runtime?.checkSeconds ?? 300;
  const phaseDeadline = providerPhaseDeadline(manifest);
  const campaignRemaining = phaseDeadline
    ? phaseDeadline - Math.floor(Date.now() / 1000)
    : gateSeconds;
  if (campaignRemaining <= 0) {
    throw new Error(`campaign budget is exhausted before gate '${name}'`);
  }
  const timeoutSeconds = Math.min(gateSeconds, campaignRemaining);
  const boundedRunner = path.join(__dirname, "quality-run-bounded.sh");
  const result = spawnSync(
    "bash",
    [
      boundedRunner,
      "--timeout",
      String(timeoutSeconds),
      "--",
      required.executable,
      ...required.args,
    ],
    {
      cwd: manifest.repo.realpath,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  fs.writeFileSync(log, output, { mode: 0o600 });
  if (result.status === 124) {
    throw new Error(
      `gate '${name}' exceeded its proportional ${timeoutSeconds}s budget`,
    );
  }
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(output);
    throw new Error(`gate '${name}' failed with exit status ${result.status}`);
  }
  return output;
}

function runGate(manifest, options) {
  if (manifest.repo.isCrossRepository === true) {
    throw new Error(
      "cross-repository PR gates must run in isolated CI; host execution is forbidden",
    );
  }
  const name = options.name;
  const required = manifest.requiredGates.find((gate) => gate.name === name);
  if (!required) throw new Error(`gate '${name}' is not required by policy`);
  const log = path.join(
    manifest.stateRoot,
    "gates",
    manifest.revisions.currentHead,
    `${name}.log`,
  );
  fs.mkdirSync(path.dirname(log), { recursive: true, mode: 0o700 });
  if (options.skip === true) {
    recordSkippedGate(manifest, required, name, log, options);
    return;
  }
  const output = executeGate(manifest, required, name, log);
  recordGate(manifest, {
    name,
    source: required.source,
    command: required.command,
    log,
    status: "success",
  });
  process.stdout.write(output);
}

function validGateArtifact(gate) {
  return Boolean(
    gate && fs.existsSync(gate.log) && sha256File(gate.log) === gate.logSha256,
  );
}

function gateMatchesRequirement(gate, required) {
  return Boolean(
    gate?.source === required.source && gate?.command === required.command,
  );
}

function validTestGate(manifest, gate) {
  if (!validGateArtifact(gate)) return false;
  const required = manifest.requiredGates.find(
    (candidate) => candidate.name === "test",
  );
  if (!gateMatchesRequirement(gate, required)) return false;
  if (gate.status === "success") return true;
  return Boolean(
    manifest.requiredGates.find((required) => required.name === "test")
      ?.allowSkip === true &&
    gate.status === "skipped" &&
    typeof gate.reason === "string" &&
    gate.reason.trim() !== "",
  );
}

function verifyGateEvidence(manifest) {
  const current = manifest.gates.filter(
    (gate) => gate.head === manifest.revisions.currentHead,
  );
  for (const required of manifest.requiredGates) {
    const gate = current.find((item) => item.name === required.name);
    const valid =
      required.name === "test"
        ? validTestGate(manifest, gate)
        : gate?.status === "success" &&
          gateMatchesRequirement(gate, required) &&
          validGateArtifact(gate);
    if (!valid) {
      throw new Error(
        `required ${required.name} gate evidence is missing or stale`,
      );
    }
  }
}

function reviewTrailers(manifest) {
  const authorization = reviewAuthorization(manifest);
  return [
    "Reviewed-By: quality",
    `Reviewed-By: ${authorization.provider}`,
    `Quality-Tier: ${authorization.tier}`,
    `Quality-Reviewer: ${authorization.provider}`,
    `Quality-Primary: ${authorization.primary}`,
    `Quality-Fallback: ${authorization.fallback}`,
    `Quality-Findings: ${authorization.blockingCount}`,
    `Quality-Head: ${authorization.head}`,
    `Quality-Base: ${authorization.base}`,
  ].join("\n");
}

function reviewAuthorization(manifest) {
  // This is the authoritative provider-neutral merge evidence boundary. Repeat
  // the strength assertion here so a caller cannot bypass resume/advance and
  // authorize review artifacts produced under a stale, weaker risk contract.
  assertCurrentReviewStrength(manifest, manifest.repo.realpath);
  const authorization = reviewCoverage(manifest);
  const successful = manifest.reviews.filter(
    (review) => review.status === "success",
  );
  const evidenceSha256 = crypto
    .createHash("sha256")
    .update(reviewedEvidence(manifest))
    .digest("hex");
  if (
    manifest.judge?.head !== manifest.revisions.currentHead ||
    manifest.judge?.reviewCount !== successful.length ||
    manifest.judge?.evidenceSha256 !== evidenceSha256
  ) {
    throw new Error(
      "judge result is missing, stale, or not bound to review evidence",
    );
  }
  const judgeArtifact = parseJson(
    fs.readFileSync(manifest.judge.artifactPath, "utf8"),
    "persisted judge artifact",
  );
  const persistedBlockingCount = judgeArtifact.findings.filter(
    (finding) => finding.disposition === "BLOCKING",
  ).length;
  if (
    sha256File(manifest.judge.artifactPath) !== manifest.judge.artifactSha256 ||
    judgeArtifact.head !== manifest.revisions.currentHead ||
    judgeArtifact.invocationId !== manifest.invocationId ||
    judgeArtifact.repositoryKey !== manifest.repo.key ||
    judgeArtifact.reviewCount !== successful.length ||
    judgeArtifact.evidenceSha256 !== evidenceSha256 ||
    persistedBlockingCount !== manifest.judge.blockingCount
  ) {
    throw new Error("persisted judge artifact is stale or has been modified");
  }
  if (manifest.judge.blockingCount !== 0) {
    throw new Error(
      `${manifest.judge.blockingCount} unresolved BLOCKING finding(s)`,
    );
  }
  return { ...authorization, blockingCount: manifest.judge.blockingCount };
}

function openManifestLock(lock) {
  try {
    return fs.openSync(lock, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(
        "quality manifest is locked; stale locks require explicit operator cleanup",
        { cause: error },
      );
    }
    throw error;
  }
}

function withManifestLock(file, mutation) {
  const lock = `${path.resolve(file)}.lock`;
  const descriptor = openManifestLock(lock);
  try {
    fs.writeFileSync(
      descriptor,
      `${JSON.stringify({
        pid: process.pid,
        hostname: os.hostname(),
        acquiredAt: new Date().toISOString(),
      })}\n`,
    );
    const loaded = loadManifest(file);
    const before = loaded.manifest.manifestRevision;
    mutation(loaded.manifest, loaded.manifestPath);
    const current = loadManifest(file).manifest.manifestRevision;
    if (current !== before) {
      throw new Error("quality manifest changed concurrently");
    }
    saveManifest(loaded.manifestPath, loaded.manifest);
    return loaded.manifest;
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
  }
}

function getPath(value, dottedPath) {
  return dottedPath
    .split(".")
    .reduce((current, part) => current?.[part], value);
}

function printValue(value) {
  if (value === undefined || value === null) return;
  process.stdout.write(
    typeof value === "object" ? JSON.stringify(value) : String(value),
  );
}

function mutate(manifestArg, operation) {
  return withManifestLock(manifestArg, (locked) => {
    validateIdentity(locked, locked.repo.realpath);
    operation(locked);
  });
}

// Repo-relative files changed across the reviewed base..head, quoted-path safe.
function reviewedChangedFiles(manifest) {
  const root = manifest.repo.realpath;
  const range = `${manifest.revisions.baseSha}..${manifest.revisions.currentHead}`;
  // -z NUL-delimits and -c core.quotepath=false keeps non-ASCII paths literal,
  // so a file with an accented/space name cannot slip past the matcher.
  // --no-renames represents a rename as delete(old)+add(new) so BOTH paths are
  // surfaced; without it git collapses a rename to the destination only, letting
  // `auth/x.js -> src/x.js` hide the sensitive origin from the floor matcher
  // (Codex + security-auditor review: rename-hides-path exploit).
  const out = git(root, [
    "-c",
    "core.quotepath=false",
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    range,
  ]);
  return out.split("\0").filter(Boolean);
}

// True when the reviewed change touches the always-human security floor.
// An EMPTY changed-file set fails closed (returns true → human required): the
// relaxation must never proceed having verified nothing. base==head, a bad
// range, or a zero-file diff all mean "could not prove clear", which is NOT
// "clear". A git error inside reviewedChangedFiles throws → top-level exit 1,
// which the caller also treats as human-required.
function humanFloorCheck(manifest) {
  const cfg = riskScore.loadConfig(manifest.repo.realpath);
  const files = reviewedChangedFiles(manifest);
  if (files.length === 0) return true;
  return riskScore.touchesHumanFloor(files, cfg);
}

function gateSatisfied(manifest, name) {
  const required = manifest.requiredGates.find((gate) => gate.name === name);
  if (!required) throw new Error(`gate '${name}' is not required`);
  return manifest.gates.some(
    (gate) =>
      gate.name === name &&
      gate.head === manifest.revisions.currentHead &&
      ["success", "skipped"].includes(gate.status) &&
      gate.source === required.source &&
      gate.command === required.command &&
      validGateArtifact(gate),
  );
}

const COMMANDS = {
  validate: ({ manifest }) =>
    process.stdout.write(`${manifest.invocationId}\n`),
  risk: ({ manifestArg, rawArgs }) =>
    mutate(manifestArg, (locked) => setRisk(locked, parseOptions(rawArgs))),
  agents: ({ manifestArg, rawArgs }) => {
    const incomplete = rawArgs.includes("--incomplete");
    const names = rawArgs.filter((argument) => argument !== "--incomplete");
    mutate(manifestArg, (locked) => setAgents(locked, names, { incomplete }));
  },
  "approval-valid": ({ manifest }) => {
    process.exitCode = approvalValid(manifest, manifest.repo.realpath) ? 0 : 1;
  },
  "human-floor-check": ({ manifest }) => {
    // Contract designed so the AUTONOMOUS path is reachable ONLY by an explicit
    // verified-clear result; every other outcome requires a human.
    //   0  = verified clear of the human floor (autonomous critical permitted)
    //   10 = touches the always-human floor (human capability required)
    //   1  = error (top-level catch) → human required (fail closed)
    process.exitCode = humanFloorCheck(manifest) ? 10 : 0;
  },
  "gate-satisfied": ({ manifest, rawArgs }) => {
    const options = parseOptions(rawArgs);
    process.exitCode = gateSatisfied(manifest, options.name) ? 0 : 1;
  },
  "provider-attempt": ({ manifestArg, rawArgs }) => {
    let result;
    mutate(manifestArg, (locked) => {
      result = authorizeProviderAttempt(locked, parseOptions(rawArgs));
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  },
  "review-info": ({ manifest }) =>
    process.stdout.write(`${JSON.stringify(reviewInfo(manifest))}\n`),
  "review-identity": ({ manifest }) =>
    process.stdout.write(`${JSON.stringify(reviewIdentity(manifest))}\n`),
  "record-review": ({ manifestArg, rawArgs }) =>
    mutate(manifestArg, (locked) =>
      recordReview(locked, parseOptions(rawArgs)),
    ),
  judge: ({ manifestArg, rawArgs }) =>
    mutate(manifestArg, (locked) => recordJudge(locked, parseOptions(rawArgs))),
  "gate-run": ({ manifestArg, rawArgs }) =>
    mutate(manifestArg, (locked) => runGate(locked, parseOptions(rawArgs))),
  "gate-plan": ({ manifest, rawArgs }) => {
    const options = parseOptions(rawArgs);
    const required = manifest.requiredGates.find(
      (gate) => gate.name === options.name,
    );
    if (!required) throw new Error(`gate '${options.name}' is not required`);
    process.stdout.write(`${JSON.stringify(required)}\n`);
  },
  "record-stamp": ({ manifestArg, rawArgs }) =>
    mutate(manifestArg, (locked) =>
      recordStamp(locked, locked.repo.realpath, parseOptions(rawArgs)),
    ),
  "record-stamp-published": ({ manifestArg, rawArgs }) =>
    mutate(manifestArg, (locked) =>
      recordStampPublished(locked, parseOptions(rawArgs)),
    ),
  inventory: ({ manifest, rawArgs }) => {
    const options = parseOptions(rawArgs);
    writeArtifactInventory(manifest, options["artifact-dir"], options.provider);
  },
  get: ({ manifest, rawArgs }) => printValue(getPath(manifest, rawArgs[0])),
  field: ({ manifest, rawArgs }) => printValue(getPath(manifest, rawArgs[0])),
  "verify-artifacts": ({ manifest }) => {
    for (const review of manifest.reviews.filter(
      (item) => item.status === "success",
    )) {
      verifyReviewArtifact(manifest, review);
    }
  },
  "review-authorization": ({ manifest }) =>
    process.stdout.write(`${JSON.stringify(reviewAuthorization(manifest))}\n`),
  "judge-context": ({ manifest }) =>
    process.stdout.write(`${JSON.stringify(judgeContext(manifest))}\n`),
  "prior-findings": ({ manifest }) =>
    process.stdout.write(
      `${JSON.stringify({ findings: priorFindings(manifest) })}\n`,
    ),
  trailers: ({ manifest }) =>
    process.stdout.write(`${reviewTrailers(manifest)}\n`),
};

function runAdvance(manifestArg, manifest, rawArgs) {
  const options = parseOptions(rawArgs);
  const updated = withManifestLock(manifestArg, (locked) => {
    validateIdentity(locked, manifest.repo.realpath, { requireHead: false });
    bindPrRepositoryIdentity(locked, options);
    const advanced = advanceHead(locked, manifest.repo.realpath);
    validateIdentity(locked, manifest.repo.realpath);
    const discovered = discoverRequiredGates(
      locked.repo.realpath,
      { "skip-tests": locked.options?.skipTests === true },
      locked.revisions.currentHead,
    );
    locked.requiredGates = locked[NEEDS_REQUIRED_GATES_MIGRATION]
      ? discovered
      : unionRequiredGates(locked.requiredGates, discovered);
    locked.requiredGatesPolicyVersion = REQUIRED_GATES_POLICY_VERSION;
    locked[NEEDS_REQUIRED_GATES_MIGRATION] = false;
    if (
      advanced &&
      locked.reviews.length > 0 &&
      locked.governor.providerDeadlineHead !== locked.revisions.currentHead
    ) {
      locked.governor.validationDeadlineEpoch = Math.min(
        locked.governor.campaignDeadlineEpoch,
        Math.floor(Date.now() / 1000) +
          (locked.risk?.runtime?.checkReserveSeconds ?? 300) +
          (locked.risk?.runtime?.reviewReserveSeconds ?? 300),
      );
    }
  });
  process.stdout.write(`${updated.revisions.currentHead}\n`);
}

function runCommand(command, rawArgs) {
  if (command === "create") {
    process.stdout.write(`${createManifest(parseOptions(rawArgs))}\n`);
    return;
  }
  const manifestArg = rawArgs.shift();
  if (!manifestArg)
    throw new Error(`${command || "command"} requires a manifest`);
  const { manifest } = loadManifest(manifestArg);
  if (command === "locate") {
    process.stdout.write(`${manifest.repo.realpath}\n`);
    return;
  }
  if (command === "advance") return runAdvance(manifestArg, manifest, rawArgs);
  if (manifest[NEEDS_REQUIRED_GATES_MIGRATION]) {
    throw new Error(
      "legacy manifest requires an explicit advance before gate evaluation",
    );
  }
  validateIdentity(manifest, manifest.repo.realpath);
  const handler = COMMANDS[command];
  if (!handler)
    throw new Error(`unknown quality invocation command '${command}'`);
  handler({ manifestArg, manifest, rawArgs });
}

function main() {
  const [command, ...rawArgs] = process.argv.slice(2);
  try {
    runCommand(command, rawArgs);
  } catch (error) {
    process.stderr.write(`quality manifest: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  SCHEMA_VERSION,
  advanceHead,
  approvalValid,
  armApprovalChallenge,
  attachApproval,
  authorizeProviderAttempt,
  atomicWrite,
  canonicalRoot,
  computePatchId,
  currentPatchId,
  createManifest,
  loadManifest,
  parseOptions,
  parseJson,
  recordReview,
  recordJudge,
  recordGate,
  runGate,
  recordStamp,
  judgeContext,
  repoKey,
  reviewInfo,
  reviewIdentity,
  reviewTrailers,
  saveManifest,
  setAgents,
  setRisk,
  reviewAuthorization,
  verifyReviewArtifact,
  writeArtifactInventory,
  validateIdentity,
  withManifestLock,
};

if (require.main === module) main();
