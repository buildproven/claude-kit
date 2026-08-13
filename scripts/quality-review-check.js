#!/usr/bin/env node
"use strict";

/**
 * Publish and verify signed quality evidence without rewriting the PR branch.
 *
 * The evidence is carried by a completed GitHub check run on the reviewed
 * commit. The signature is the trust boundary; the check-run name and exact
 * head only locate the evidence and bind it to the candidate being merged.
 */
const { spawnSync } = require("child_process");
const fs = require("node:fs");
const path = require("node:path");
const invocation = require("./quality-invocation.js");
const {
  signEvidence,
  verifyEvidence,
  signingKeyFromEnvironment,
} = require("./quality-review-evidence.js");

const CHECK_NAME = "quality-review-evidence";
const CHECK_SCHEMA_VERSION = 1;
const TIER_RANK = { low: 0, medium: 1, high: 2, critical: 3 };

function fail(message) {
  throw new Error(message);
}

function runGh(args, input) {
  const result = spawnSync("gh", args, {
    input,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `gh ${args.join(" ")} failed: ${(result.stderr || "").trim()}`,
    );
  }
  return result.stdout || "";
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`, {
      cause: error,
    });
  }
}

function checkRuns(repository, head) {
  const runs = [];
  let totalCount;
  for (let page = 1; page <= 100; page += 1) {
    const response = parseJson(
      runGh([
        "api",
        "--header",
        "Accept: application/vnd.github+json",
        `repos/${repository}/commits/${head}/check-runs?per_page=100&page=${page}`,
      ]),
      "GitHub check-run response",
    );
    if (!Array.isArray(response.check_runs)) {
      fail("GitHub check-run response has no check_runs array");
    }
    if (page === 1 && response.total_count === undefined) {
      return response.check_runs;
    }
    if (page === 1) {
      if (!Number.isInteger(response.total_count) || response.total_count < 0) {
        fail("GitHub check-run total_count is invalid");
      }
      totalCount = response.total_count;
    }
    runs.push(...response.check_runs);
    if (runs.length >= totalCount) return runs;
    if (response.check_runs.length === 0) {
      fail("GitHub check-run pagination ended before total_count");
    }
  }
  fail("GitHub check-run pagination exceeded 100 pages");
}

function evidenceFields(authorization) {
  const fields = {
    head: authorization.head,
    base: authorization.base,
    tier: authorization.tier,
    findings: authorization.blockingCount,
    reviewer: authorization.provider,
    primary: authorization.primary,
    fallback: authorization.fallback,
  };
  if (authorization.contractVersion >= 2) {
    Object.assign(fields, {
      contractVersion: authorization.contractVersion,
      leads: authorization.leads,
      reviewStatus: authorization.reviewStatus,
      policyDigest: authorization.policyDigest,
      agentsSha256: authorization.agentsSha256,
      domain: authorization.domain,
      selectionRule: authorization.selectionRule,
      repositoryKey: authorization.repositoryKey,
      diffSha256: authorization.diffSha256,
      evidenceSha256: authorization.evidenceSha256,
    });
  }
  if (authorization.operatorOverride) {
    fields.override = authorization.override;
  }
  return fields;
}

function recordForFields(fields, signature) {
  return {
    schemaVersion: CHECK_SCHEMA_VERSION,
    evidence: fields,
    signature,
  };
}

function writeLocal({ manifestPath, artifactPath }) {
  if (!artifactPath) fail("local evidence requires --artifact");
  const manifest = invocation.loadManifest(manifestPath).manifest;
  const authorization = invocation.reviewAuthorization(manifest);
  const fields = evidenceFields(authorization);
  const record = recordForFields(
    fields,
    signEvidence(fields, signingKeyFromEnvironment()),
  );
  const temporary = `${artifactPath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, artifactPath);
  process.stdout.write(
    `${JSON.stringify({ artifact: artifactPath, head: fields.head, status: "signed-local" })}\n`,
  );
}

function verifyLocal({ manifestPath, artifactPath, requiredTier }) {
  if (!artifactPath) fail("local evidence requires --artifact");
  const manifest = invocation.loadManifest(manifestPath).manifest;
  const authorization = invocation.reviewAuthorization(manifest);
  const expected = evidenceFields(authorization);
  const record = parseJson(
    fs.readFileSync(artifactPath, "utf8"),
    "local quality evidence",
  );
  if (record?.schemaVersion !== CHECK_SCHEMA_VERSION || !record.evidence) {
    fail("local quality evidence schema is invalid");
  }
  const publicKey = process.env.QUALITY_REVIEW_EVIDENCE_PUBLIC_KEY;
  if (!publicKey) fail("QUALITY_REVIEW_EVIDENCE_PUBLIC_KEY is not configured");
  verifyEvidence(record.evidence, record.signature, publicKey);
  if (JSON.stringify(record.evidence) !== JSON.stringify(expected)) {
    fail("local quality evidence does not match the manifest authorization");
  }
  const floor = requiredTier || authorization.tier;
  if (
    TIER_RANK[floor] === undefined ||
    TIER_RANK[record.evidence.tier] < TIER_RANK[floor]
  ) {
    fail("local quality evidence tier is below the required tier");
  }
  process.stdout.write(
    `${JSON.stringify({ artifact: artifactPath, head: expected.head, status: "verified-local" })}\n`,
  );
}

function checkRunBody({
  repository,
  pullRequest,
  head,
  authorization,
  record,
  includeHead,
}) {
  const body = {
    name: CHECK_NAME,
    status: "completed",
    conclusion: "success",
    details_url: `https://github.com/${repository}/pull/${pullRequest}`,
    output: {
      title: "Signed quality evidence",
      summary: `Exact-head ${authorization.tier} review evidence for ${head}`,
      text: JSON.stringify(record),
    },
  };
  if (includeHead) body.head_sha = head;
  return body;
}

function verifyOptions(parsed) {
  return {
    repository: parsed.repository,
    head: parsed.head,
    requiredTier: parsed["required-tier"],
    manifestPath: parsed.manifest,
    baseRef: parsed.base,
  };
}

function recordFromCheckRun(checkRun) {
  const text = checkRun?.output?.text;
  if (typeof text !== "string" || text.length === 0) return null;
  try {
    const record = JSON.parse(text);
    if (record?.schemaVersion !== CHECK_SCHEMA_VERSION) return null;
    if (!record.evidence || typeof record.signature !== "string") return null;
    return record;
  } catch {
    return null;
  }
}

function validateStandaloneEvidence(record, currentBase, repository) {
  if (
    record.evidence.contractVersion < 2 ||
    typeof record.evidence.repositoryKey !== "string"
  ) {
    fail("standalone verification requires repository-bound v2 evidence");
  }
  const expectedRepository = String(repository || "")
    .trim()
    .toLowerCase();
  const evidenceRepository = record.evidence.repositoryKey.trim().toLowerCase();
  if (!expectedRepository || evidenceRepository !== expectedRepository) {
    fail("quality evidence repository is stale or mismatched");
  }
  if (record.evidence.base !== currentBase) {
    fail("quality evidence base is stale");
  }
  if (record.evidence.findings !== 0) {
    fail("quality evidence contains blocking findings");
  }
  // This is the standalone required-check boundary. A manifest-bound merge
  // authorization may preserve incomplete AI discovery as advisory under the
  // ADR, but external branch protection must never treat an unscoped or
  // unsigned incomplete state as a successful review check. The only
  // incomplete evidence accepted here is the separately signed,
  // exact-condition operator-quality-override record.
  const signedOperatorOverride =
    record.evidence.reviewStatus === "incomplete" &&
    record.evidence.reviewer === "operator-quality-override" &&
    record.evidence.override?.scope === "operator-quality-override";
  if (
    !["complete", "policy-exempt"].includes(record.evidence.reviewStatus) &&
    !signedOperatorOverride
  ) {
    fail("standalone verification requires complete review evidence");
  }
}

function validateStandaloneHead(actualHead, expectedHead) {
  const actual = String(actualHead || "")
    .trim()
    .toLowerCase();
  const expected = String(expectedHead || "")
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(actual) || actual !== expected) {
    fail("quality evidence head does not match checked-out HEAD");
  }
}

function newestSuccessfulEvidence(checkRuns) {
  return checkRuns
    .filter(
      (checkRun) =>
        checkRun.name === CHECK_NAME &&
        checkRun.status === "completed" &&
        checkRun.conclusion === "success" &&
        recordFromCheckRun(checkRun),
    )
    .sort((left, right) => {
      const leftTime = Date.parse(left.completed_at || "") || 0;
      const rightTime = Date.parse(right.completed_at || "") || 0;
      return rightTime - leftTime;
    })[0];
}

function publish({ manifestPath }) {
  const manifest = invocation.loadManifest(manifestPath).manifest;
  const authorization = invocation.reviewAuthorization(manifest);
  const repository = manifest.repo.githubRepository;
  const pullRequest = manifest.repo.pr;
  const head = authorization.head;
  if (!repository || !pullRequest) fail("manifest lacks GitHub PR identity");
  const fields = evidenceFields(authorization);
  const signature = signEvidence(fields, signingKeyFromEnvironment());
  const record = recordForFields(fields, signature);
  const existing = newestSuccessfulEvidence(checkRuns(repository, head));
  if (
    existing &&
    JSON.stringify(recordFromCheckRun(existing)) === JSON.stringify(record)
  ) {
    process.stdout.write(
      `${JSON.stringify({
        checkRunId: existing.id,
        repository,
        head,
        status: "already-published",
      })}\n`,
    );
    return;
  }
  const body = checkRunBody({
    repository,
    pullRequest,
    head,
    authorization,
    record,
    includeHead: true,
  });
  const path = `repos/${repository}/check-runs`;
  const method = "POST";
  const response = parseJson(
    runGh(
      [
        "api",
        "--method",
        method,
        "--header",
        "Accept: application/vnd.github+json",
        path,
        "--input",
        "-",
      ],
      JSON.stringify(body),
    ),
    "published quality check response",
  );
  if (response.name !== CHECK_NAME || response.head_sha !== head) {
    fail("published quality check identity does not match reviewed head");
  }
  process.stdout.write(
    `${JSON.stringify({
      checkRunId: response.id,
      repository,
      head,
      status: "published",
    })}\n`,
  );
}

function verify({ repository, head, requiredTier, manifestPath, baseRef }) {
  let expectedAuthorization;
  if (manifestPath) {
    const manifest = invocation.loadManifest(manifestPath).manifest;
    expectedAuthorization = invocation.reviewAuthorization(manifest);
    repository = manifest.repo.githubRepository;
    head = expectedAuthorization.head;
    requiredTier = requiredTier || expectedAuthorization.tier;
  }
  if (!repository || !head) fail("verification requires repository and head");
  if (!manifestPath && !baseRef) {
    fail("standalone verification requires --base");
  }
  if (!requiredTier || TIER_RANK[requiredTier] === undefined) {
    fail("verification requires a valid required tier");
  }
  const checkRun = newestSuccessfulEvidence(checkRuns(repository, head));
  if (!checkRun) fail(`no successful ${CHECK_NAME} check exists for ${head}`);
  const record = recordFromCheckRun(checkRun);
  const publicKey = process.env.QUALITY_REVIEW_EVIDENCE_PUBLIC_KEY;
  if (!publicKey) fail("QUALITY_REVIEW_EVIDENCE_PUBLIC_KEY is not configured");
  verifyEvidence(record.evidence, record.signature, publicKey);
  if (record.evidence.head !== head) fail("quality evidence head is stale");
  if (TIER_RANK[record.evidence.tier] < TIER_RANK[requiredTier]) {
    fail("quality evidence tier is below the required tier");
  }
  if (!manifestPath) {
    const localHead = spawnSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    });
    if (localHead.status !== 0 || !localHead.stdout.trim()) {
      fail("unable to resolve checked-out HEAD");
    }
    validateStandaloneHead(localHead.stdout.trim(), head);
    const mergeBase = spawnSync("git", ["merge-base", head, baseRef], {
      encoding: "utf8",
    });
    if (mergeBase.status !== 0 || !mergeBase.stdout.trim()) {
      fail(`unable to resolve current merge-base against ${baseRef}`);
    }
    validateStandaloneEvidence(record, mergeBase.stdout.trim(), repository);
  }
  if (expectedAuthorization) {
    const expected = evidenceFields(expectedAuthorization);
    if (JSON.stringify(record.evidence) !== JSON.stringify(expected)) {
      fail("quality check evidence does not match the manifest authorization");
    }
  }
  process.stdout.write(
    `${JSON.stringify({
      checkRunId: checkRun.id,
      repository,
      head,
      tier: record.evidence.tier,
      reviewer: record.evidence.reviewer,
      // Incomplete AI discovery is an explicit advisory state under the
      // bounded-review ADR. Deterministic gates, signed exact-head identity,
      // and branch protection remain the merge authority; surface that state
      // instead of making the check look like a clean model verdict.
      status:
        record.evidence.reviewStatus === "incomplete"
          ? "verified-advisory"
          : "verified",
    })}\n`,
  );
}

function options(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail("quality-review-check arguments must be --name value pairs");
    }
    result[key.slice(2)] = value;
  }
  return result;
}

if (require.main === module) {
  try {
    const [command, ...argv] = process.argv.slice(2);
    const parsed = options(argv);
    if (command === "publish") publish({ manifestPath: parsed.manifest });
    else if (command === "write-local") {
      writeLocal({
        manifestPath: parsed.manifest,
        artifactPath: parsed.artifact,
      });
    } else if (command === "verify-local") {
      verifyLocal({
        manifestPath: parsed.manifest,
        artifactPath: parsed.artifact,
        requiredTier: parsed["required-tier"],
      });
    } else if (command === "verify") {
      verify(verifyOptions(parsed));
    } else {
      throw new Error(
        "usage: quality-review-check.js publish --manifest <path> | write-local|verify-local --manifest <path> --artifact <path> | verify --repository <owner/repo> --head <sha> --base <ref> --required-tier <tier>",
      );
    }
  } catch (error) {
    process.stderr.write(`quality-review-check: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  CHECK_NAME,
  CHECK_SCHEMA_VERSION,
  TIER_RANK,
  evidenceFields,
  recordForFields,
  recordFromCheckRun,
  checkRunBody,
  verifyOptions,
  newestSuccessfulEvidence,
  validateStandaloneEvidence,
  validateStandaloneHead,
  writeLocal,
  verifyLocal,
};
