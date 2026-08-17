#!/usr/bin/env node
"use strict";

// Review evidence is transported in a commit trailer, but its trust anchor is
// deliberately external to the reviewed branch: the signing key stays with the
// operator and CI receives only the configured public key.
const crypto = require("crypto");
const fs = require("fs");

const FIELDS = [
  "head",
  "base",
  "tier",
  "findings",
  "reviewer",
  "primary",
  "fallback",
];
const V2_FIELDS = [
  "contractVersion",
  "leads",
  "reviewStatus",
  "policyDigest",
  "agentsSha256",
  "domain",
  "selectionRule",
  "repositoryKey",
  "diffSha256",
  "evidenceSha256",
];
const DISPATCH_FIELDS = [
  "schemaVersion",
  "repository",
  "eventType",
  "head",
  "base",
  "nonce",
  "issuedAt",
  "expiresAt",
];
const TIERS = new Set(["low", "medium", "high", "critical"]);
const REVIEWERS = new Set([
  "claude",
  "codex",
  "gemini",
  "ci-only",
  "policy-exempt",
  "review-incomplete",
]);
const OPERATOR_OVERRIDE_REVIEWER = "operator-quality-override";
const UNAVAILABLE_REVIEWER = "unavailable";

function validateOverrideEvidence(override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    throw new Error("operator override evidence is required");
  }
  if (override.scope !== OPERATOR_OVERRIDE_REVIEWER) {
    throw new Error("operator override evidence scope is invalid");
  }
  for (const field of ["reason", "approver", "issuedAt", "expiresAt"]) {
    if (typeof override[field] !== "string" || override[field].trim() === "") {
      throw new Error(`operator override evidence ${field} is required`);
    }
  }
  if (!Array.isArray(override.acceptedConditions)) {
    throw new Error("operator override evidence conditions are invalid");
  }
  if (
    override.acceptedConditions.length === 0 ||
    override.acceptedConditions.some(
      (condition) => typeof condition !== "string" || condition.trim() === "",
    )
  ) {
    throw new Error("operator override evidence conditions are invalid");
  }
  if (!/^[0-9a-f]{64}$/i.test(String(override.artifactSha256 || ""))) {
    throw new Error("operator override evidence artifact hash is invalid");
  }
  const issuedAt = Date.parse(override.issuedAt);
  const expiresAt = Date.parse(override.expiresAt);
  if (Number.isNaN(issuedAt)) {
    throw new Error("operator override evidence issuedAt is invalid");
  }
  if (Number.isNaN(expiresAt) || expiresAt <= issuedAt) {
    throw new Error("operator override evidence expiresAt is invalid");
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

function assertSha(value, name) {
  if (!/^[0-9a-f]{40}$/i.test(String(value || ""))) {
    throw new Error(`${name} must be an exact 40-character SHA`);
  }
}

function evidencePayload(fields) {
  for (const field of FIELDS) {
    if (!(field in (fields || {})))
      throw new Error(`missing evidence ${field}`);
  }
  assertSha(fields.head, "evidence head");
  assertSha(fields.base, "evidence base");
  if (!TIERS.has(fields.tier)) throw new Error("evidence tier is invalid");
  const isOperatorOverride = fields.reviewer === OPERATOR_OVERRIDE_REVIEWER;
  if (isOperatorOverride) {
    if (
      fields.primary !== UNAVAILABLE_REVIEWER ||
      fields.fallback !== UNAVAILABLE_REVIEWER
    ) {
      throw new Error(
        "operator override evidence must use unavailable primary and fallback reviewers",
      );
    }
    validateOverrideEvidence(fields.override);
  } else if (fields.override !== undefined) {
    throw new Error(
      "operator override evidence is not valid for this reviewer",
    );
  } else {
    if (!REVIEWERS.has(fields.reviewer)) {
      throw new Error("evidence reviewer is invalid");
    }
    if (
      !REVIEWERS.has(fields.primary) ||
      ["ci-only", "policy-exempt", "review-incomplete"].includes(fields.primary)
    ) {
      throw new Error("evidence primary reviewer is invalid");
    }
    const hasFallback = fields.fallback !== "none";
    if (
      hasFallback &&
      (!REVIEWERS.has(fields.fallback) ||
        ["ci-only", "policy-exempt", "review-incomplete"].includes(
          fields.fallback,
        ))
    ) {
      throw new Error("evidence fallback reviewer is invalid");
    }
    if (hasFallback && fields.primary === fields.fallback) {
      throw new Error("evidence fallback reviewer must differ from primary");
    }
    // ci-only is retained for legacy low-risk campaigns whose providers became
    // unavailable. policy-exempt is the v2 contract's explicit low-risk path:
    // no provider was called and no AI verdict is represented.
    if (
      !["ci-only", "policy-exempt", "review-incomplete"].includes(
        fields.reviewer,
      ) &&
      fields.reviewer !== fields.primary &&
      (!hasFallback || fields.reviewer !== fields.fallback)
    ) {
      throw new Error(
        "evidence reviewer must match the declared primary or fallback reviewer",
      );
    }
  }
  if (!Number.isInteger(fields.findings) || fields.findings < 0) {
    throw new Error("evidence findings must be a non-negative integer");
  }
  if (fields.reviewer === "policy-exempt" && fields.tier !== "low") {
    throw new Error("policy exemption evidence is valid only at low tier");
  }
  if (
    fields.reviewer === "review-incomplete" &&
    (Number(fields.contractVersion) !== 2 ||
      fields.reviewStatus !== "incomplete")
  ) {
    throw new Error(
      "review-incomplete evidence requires contract v2 incomplete status",
    );
  }
  const v2 =
    fields.reviewer === "policy-exempt" ||
    V2_FIELDS.some((field) => fields[field] !== undefined);
  if (v2) {
    for (const field of V2_FIELDS) {
      if (!(field in fields)) throw new Error(`missing evidence ${field}`);
    }
    if (Number(fields.contractVersion) !== 2) {
      throw new Error("evidence contractVersion must be 2");
    }
    if (!Number.isInteger(fields.leads) || fields.leads < 0) {
      throw new Error("evidence leads must be a non-negative integer");
    }
    if (
      !["complete", "incomplete", "policy-exempt"].includes(fields.reviewStatus)
    ) {
      throw new Error("evidence reviewStatus is invalid");
    }
    for (const field of [
      "policyDigest",
      "agentsSha256",
      "diffSha256",
      "evidenceSha256",
    ]) {
      if (!/^[0-9a-f]{64}$/i.test(String(fields[field] || ""))) {
        throw new Error(`evidence ${field} must be a SHA-256 digest`);
      }
    }
    for (const field of ["domain", "selectionRule", "repositoryKey"]) {
      if (typeof fields[field] !== "string" || fields[field].trim() === "") {
        throw new Error(`evidence ${field} must be non-empty`);
      }
    }
  }
  return {
    schemaVersion: v2 ? 2 : 1,
    head: fields.head.toLowerCase(),
    base: fields.base.toLowerCase(),
    tier: fields.tier,
    findings: fields.findings,
    reviewer: fields.reviewer,
    primary: fields.primary,
    fallback: fields.fallback,
    ...(v2
      ? {
          contractVersion: 2,
          leads: fields.leads,
          reviewStatus: fields.reviewStatus,
          policyDigest: fields.policyDigest.toLowerCase(),
          agentsSha256: fields.agentsSha256.toLowerCase(),
          domain: fields.domain,
          selectionRule: fields.selectionRule,
          repositoryKey: fields.repositoryKey,
          diffSha256: fields.diffSha256.toLowerCase(),
          evidenceSha256: fields.evidenceSha256.toLowerCase(),
          ...(isOperatorOverride
            ? { override: canonicalJson(fields.override) }
            : {}),
        }
      : {}),
  };
}

function decodeKey(encoded, type) {
  if (typeof encoded !== "string" || !encoded.trim()) {
    throw new Error(`review-evidence ${type} key is required`);
  }
  const key = Buffer.from(encoded, "base64");
  if (!key.length) throw new Error(`review-evidence ${type} key is invalid`);
  return key;
}

function signingKeyFromEnvironment() {
  if (process.env.QUALITY_REVIEW_EVIDENCE_PRIVATE_KEY) {
    return process.env.QUALITY_REVIEW_EVIDENCE_PRIVATE_KEY;
  }
  const file = process.env.QUALITY_REVIEW_EVIDENCE_PRIVATE_KEY_FILE;
  if (!file) {
    throw new Error(
      "review-evidence private key or QUALITY_REVIEW_EVIDENCE_PRIVATE_KEY_FILE is required",
    );
  }
  return fs.readFileSync(file, "utf8").trim();
}

function publicKeyFromPrivate(privateKeyBase64) {
  const privateKey = crypto.createPrivateKey({
    key: decodeKey(privateKeyBase64, "private"),
    format: "der",
    type: "pkcs8",
  });
  return crypto
    .createPublicKey(privateKey)
    .export({ format: "der", type: "spki" })
    .toString("base64");
}

function signEvidence(fields, privateKeyBase64) {
  const payload = evidencePayload(fields);
  const privateKey = crypto.createPrivateKey({
    key: decodeKey(privateKeyBase64, "private"),
    format: "der",
    type: "pkcs8",
  });
  const signature = crypto
    .sign(null, Buffer.from(JSON.stringify(canonicalJson(payload))), privateKey)
    .toString("base64url");
  return Buffer.from(JSON.stringify({ payload, signature })).toString(
    "base64url",
  );
}

function verifyEvidence(fields, encoded, publicKeyBase64) {
  let envelope;
  try {
    envelope = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("review-evidence signature is not valid base64url JSON");
  }
  if (
    !envelope ||
    typeof envelope !== "object" ||
    typeof envelope.signature !== "string"
  ) {
    throw new Error("review-evidence signature envelope is malformed");
  }
  const expected = evidencePayload(fields);
  const payload = evidencePayload(envelope.payload);
  if (
    JSON.stringify(canonicalJson(payload)) !==
    JSON.stringify(canonicalJson(expected))
  ) {
    throw new Error(
      "review-evidence signature does not bind to current trailers",
    );
  }
  const publicKey = crypto.createPublicKey({
    key: decodeKey(publicKeyBase64, "public"),
    format: "der",
    type: "spki",
  });
  if (
    !crypto.verify(
      null,
      Buffer.from(JSON.stringify(canonicalJson(payload))),
      publicKey,
      Buffer.from(envelope.signature, "base64url"),
    )
  ) {
    throw new Error("review-evidence signature is invalid");
  }
  return payload;
}

function dispatchPayload(fields) {
  for (const field of DISPATCH_FIELDS) {
    if (!(field in (fields || {})))
      throw new Error(`missing dispatch authorization ${field}`);
  }
  if (fields.schemaVersion !== 1)
    throw new Error("dispatch authorization schemaVersion is invalid");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fields.repository))
    throw new Error("dispatch authorization repository is invalid");
  if (!["secret-history-scan", "harness-summary"].includes(fields.eventType))
    throw new Error("dispatch authorization eventType is invalid");
  assertSha(fields.head, "dispatch authorization head");
  assertSha(fields.base, "dispatch authorization base");
  if (!/^[0-9a-f]{32}$/.test(fields.nonce))
    throw new Error("dispatch authorization nonce is invalid");
  const issuedAt = Date.parse(fields.issuedAt);
  const expiresAt = Date.parse(fields.expiresAt);
  if (Number.isNaN(issuedAt) || Number.isNaN(expiresAt))
    throw new Error("dispatch authorization timestamps are invalid");
  if (expiresAt <= issuedAt || expiresAt - issuedAt > 15 * 60 * 1000)
    throw new Error("dispatch authorization expiry is invalid");
  return {
    schemaVersion: 1,
    repository: fields.repository,
    eventType: fields.eventType,
    head: fields.head.toLowerCase(),
    base: fields.base.toLowerCase(),
    nonce: fields.nonce,
    issuedAt: new Date(issuedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

function signDispatchAuthorization(fields, privateKeyBase64) {
  const payload = dispatchPayload(fields);
  const privateKey = crypto.createPrivateKey({
    key: decodeKey(privateKeyBase64, "private"),
    format: "der",
    type: "pkcs8",
  });
  const signature = crypto
    .sign(null, Buffer.from(JSON.stringify(canonicalJson(payload))), privateKey)
    .toString("base64url");
  return Buffer.from(JSON.stringify({ payload, signature })).toString(
    "base64url",
  );
}

function verifyDispatchAuthorization(fields, encoded, publicKeyBase64) {
  let envelope;
  try {
    envelope = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("dispatch authorization is not valid base64url JSON");
  }
  const payload = dispatchPayload(envelope.payload);
  if (typeof envelope.signature !== "string" || envelope.signature === "")
    throw new Error("dispatch authorization signature is required");
  const publicKey = crypto.createPublicKey({
    key: decodeKey(publicKeyBase64, "public"),
    format: "der",
    type: "spki",
  });
  if (
    !crypto.verify(
      null,
      Buffer.from(JSON.stringify(canonicalJson(payload))),
      publicKey,
      Buffer.from(envelope.signature, "base64url"),
    )
  )
    throw new Error("dispatch authorization signature is invalid");
  for (const field of ["repository", "eventType", "head", "base", "nonce"]) {
    if (payload[field] !== fields[field])
      throw new Error(`dispatch authorization ${field} does not match input`);
  }
  if (Date.parse(payload.expiresAt) <= Date.now())
    throw new Error("dispatch authorization has expired");
  return payload;
}

module.exports = {
  canonicalJson,
  dispatchPayload,
  evidencePayload,
  signDispatchAuthorization,
  signEvidence,
  verifyDispatchAuthorization,
  verifyEvidence,
  signingKeyFromEnvironment,
  publicKeyFromPrivate,
};

function cliFields(argv) {
  const fields = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("review-evidence arguments must be --name value pairs");
    }
    fields[key.slice(2)] = [
      "--findings",
      "--leads",
      "--schemaVersion",
    ].includes(key)
      ? Number(value)
      : value;
  }
  return fields;
}

if (require.main === module) {
  try {
    const [command, ...argv] = process.argv.slice(2);
    if (command === "public-key") {
      if (argv.length !== 0) throw new Error("public-key accepts no arguments");
      process.stdout.write(
        `${publicKeyFromPrivate(signingKeyFromEnvironment())}\n`,
      );
    } else if (command === "sign") {
      const fields = cliFields(argv);
      process.stdout.write(
        `${signEvidence(fields, signingKeyFromEnvironment())}\n`,
      );
    } else if (command === "sign-dispatch") {
      const fields = cliFields(argv);
      process.stdout.write(
        `${signDispatchAuthorization(fields, signingKeyFromEnvironment())}\n`,
      );
    } else if (command === "verify") {
      const fields = cliFields(argv);
      const signature = fields.signature;
      delete fields.signature;
      verifyEvidence(
        fields,
        signature,
        process.env.QUALITY_REVIEW_EVIDENCE_PUBLIC_KEY,
      );
    } else if (command === "verify-dispatch") {
      const fields = cliFields(argv);
      const signature = fields.signature;
      delete fields.signature;
      verifyDispatchAuthorization(
        fields,
        signature,
        process.env.QUALITY_REVIEW_EVIDENCE_PUBLIC_KEY,
      );
    } else {
      throw new Error(
        "usage: quality-review-evidence.js public-key | sign|verify | sign-dispatch|verify-dispatch ...",
      );
    }
  } catch (error) {
    process.stderr.write(`quality-review-evidence: ${error.message}\n`);
    process.exitCode = 1;
  }
}
