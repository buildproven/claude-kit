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
const TIERS = new Set(["low", "medium", "high", "critical"]);
const REVIEWERS = new Set(["claude", "codex", "ci-only"]);
const OPERATOR_OVERRIDE_REVIEWER = "operator-quality-override";
const UNAVAILABLE_REVIEWER = "unavailable";

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
  const isOperatorOverride =
    fields.reviewer === OPERATOR_OVERRIDE_REVIEWER;
  if (isOperatorOverride) {
    if (
      fields.primary !== UNAVAILABLE_REVIEWER ||
      fields.fallback !== UNAVAILABLE_REVIEWER
    ) {
      throw new Error(
        "operator override evidence must use unavailable primary and fallback reviewers",
      );
    }
  } else {
    if (!REVIEWERS.has(fields.reviewer)) {
      throw new Error("evidence reviewer is invalid");
    }
    if (!REVIEWERS.has(fields.primary) || fields.primary === "ci-only") {
      throw new Error("evidence primary reviewer is invalid");
    }
    if (!REVIEWERS.has(fields.fallback)) {
      throw new Error("evidence fallback reviewer is invalid");
    }
    if (fields.primary === fields.fallback) {
      throw new Error("evidence fallback reviewer must differ from primary");
    }
  }
  if (!Number.isInteger(fields.findings) || fields.findings < 0) {
    throw new Error("evidence findings must be a non-negative integer");
  }
  return {
    schemaVersion: 1,
    head: fields.head.toLowerCase(),
    base: fields.base.toLowerCase(),
    tier: fields.tier,
    findings: fields.findings,
    reviewer: fields.reviewer,
    primary: fields.primary,
    fallback: fields.fallback,
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

module.exports = {
  canonicalJson,
  evidencePayload,
  signEvidence,
  verifyEvidence,
  signingKeyFromEnvironment,
};

function cliFields(argv) {
  const fields = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("review-evidence arguments must be --name value pairs");
    }
    fields[key.slice(2)] = key === "--findings" ? Number(value) : value;
  }
  return fields;
}

if (require.main === module) {
  try {
    const [command, ...argv] = process.argv.slice(2);
    const fields = cliFields(argv);
    if (command === "sign") {
      process.stdout.write(
        `${signEvidence(fields, signingKeyFromEnvironment())}\n`,
      );
    } else if (command === "verify") {
      const signature = fields.signature;
      delete fields.signature;
      verifyEvidence(
        fields,
        signature,
        process.env.QUALITY_REVIEW_EVIDENCE_PUBLIC_KEY,
      );
    } else {
      throw new Error(
        "usage: quality-review-evidence.js sign|verify --head <sha> --base <sha> --tier <tier> --findings <count> --reviewer <name> --primary <name> --fallback <name> [--signature <value>]",
      );
    }
  } catch (error) {
    process.stderr.write(`quality-review-evidence: ${error.message}\n`);
    process.exitCode = 1;
  }
}
