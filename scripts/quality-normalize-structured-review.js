#!/usr/bin/env node
"use strict";

const FINDING_KEYS = [
  "body",
  "failure_scenario",
  "file",
  "line_start",
  "proof",
  "recommendation",
  "severity",
  "title",
];
const REVIEW_KEYS = ["findings", "summary", "verdict"];
const SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const VERDICTS = new Set(["approve", "needs-attention"]);
const PROOF_KINDS = new Set([
  "reproduction",
  "regression-test",
  "static-analysis",
]);

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function parseResponse(value) {
  let text = value.trim();
  if (text.startsWith("```")) {
    const firstNewline = text.indexOf("\n");
    if (firstNewline < 0 || !text.endsWith("```")) {
      throw new Error("structured review has an incomplete JSON fence");
    }
    const language = text.slice(3, firstNewline).trim();
    if (language && language !== "json") {
      throw new Error("structured review fence must be JSON");
    }
    text = text.slice(firstNewline + 1, -3).trim();
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error("structured review response is not valid JSON", {
      cause: error,
    });
  }
}

function unwrapReview(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("structured review envelope must be an object");
  }
  if (value.result && typeof value.result === "object") return value.result;
  if (typeof value.response === "string") return parseResponse(value.response);
  return value;
}

function validateFinding(finding) {
  if (
    !finding ||
    typeof finding !== "object" ||
    Array.isArray(finding) ||
    !exactKeys(finding, FINDING_KEYS) ||
    !SEVERITIES.has(finding.severity) ||
    typeof finding.title !== "string" ||
    typeof finding.body !== "string" ||
    typeof finding.failure_scenario !== "string" ||
    typeof finding.file !== "string" ||
    !Number.isInteger(finding.line_start) ||
    finding.line_start < 1 ||
    typeof finding.recommendation !== "string" ||
    !finding.proof ||
    typeof finding.proof !== "object" ||
    Array.isArray(finding.proof) ||
    !exactKeys(finding.proof, ["evidence", "kind"]) ||
    !PROOF_KINDS.has(finding.proof.kind) ||
    typeof finding.proof.evidence !== "string" ||
    finding.proof.evidence.trim() === ""
  ) {
    throw new Error("structured review contains an invalid finding");
  }
}

function normalizeStructuredReview(value) {
  const review = unwrapReview(value);
  if (
    !review ||
    typeof review !== "object" ||
    Array.isArray(review) ||
    !exactKeys(review, REVIEW_KEYS) ||
    !VERDICTS.has(review.verdict) ||
    typeof review.summary !== "string" ||
    review.summary.length < 1 ||
    !Array.isArray(review.findings)
  ) {
    throw new Error("structured review does not match the review schema");
  }
  review.findings.forEach(validateFinding);
  if (review.verdict === "approve" && review.findings.length !== 0) {
    throw new Error("an approval cannot contain actionable findings");
  }
  if (review.verdict === "needs-attention" && review.findings.length === 0) {
    throw new Error("needs-attention requires at least one finding");
  }
  return review;
}

module.exports = { normalizeStructuredReview, parseResponse };
