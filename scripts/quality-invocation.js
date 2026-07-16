#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const SCHEMA_VERSION = 1;

function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`, {
      cause: error,
    });
  }
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

function isEmptyStampCommit(root, reviewedHead) {
  try {
    const parent = git(root, ["rev-parse", "HEAD~1"]);
    execFileSync("git", ["diff", "--quiet", "HEAD~1", "HEAD"], {
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

function buildApproval(options, identity) {
  const approved =
    options["break-glass-approved"] === true ||
    process.env.BREAK_GLASS_APPROVED === "true";
  if (!approved) return { approved: false };
  return {
    approved: true,
    repoKey: identity.repoKey,
    pr: identity.pr,
    head: identity.head,
    actor: firstValue(
      options["approval-actor"],
      process.env.BREAK_GLASS_APPROVER,
      process.env.USER,
      "unknown",
    ),
    source: firstValue(options["approval-source"], "outer-invocation"),
    at: identity.now,
  };
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
  return {
    startedAtEpoch: Math.floor(Date.now() / 1000),
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
    if (["--merge", "--break-glass-approved"].includes(name)) {
      if (inlineValue !== null && !["true", "false"].includes(inlineValue)) {
        throw new Error(`${name} accepts only true or false`);
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
  const pr =
    options.pr === undefined
      ? null
      : parseInteger(options.pr, "pr", { minimum: 1 });
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
    approval: buildApproval(options, { repoKey: key, pr, head, now }),
    risk: {
      requestedLevel: firstValue(options.level, "auto"),
      resolved: false,
    },
    agents: [],
    provider: buildProvider(options),
    reviews: [],
    governor: buildGovernor(head),
    gates: [],
  };
  atomicWrite(manifestPath, manifest);
  return manifestPath;
}

function advanceHead(manifest, root) {
  const nextHead = git(root, ["rev-parse", "HEAD"]);
  const priorHead = manifest.revisions.currentHead;
  if (nextHead === priorHead) return false;
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
  manifest.revisions.currentHead = nextHead;
  return true;
}

function setRisk(manifest, options) {
  if (manifest.risk?.resolved || manifest.reviews.length > 0) {
    throw new Error("risk resolution is immutable once persisted");
  }
  const tier = options.tier;
  if (!["low", "medium", "high", "critical"].includes(tier)) {
    throw new Error(`invalid resolved tier '${tier}'`);
  }
  const tierRank = { low: 0, medium: 1, high: 2, critical: 3 };
  const requestedMinimum =
    manifest.risk.requestedLevel === "98"
      ? "critical"
      : manifest.risk.requestedLevel === "95"
        ? "high"
        : ["low", "medium", "high", "critical"].includes(
              manifest.risk.requestedLevel,
            )
          ? manifest.risk.requestedLevel
          : "low";
  if (tierRank[tier] < tierRank[requestedMinimum]) {
    throw new Error(
      `resolved tier ${tier} is below requested minimum ${requestedMinimum}`,
    );
  }
  manifest.risk = {
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
  };
}

function setAgents(manifest, names) {
  if (!manifest.risk?.resolved) {
    throw new Error("cannot select agents before risk resolution");
  }
  if (names.length < 2) {
    throw new Error("quality agent floor requires at least two agents");
  }
  if (manifest.agents.length > 0 || manifest.reviews.length > 0) {
    throw new Error("quality agent selection is immutable once persisted");
  }
  manifest.agents = names;
}

function approvalValid(manifest) {
  const approval = manifest.approval;
  return Boolean(
    approval?.approved === true &&
    approval.repoKey === manifest.repo.key &&
    approval.pr === manifest.repo.pr &&
    approval.head === manifest.revisions.currentHead,
  );
}

function renewApproval(manifest, options) {
  const now = new Date().toISOString();
  manifest.approval = buildApproval(
    {
      "break-glass-approved": true,
      "approval-actor": options["approval-actor"],
      "approval-source": options["approval-source"] || "resumed-invocation",
    },
    {
      repoKey: manifest.repo.key,
      pr: manifest.repo.pr,
      head: manifest.revisions.currentHead,
      now,
    },
  );
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
  }
  const expectedIds = context.findings.map((finding) => finding.id).sort();
  const actualIds = input.findings.map((finding) => finding.id).sort();
  if (JSON.stringify(expectedIds) !== JSON.stringify(actualIds)) {
    throw new Error("judge artifact does not classify every provider finding");
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
    for (const item of inventory.files.filter((file) =>
      file.name.endsWith(".findings.txt"),
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
      attempt.consumedAt === null,
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
        attempt.consumedAt !== null,
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

function recordGate(manifest, options) {
  const name = options.name;
  const command = options.command;
  const log = path.resolve(options.log);
  if (!name || !command || !fs.existsSync(log)) {
    throw new Error("gate evidence requires --name, --command, and --log");
  }
  manifest.gates = manifest.gates.filter(
    (gate) =>
      gate.head !== manifest.revisions.currentHead || gate.name !== name,
  );
  manifest.gates.push({
    name,
    command,
    head: manifest.revisions.currentHead,
    status: "success",
    log,
    logSha256: sha256File(log),
    completedAt: new Date().toISOString(),
  });
}

function verifyGateEvidence(manifest) {
  const current = manifest.gates.filter(
    (gate) => gate.head === manifest.revisions.currentHead,
  );
  for (const required of ["lint", "test", "security"]) {
    const gate = current.find((item) => item.name === required);
    if (
      !gate ||
      gate.status !== "success" ||
      !fs.existsSync(gate.log) ||
      sha256File(gate.log) !== gate.logSha256
    ) {
      throw new Error(`required ${required} gate evidence is missing or stale`);
    }
  }
}

function reviewTrailers(manifest) {
  const authorization = reviewAuthorization(manifest);
  return [
    `Reviewed-By: quality (tier=${authorization.tier}, reviewer=${authorization.provider}, primary=${authorization.primary}, fallback=${authorization.fallback}, findings=${authorization.blockingCount}, head=${authorization.head}, base=${authorization.base})`,
    `Reviewed-By: ${authorization.provider} (tier=${authorization.tier}, findings=${authorization.blockingCount}, head=${authorization.head}, base=${authorization.base})`,
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
  approve: ({ manifestArg, rawArgs }) => {
    const options = parseOptions(rawArgs);
    withManifestLock(manifestArg, (locked) => {
      validateIdentity(locked, locked.repo.realpath);
      renewApproval(locked, options);
    });
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

function runAdvance(manifestArg, manifest) {
  const updated = withManifestLock(manifestArg, (locked) => {
    validateIdentity(locked, manifest.repo.realpath, { requireHead: false });
    advanceHead(locked, manifest.repo.realpath);
    validateIdentity(locked, manifest.repo.realpath);
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
  if (command === "advance") return runAdvance(manifestArg, manifest);
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
  atomicWrite,
  canonicalRoot,
  createManifest,
  loadManifest,
  parseOptions,
  parseJson,
  recordReview,
  recordJudge,
  recordGate,
  judgeContext,
  renewApproval,
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
