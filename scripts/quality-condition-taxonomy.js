#!/usr/bin/env node
"use strict";

// Stable, enumerated terminal-condition IDs derived from the exact diagnosis
// data quality-terminal-status.js already inspects (gate evidence, provider
// review status, judge findings, mutation evidence). This module never
// invents new diagnosis logic — it only assigns a stable identifier to each
// condition an operator override can be asked to accept, so a signed
// approval can bind to "exactly these N diagnosed conditions" instead of an
// all-or-nothing accept.
//
// IDs are intentionally namespaced and stable across releases:
//   gate:<name>            deterministic gate (lint/test/security/build/
//                          type/consumer) missing, stale, or failed evidence
//   mutation:missing       required high/critical mutation evidence missing
//   review:<reason>        provider review coverage unresolved (exhaustion,
//                          malformed output, unavailable, timeout, governor
//                          exhaustion, runner error, billing failure, or no
//                          coverage at all)
//   review:finding:<id>    a specific BLOCKING judge finding, by its
//                          persisted finding id
//   ci:missing             manifest has a PR but no CI evidence has been
//                          recorded as part of this diagnosis call
//   ci:failed              required GitHub CI failed on the current stamp
//   ci:pending             required GitHub CI has not completed
//   ci:stale               CI evidence does not match the current PR HEAD
//
// HIGH_RISK_CONDITIONS marks the subset that requires the caller to pass a
// stronger, per-category acknowledgement flag in addition to --accept (see
// quality-wrapper.js). This satisfies the requirement that security
// findings, test failures, missing CI, and unresolved code findings cannot
// be waved through by the same casual flag as a flaky lint gate.

function gateConditions(manifest) {
  const current = manifest.gates.filter(
    (gate) => gate.head === manifest.revisions.currentHead,
  );
  const conditions = [];
  for (const required of manifest.requiredGates || []) {
    const gate = current.find((item) => item.name === required.name);
    const skippedWithReason =
      gate?.status === "skipped" &&
      typeof gate.reason === "string" &&
      gate.reason.trim() !== "";
    const passing = gate?.status === "success" || skippedWithReason;
    if (!passing) {
      conditions.push({
        id: `gate:${required.name}`,
        description: `required '${required.name}' gate evidence is missing, stale, or failed`,
        highRisk: required.name === "security" || required.name === "test",
      });
    }
  }
  return conditions;
}

function mutationCondition(manifest) {
  if (!["high", "critical"].includes(manifest.risk?.tier)) return [];
  const mutation = manifest.mutation;
  const valid =
    mutation &&
    mutation.head === manifest.revisions.currentHead &&
    fs_existsSync(mutation.artifactPath);
  return valid
    ? []
    : [
        {
          id: "mutation:missing",
          description:
            "required high/critical mutation evidence is missing or stale",
          highRisk: true,
        },
      ];
}

// Lazily required so this module has no hard dependency on `fs` semantics
// beyond existsSync, keeping it easy to unit test with a plain manifest
// fixture that never touches disk for the common (no mutation artifact) case.
function fs_existsSync(candidate) {
  if (!candidate) return false;
  return require("fs").existsSync(candidate);
}

const REVIEW_REASON_DESCRIPTIONS = {
  "no-coverage": "no provider review coverage exists for the current HEAD",
  "provider-exhaustion": "provider attempt/window exhaustion blocked review",
  "parser-inconclusive": "provider review output was malformed or inconclusive",
  "provider-unavailable": "provider CLI or authentication was unavailable",
  "provider-timeout": "provider review exceeded its bounded time budget",
  "provider-governor": "provider attempt cap or campaign deadline exhausted",
  "provider-error": "provider review runner failed",
  "provider-billing": "provider billing or credits failure blocked review",
};

function reviewCondition(manifest, reviewFailureReason) {
  if (!reviewFailureReason) return [];
  const description =
    REVIEW_REASON_DESCRIPTIONS[reviewFailureReason] ||
    `provider review is unresolved (${reviewFailureReason})`;
  return [
    {
      id: `review:${reviewFailureReason}`,
      description,
      highRisk: false,
    },
  ];
}

function findingConditions(manifest) {
  const judge = manifest.judge;
  if (!judge || judge.head !== manifest.revisions.currentHead) return [];
  if (!judge.artifactPath || !fs_existsSync(judge.artifactPath)) return [];
  let artifact;
  try {
    artifact = JSON.parse(
      require("fs").readFileSync(judge.artifactPath, "utf8"),
    );
  } catch {
    return [];
  }
  return (artifact.findings || [])
    .filter((finding) => finding.disposition === "BLOCKING")
    .map((finding) => ({
      id: `review:finding:${finding.id}`,
      description: `unresolved BLOCKING finding ${finding.id}${
        finding.title ? `: ${finding.title}` : ""
      }`,
      highRisk: true,
    }));
}

const CI_REASON_DESCRIPTIONS = {
  missing: "no CI evidence has been recorded for the current stamp",
  failed: "required GitHub CI failed",
  pending: "required GitHub CI has not completed",
  stale: "CI evidence does not match the current PR HEAD",
};

function ciCondition(manifest, ciFailureReason) {
  if (!ciFailureReason) return [];
  const description =
    CI_REASON_DESCRIPTIONS[ciFailureReason] ||
    `GitHub CI is unresolved (${ciFailureReason})`;
  return [
    {
      id: `ci:${ciFailureReason}`,
      description,
      highRisk: true,
    },
  ];
}

// Enumerate every terminal condition currently diagnosed against `manifest`.
// `failure` mirrors quality-terminal-status.js's shape: { reviewFailureReason,
// ciFailureReason } are optional hints from the caller's own diagnosis (this
// function never re-derives provider/CI status itself — quality-run-review.sh
// and quality-stamp-and-merge.sh already classify those from structured
// evidence, and duplicating that classification here would risk drifting out
// of sync with the authoritative classifier).
function diagnoseConditions(manifest, failure = {}) {
  return [
    ...gateConditions(manifest),
    ...mutationCondition(manifest),
    ...reviewCondition(manifest, failure.reviewFailureReason),
    ...findingConditions(manifest),
    ...ciCondition(manifest, failure.ciFailureReason),
  ];
}

function highRiskIds(conditions) {
  return conditions.filter((condition) => condition.highRisk).map((c) => c.id);
}

function parseAcceptList(raw) {
  if (!raw) return [];
  const ids = String(raw)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) {
    throw new Error("--accept must not repeat a condition id");
  }
  return unique;
}

// Validate that `acceptedIds` covers every currently diagnosed condition
// (satisfies "the system surfaces all failed conditions and requires the
// operator to name each accepted condition explicitly" — an incomplete or
// stale accept-list is rejected, never silently widened or narrowed).
function assertAcceptListComplete(conditions, acceptedIds) {
  const diagnosedIds = conditions.map((condition) => condition.id);
  const missing = diagnosedIds.filter((id) => !acceptedIds.includes(id));
  const unknown = acceptedIds.filter((id) => !diagnosedIds.includes(id));
  if (missing.length > 0) {
    throw new Error(
      `override --accept is missing diagnosed condition(s): ${missing.join(", ")}`,
    );
  }
  if (unknown.length > 0) {
    throw new Error(
      `override --accept names condition(s) not currently diagnosed: ${unknown.join(", ")}`,
    );
  }
}

module.exports = {
  diagnoseConditions,
  highRiskIds,
  parseAcceptList,
  assertAcceptListComplete,
};
