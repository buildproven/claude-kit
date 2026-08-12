#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

function ghJson(args, execute = execFileSync) {
  return parseJson(
    execute("gh", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }),
    `gh ${args.join(" ")} response`,
  );
}

function selectEvidence(checks, expected) {
  const matches = checks.filter(
    (check) =>
      check.name === expected.check &&
      check.head_sha === expected.headSha &&
      check.status === "completed" &&
      check.conclusion === "success" &&
      check.app?.slug === "github-actions" &&
      typeof check.details_url === "string" &&
      check.details_url.startsWith(
        `https://github.com/${expected.repository}/actions/runs/`,
      ),
  );
  if (matches.length !== 1)
    throw new Error(
      `expected exactly one trusted successful '${expected.check}' check for ${expected.headSha}`,
    );
  const check = matches[0];
  return {
    schemaVersion: 1,
    repository: expected.repository,
    workflow: expected.workflow,
    check: check.name,
    headSha: check.head_sha,
    baseSha: expected.baseSha,
    candidateKind: expected.candidateKind,
    conclusion: check.conclusion,
    completedAt: check.completed_at,
    sourceUrl: check.details_url,
    sourceApp: check.app.slug,
  };
}

function bindWorkflowRun(evidence, run, expected) {
  const workflowPath = String(run.path || "").split("@")[0];
  const expectedPath = expected.workflow.includes("/")
    ? expected.workflow
    : `.github/workflows/${expected.workflow}`;
  if (
    run.head_sha !== expected.headSha ||
    run.status !== "completed" ||
    run.conclusion !== "success" ||
    workflowPath !== expectedPath
  )
    throw new Error("workflow run identity does not match exact CI evidence");
  if (expected.candidateKind === "merge-group" && run.event !== "merge_group")
    throw new Error("merge-group evidence requires a merge_group workflow run");
  if (expected.candidateKind !== "merge-group" && run.event === "merge_group")
    throw new Error("branch/lease evidence cannot reuse a merge_group run");
  return {
    ...evidence,
    sourceWorkflowPath: workflowPath,
    sourceEvent: run.event,
  };
}

function fetchEvidence(expected, execute = execFileSync) {
  if (
    !/^[0-9a-f]{40}$/.test(expected.headSha) ||
    !/^[0-9a-f]{40}$/.test(expected.baseSha)
  )
    throw new Error(
      "CI evidence requires exact 40-character base and head SHAs",
    );
  if (
    !["branch-head", "merge-group", "lease-head"].includes(
      expected.candidateKind,
    )
  )
    throw new Error("CI evidence candidate kind is invalid");
  const response = ghJson(
    [
      "api",
      `repos/${expected.repository}/commits/${expected.headSha}/check-runs`,
      "--paginate",
      "--slurp",
    ],
    execute,
  );
  const checks = Array.isArray(response)
    ? response.flatMap((page) => page.check_runs || [])
    : response.check_runs || [];
  const evidence = selectEvidence(checks, expected);
  const runId = evidence.sourceUrl.match(/\/actions\/runs\/(\d+)/)?.[1];
  if (!runId) throw new Error("trusted check URL has no Actions run identity");
  const run = ghJson(
    ["api", `repos/${expected.repository}/actions/runs/${runId}`],
    execute,
  );
  return bindWorkflowRun(evidence, run, expected);
}

function matchesExpected(evidence, expected) {
  if (evidence?.schemaVersion !== 1) return false;
  if (evidence.repository !== expected.repository) return false;
  if (evidence.workflow !== expected.workflow) return false;
  if (evidence.check !== expected.check) return false;
  if (evidence.headSha !== expected.headSha) return false;
  if (evidence.baseSha !== expected.baseSha) return false;
  if (evidence.candidateKind !== expected.candidateKind) return false;
  if (evidence.conclusion !== "success") return false;
  if (evidence.sourceApp !== "github-actions") return false;
  const workflowPath = expected.workflow.includes("/")
    ? expected.workflow
    : `.github/workflows/${expected.workflow}`;
  if (evidence.sourceWorkflowPath !== workflowPath) return false;
  if (
    (expected.candidateKind === "merge-group") !==
    (evidence.sourceEvent === "merge_group")
  )
    return false;
  if (typeof evidence.sourceUrl !== "string") return false;
  return evidence.sourceUrl.startsWith(
    `https://github.com/${expected.repository}/actions/runs/`,
  );
}

function resolveEvidence(expected, output, execute = execFileSync) {
  if (fs.existsSync(output)) {
    const cached = parseJson(
      fs.readFileSync(output, "utf8"),
      "cached CI evidence",
    );
    if (matchesExpected(cached, expected))
      return { evidence: cached, reused: true };
  }
  return { evidence: fetchEvidence(expected, execute), reused: false };
}

if (require.main === module) {
  const [repository, workflow, check, baseSha, headSha, candidateKind, output] =
    process.argv.slice(2);
  if (
    ![
      repository,
      workflow,
      check,
      baseSha,
      headSha,
      candidateKind,
      output,
    ].every(Boolean)
  ) {
    console.error(
      "usage: quality-ci-evidence.js <repo> <workflow> <check> <base-sha> <head-sha> <branch-head|merge-group|lease-head> <output.json>",
    );
    process.exitCode = 2;
  } else {
    try {
      const resolved = resolveEvidence(
        { repository, workflow, check, baseSha, headSha, candidateKind },
        output,
      );
      fs.writeFileSync(
        output,
        `${JSON.stringify(resolved.evidence, null, 2)}\n`,
        { mode: 0o600 },
      );
      console.error(
        `quality-ci-evidence: ${resolved.reused ? "reused" : "fetched"} exact-head evidence`,
      );
    } catch (error) {
      console.error(`quality-ci-evidence: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

module.exports = {
  fetchEvidence,
  bindWorkflowRun,
  matchesExpected,
  resolveEvidence,
  selectEvidence,
};
