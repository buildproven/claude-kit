#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const WAIVABLE_STATE = "FAILURE";
const TERMINAL_STATES = new Set([
  "SUCCESS",
  "FAILURE",
  "SKIPPED",
  "CANCELLED",
  "NEUTRAL",
]);

function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
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

function canonicalEvidence(value) {
  const normalized = { ...value };
  for (const field of ["failedJobs", "successfulOrSkippedChecks"]) {
    if (Array.isArray(normalized[field])) {
      normalized[field] = [...normalized[field]].sort((left, right) =>
        JSON.stringify(canonicalJson(left)).localeCompare(
          JSON.stringify(canonicalJson(right)),
        ),
      );
    }
  }
  return canonicalJson(normalized);
}

function evidenceSha256(evidence) {
  const unsignedEvidence = { ...evidence };
  delete unsignedEvidence.evidenceSha256;
  return require("node:crypto")
    .createHash("sha256")
    .update(JSON.stringify(canonicalEvidence(unsignedEvidence)))
    .digest("hex");
}

function evidenceDigestValid(evidence) {
  return (
    /^[a-f0-9]{64}$/.test(evidence?.evidenceSha256 || "") &&
    evidenceSha256(evidence) === evidence.evidenceSha256
  );
}

function parseJobId(link, repository) {
  const escaped = repository.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(link || "").match(
    new RegExp(
      `^https://github\\.com/${escaped}/actions/runs/\\d+/job/(\\d+)$`,
    ),
  );
  return match?.[1] || null;
}

function jobIsPreallocationBillingFailure(job) {
  const started = Date.parse(job?.started_at);
  const completed = Date.parse(job?.completed_at);
  return (
    job?.status === "completed" &&
    job?.conclusion === "failure" &&
    job?.runner_name === "" &&
    Array.isArray(job?.steps) &&
    job.steps.length === 0 &&
    Number.isFinite(started) &&
    Number.isFinite(completed) &&
    completed >= started &&
    completed - started <= 30_000
  );
}

function synthesizeWorkflowDispatchEvidence(
  repository,
  expectedHead,
  runs,
  jobsByRunId,
) {
  const checks = []
  const jobsById = {}
  for (const run of Array.isArray(runs) ? runs : []) {
    if (
      run?.head_sha !== expectedHead ||
      run?.event !== "workflow_dispatch" ||
      run?.status !== "completed" ||
      run?.conclusion !== "failure"
    )
      continue
    const jobs = jobsByRunId?.[String(run.id)]
    if (!Array.isArray(jobs) || jobs.length === 0) continue
    for (const job of jobs) {
      if (!job || !Number.isInteger(job.id)) continue
      jobsById[job.id] = job
      checks.push({
        name: `${run.name || run.workflow_id || "workflow"}/${job.name || job.id}`,
        state:
          job.status === "completed"
            ? String(job.conclusion || "").toUpperCase()
            : "IN_PROGRESS",
        link: `https://github.com/${repository}/actions/runs/${run.id}/job/${job.id}`,
      })
    }
  }
  return { checks, jobsById }
}

function configuredWaiverUntil() {
  if (process.env.BS_QUALITY_CI_BILLING_WAIVER_UNTIL) {
    return process.env.BS_QUALITY_CI_BILLING_WAIVER_UNTIL;
  }
  const config =
    process.env.BS_QUALITY_PROVIDER_CONFIG ||
    process.env.BS_PROVIDER_CONFIG ||
    path.join(
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
      "buildproven",
      "agent-providers.json",
    );
  try {
    return parseJson(fs.readFileSync(config, "utf8"), "CI billing authority")
      .ciBillingWaiverUntil;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`cannot read CI billing authority: ${error.message}`, {
      cause: error,
    });
  }
}

function classifyBillingWaiver({
  repository,
  expectedHead,
  actualHead,
  checks,
  jobsById,
  waiverUntil,
  now = Date.now(),
}) {
  const expiry = Date.parse(waiverUntil || "");
  if (!Number.isFinite(expiry) || now >= expiry) {
    throw new Error("CI billing waiver is absent or expired");
  }
  if (actualHead !== expectedHead) {
    throw new Error("PR HEAD changed before CI billing classification");
  }
  if (!Array.isArray(checks) || checks.length === 0) {
    throw new Error("no CI checks are available to classify");
  }
  const nonterminal = checks.filter(
    (check) => !TERMINAL_STATES.has(check.state),
  );
  if (nonterminal.length > 0) {
    throw new Error("CI still has pending or unknown checks");
  }
  const failures = checks.filter((check) => check.state === WAIVABLE_STATE);
  if (failures.length === 0) {
    throw new Error("CI has no billing-signature failures to waive");
  }
  const nonwaivableTerminal = checks.filter((check) =>
    ["CANCELLED"].includes(check.state),
  );
  if (nonwaivableTerminal.length > 0) {
    throw new Error("CI contains non-waivable terminal results");
  }
  const waivedJobs = failures.map((check) => {
    const jobId = parseJobId(check.link, repository);
    if (!jobId) {
      throw new Error(
        `failed check '${check.name}' is not a GitHub Actions job`,
      );
    }
    const job = jobsById[jobId];
    if (!jobIsPreallocationBillingFailure(job)) {
      throw new Error(
        `failed check '${check.name}' ran steps or lacks the billing preallocation signature`,
      );
    }
    return {
      check: check.name,
      jobId,
      startedAt: job.started_at,
      completedAt: job.completed_at,
    };
  });
  // Keep the waiver digest stable across the two validations performed by a
  // merge: classify once, then revalidate the exact same live job evidence.
  // Wall-clock `classifiedAt` made an otherwise unchanged billing diagnosis
  // produce a different signed digest on every invocation.
  const classifiedAt = waivedJobs
    .map((job) => Date.parse(job.completedAt))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0];
  const evidence = {
    schemaVersion: 1,
    category: "github-actions-billing-preallocation",
    repository,
    head: expectedHead,
    waiverUntil: new Date(expiry).toISOString(),
    classifiedAt: new Date(classifiedAt || now).toISOString(),
    failedJobs: waivedJobs,
    successfulOrSkippedChecks: checks
      .filter((check) => check.state !== WAIVABLE_STATE)
      .map((check) => ({ name: check.name, state: check.state })),
  };
  return {
    ...evidence,
    evidenceSha256: evidenceSha256(evidence),
  };
}

function runGh(args, { allowFailure = false } = {}) {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  if (!allowFailure && (result.status !== 0 || !result.stdout.trim())) {
    throw new Error(
      result.stderr.trim() || `gh ${args.slice(0, 2).join(" ")} failed`,
    );
  }
  return result.stdout;
}

function listWorkflowDispatchRuns(repository, expectedHead) {
  const runs = [];
  for (let page = 1; page <= 100; page += 1) {
    const response = parseJson(
      runGh([
        "api",
        `repos/${repository}/actions/runs?head_sha=${expectedHead}&event=workflow_dispatch&per_page=100&page=${page}`,
      ]),
      "GitHub workflow dispatch runs response",
    );
    if (!Array.isArray(response.workflow_runs)) {
      throw new Error("GitHub workflow dispatch runs response is invalid");
    }
    runs.push(...response.workflow_runs);
    if (response.workflow_runs.length < 100) return runs;
  }
  throw new Error("GitHub workflow dispatch runs pagination exceeded 100 pages");
}

function listRunJobs(repository, runId) {
  const jobs = [];
  for (let page = 1; page <= 100; page += 1) {
    const response = parseJson(
      runGh([
        "api",
        `repos/${repository}/actions/runs/${runId}/jobs?per_page=100&page=${page}`,
      ]),
      `GitHub Actions run ${runId} jobs response`,
    );
    if (!Array.isArray(response.jobs)) {
      throw new Error(`GitHub Actions run ${runId} jobs response is invalid`);
    }
    jobs.push(...response.jobs);
    if (response.jobs.length < 100) return jobs;
  }
  throw new Error(`GitHub Actions run ${runId} jobs pagination exceeded 100 pages`);
}

function loadWorkflowDispatchEvidence(repository, expectedHead) {
  const runs = listWorkflowDispatchRuns(repository, expectedHead);
  const jobsByRunId = {};
  for (const run of runs) {
    if (
      run?.head_sha === expectedHead &&
      run?.event === "workflow_dispatch" &&
      run?.status === "completed" &&
      run?.conclusion === "failure"
    ) {
      jobsByRunId[String(run.id)] = listRunJobs(repository, run.id);
    }
  }
  return synthesizeWorkflowDispatchEvidence(
    repository,
    expectedHead,
    runs,
    jobsByRunId,
  );
}

function loadLiveEvidence(repository, pr, expectedHead) {
  const actualHead = runGh([
    "pr",
    "view",
    pr,
    "--repo",
    repository,
    "--json",
    "headRefOid",
    "--jq",
    ".headRefOid",
  ]).trim();
  let checks = parseJson(
    runGh(
      ["pr", "checks", pr, "--repo", repository, "--json", "name,state,link"],
      { allowFailure: true },
    ) || "[]",
    "GitHub check response",
  );
  const jobsById = {};
  for (const check of checks.filter(
    (candidate) => candidate.state === WAIVABLE_STATE,
  )) {
    const jobId = parseJobId(check.link, repository);
    if (!jobId) continue;
    jobsById[jobId] = parseJson(
      runGh(["api", `repos/${repository}/actions/jobs/${jobId}`]),
      `GitHub Actions job ${jobId}`,
    );
  }
  if (checks.length === 0) {
    const dispatchEvidence = loadWorkflowDispatchEvidence(
      repository,
      expectedHead,
    );
    checks = dispatchEvidence.checks;
    Object.assign(jobsById, dispatchEvidence.jobsById);
  }
  return { actualHead, checks, jobsById, expectedHead, repository };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error(
        "usage: quality-ci-billing-waiver.js --repo OWNER/REPO --pr N --head SHA --artifact FILE",
      );
    }
    options[name.slice(2)] = value;
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  for (const required of ["repo", "pr", "head", "artifact"]) {
    if (!options[required]) throw new Error(`--${required} is required`);
  }
  const waiverUntil = configuredWaiverUntil();
  const evidence = loadLiveEvidence(options.repo, options.pr, options.head);
  const artifact = classifyBillingWaiver({
    ...evidence,
    waiverUntil,
  });
  const temporary = `${options.artifact}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(artifact, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  fs.renameSync(temporary, options.artifact);
  fs.chmodSync(options.artifact, 0o600);
  process.stdout.write(`${options.artifact}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`quality CI billing waiver: ${error.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  classifyBillingWaiver,
  configuredWaiverUntil,
  evidenceDigestValid,
  evidenceSha256,
  jobIsPreallocationBillingFailure,
  synthesizeWorkflowDispatchEvidence,
  parseJobId,
};
