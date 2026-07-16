#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

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
  return crypto.createHash("sha256").update(root).digest("hex").slice(0, 16);
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

function normalizeGovernor(manifest) {
  manifest.governor ??= {};
  manifest.governor.authorizedAttempts ??= [];
  manifest.governor.maxProviderAttempts ??= 6;
  manifest.governor.providerWindowSeconds ??= 3600;
  manifest.governor.providerDeadlineEpoch ??=
    manifest.governor.startedAtEpoch + manifest.governor.providerWindowSeconds;
  manifest.governor.providerDeadlineHead ??= null;
  manifest.governor.providerAttempts ??= [];
  manifest.governor.campaignSeconds ??=
    manifest.governor.providerWindowSeconds +
    manifest.governor.remediationSeconds +
    manifest.governor.reReviewReserveSeconds;
  manifest.governor.campaignDeadlineEpoch ??=
    manifest.governor.startedAtEpoch + manifest.governor.campaignSeconds;
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
  const actualBase = git(actualRoot, [
    "merge-base",
    currentHead,
    manifest.revisions.baseRef,
  ]);
  if (actualBase !== manifest.revisions.baseSha) {
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
  return script
    ? scriptGate(name, script, manager, allowSkip)
    : {
        name,
        source: "baseline-policy",
        command: `external:${name}`,
        executable: null,
        args: [],
        allowSkip,
      };
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
  const required = [
    baselineGate("lint", scripts, ["lint", "lint:check"], manager),
    baselineGate(
      "test",
      scripts,
      ["test", "test:unit", "test:ci"],
      manager,
      options["skip-tests"] === true,
    ),
    baselineGate("security", scripts, ["security:audit", "security"], manager),
  ];
  if (typeof scripts.build === "string") {
    required.push(scriptGate("build", "build", manager));
  }
  const typeScript = ["type-check:all", "type-check", "typecheck"].find(
    (name) => typeof scripts[name] === "string",
  );
  if (typeScript) {
    required.push(scriptGate("type", typeScript, manager));
  }
  const consumerScript = Object.keys(scripts).find((name) =>
    /^test:consumer(?:$|[-:])/.test(name),
  );
  const consumerFixture =
    committedFile(root, head, "tests/consumer-workflow-integration.test.js") !==
    null;
  if (consumerScript || consumerFixture) {
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
    if (["--merge", "--skip-tests"].includes(name)) {
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

function createManifest(options) {
  const root = canonicalRoot(firstValue(options.repo, process.cwd()));
  const baseRef = firstValue(options["base-ref"], "origin/main");
  const head = git(root, ["rev-parse", "HEAD"]);
  const baseSha = git(root, ["merge-base", head, baseRef]);
  const invocationId = firstValue(
    options["invocation-id"],
    crypto.randomUUID(),
  );
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      invocationId,
    )
  ) {
    throw new Error("invocation-id must be a UUID");
  }
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
  if (options.manifest !== undefined) {
    throw new Error("create does not accept a custom manifest path");
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
  const now = new Date().toISOString();
  const key = repoKey(root);
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    manifestRevision: 0,
    invocationId,
    createdAt: now,
    updatedAt: now,
    stateRoot,
    options: {
      merge: options.merge === true,
      level: firstValue(options.level, "auto"),
      scope: firstValue(options.scope, "branch"),
      skipTests: options["skip-tests"] === true,
    },
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
      baseHeadSha: firstValue(options["base-head-sha"], baseSha),
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
    provider: buildProvider(options),
    reviews: [],
    governor: buildGovernor(head),
    requiredGates: discoverRequiredGates(root, options),
    requiredGatesPolicyVersion: REQUIRED_GATES_POLICY_VERSION,
    gates: [],
  };
  initializeApprovalTrustFromEnvironment(manifest);
  atomicWrite(manifestPath, manifest);
  return manifestPath;
}

function advanceHead(manifest, root) {
  const nextHead = git(root, ["rev-parse", "HEAD"]);
  const priorHead = manifest.revisions.currentHead;
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
  try {
    git(root, ["merge-base", "--is-ancestor", priorHead, nextHead]);
  } catch {
    throw new Error(
      `quality resume refused: ${priorHead} is not an ancestor of ${nextHead}`,
    );
  }
  if (
    manifest.approval?.approved === true &&
    manifest.approval.head !== nextHead
  ) {
    manifest.approval = {
      approved: false,
      invalidatedAt: new Date().toISOString(),
      reason: `HEAD advanced from ${manifest.approval.head} to ${nextHead}`,
    };
  }
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
    gateSeconds: parseInteger(
      options["gate-seconds"] || "300",
      "gate seconds",
      {
        minimum: 1,
      },
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
  const resolved = {
    requestedLevel: manifest.risk.requestedLevel,
    resolved: true,
    tier,
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

function setAgents(manifest, names) {
  if (!manifest.risk?.resolved) {
    throw new Error("cannot select agents before risk resolution");
  }
  if (names.length < 2) {
    throw new Error("quality agent floor requires at least two agents");
  }
  if (
    manifest.agents.length > 0 &&
    JSON.stringify(manifest.agents) === JSON.stringify(names)
  ) {
    return;
  }
  if (manifest.agents.length > 0 || manifest.reviews.length > 0) {
    throw new Error("quality agent selection is immutable once persisted");
  }
  manifest.agents = names;
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
  const existingComplete =
    manifest.repo.githubRepository &&
    manifest.repo.headRefName &&
    manifest.repo.headRepository &&
    typeof manifest.repo.isCrossRepository === "boolean";
  if (!supplied) {
    if (existingComplete) return;
    throw new Error("resumed PR repository identity is incomplete");
  }
  const identity = {
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
  if (
    !identity.githubRepository ||
    !identity.headRefName ||
    !identity.headRepository ||
    identity.isCrossRepository === null ||
    identity.isCrossRepository !==
      (identity.githubRepository !== identity.headRepository)
  ) {
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

function approvalRecordValid(manifest, approval) {
  const expected = {
    repoKey: manifest.repo.key,
    pr: manifest.repo.pr,
    head: manifest.revisions.currentHead,
    invocationId: manifest.invocationId,
  };
  const identityMatches = Object.entries(expected).every(
    ([key, value]) => approval?.[key] === value,
  );
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

function approvalValid(manifest) {
  const approval = manifest.approval;
  if (!approvalRecordValid(manifest, approval)) return false;
  try {
    const artifact = parseJson(
      fs.readFileSync(approval.artifactPath, "utf8"),
      "approval capability",
    );
    const payload = artifact.payload;
    const identityMatches =
      payload?.repoKey === manifest.repo.key &&
      payload?.pr === manifest.repo.pr &&
      payload?.head === manifest.revisions.currentHead &&
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
  if (approvalValid(manifest)) {
    throw new Error("cannot replace a currently valid approval capability");
  }
  manifest.approvalChallengeSha256 = challenge;
  manifest.approvalTrust = {
    publicKey,
    pinnedAt: new Date().toISOString(),
  };
}

function initializeApprovalTrustFromEnvironment(manifest) {
  const challenge = process.env.BS_QUALITY_APPROVAL_CHALLENGE_SHA256;
  const publicKey = process.env.BS_QUALITY_APPROVAL_PUBLIC_KEY;
  if (!challenge && !publicKey) return;
  armApprovalChallenge(manifest, { challenge, publicKey });
}

function authorizeProviderAttempt(manifest, options) {
  const provider = options.provider;
  if (!["claude", "codex"].includes(provider)) {
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
  const deadline = Math.min(
    governor.providerDeadlineEpoch,
    governor.campaignDeadlineEpoch,
  );
  if (now >= deadline) {
    throw new Error("absolute provider deadline exhausted");
  }
  if (governor.providerAttempts.length >= governor.maxProviderAttempts) {
    throw new Error("absolute provider attempt cap exhausted");
  }
  const attempt = {
    number: governor.providerAttempts.length + 1,
    provider,
    head: manifest.revisions.currentHead,
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
    const inventory = parseJson(
      fs.readFileSync(path.join(review.artifactDir, "artifact-inventory.json")),
      "provider artifact inventory",
    );
    for (const item of inventory.files.filter((file) =>
      file.name.endsWith(".json"),
    )) {
      const parsed = parseJson(
        fs.readFileSync(path.join(review.artifactDir, item.name), "utf8"),
        `provider result ${item.name}`,
      );
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
          source: `${item.name}#${index}`,
        });
      });
    }
    for (const item of inventory.files.filter(
      (file) =>
        review.provider === "claude" && file.name.endsWith(".findings.txt"),
    )) {
      const text = fs
        .readFileSync(path.join(review.artifactDir, item.name), "utf8")
        .trim();
      if (!text || text === "NO FINDINGS.") continue;
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
        /^codex-\d+\.json$/.test(name),
    )
    .sort();
  const findings = names.filter((name) => name.endsWith(".findings.txt"));
  if (findings.length === 0) throw new Error("provider findings are missing");
  if (
    findings.some((name) =>
      fs
        .readFileSync(path.join(resolved, name), "utf8")
        .startsWith("INCONCLUSIVE:"),
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
    files: names.map((name) => ({
      name,
      sha256: sha256File(path.join(resolved, name)),
    })),
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

const COMMANDS = {
  validate: ({ manifest }) =>
    process.stdout.write(`${manifest.invocationId}\n`),
  risk: ({ manifestArg, rawArgs }) =>
    mutate(manifestArg, (locked) => setRisk(locked, parseOptions(rawArgs))),
  agents: ({ manifestArg, rawArgs }) =>
    mutate(manifestArg, (locked) => setAgents(locked, rawArgs)),
  "approval-valid": ({ manifest }) => {
    process.exitCode = approvalValid(manifest) ? 0 : 1;
  },
  "approval-attach": ({ manifestArg, rawArgs }) =>
    mutate(manifestArg, (locked) =>
      attachApproval(locked, parseOptions(rawArgs)),
    ),
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
  gate: ({ manifestArg, rawArgs }) =>
    mutate(manifestArg, (locked) => recordGate(locked, parseOptions(rawArgs))),
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
  trailers: ({ manifest }) =>
    process.stdout.write(`${reviewTrailers(manifest)}\n`),
};

function runAdvance(manifestArg, manifest, rawArgs) {
  const options = parseOptions(rawArgs);
  const updated = withManifestLock(manifestArg, (locked) => {
    validateIdentity(locked, manifest.repo.realpath, { requireHead: false });
    bindPrRepositoryIdentity(locked, options);
    advanceHead(locked, manifest.repo.realpath);
    validateIdentity(locked, manifest.repo.realpath);
    if (locked.governor.providerDeadlineHead !== locked.revisions.currentHead) {
      const verificationWindow =
        locked.risk?.runtime?.verificationSeconds ??
        locked.governor.providerWindowSeconds;
      locked.governor.providerDeadlineEpoch = Math.min(
        Math.floor(Date.now() / 1000) + verificationWindow,
        locked.governor.campaignDeadlineEpoch,
      );
      locked.governor.providerDeadlineHead = locked.revisions.currentHead;
    }
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
    const challenge = process.env.BS_QUALITY_APPROVAL_CHALLENGE_SHA256;
    const publicKey = process.env.BS_QUALITY_APPROVAL_PUBLIC_KEY;
    if (challenge || publicKey) {
      armApprovalChallenge(locked, { challenge, publicKey });
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
  authorizeProviderAttempt,
  attachApproval,
  atomicWrite,
  canonicalRoot,
  createManifest,
  loadManifest,
  parseOptions,
  parseJson,
  recordReview,
  recordJudge,
  recordGate,
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
