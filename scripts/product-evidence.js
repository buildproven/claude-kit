#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const RECEIPT_KINDS = new Set([
  "behavioralTests",
  "acceptanceEvidence",
  "deploymentReceipt",
  "hostedJourney",
  "realUserEvidence",
]);

const TRUST_ROOTS = Object.freeze({
  darwin: "/Library/Application Support/claude-kit/product-evidence-public-key",
  linux: "/etc/claude-kit/product-evidence-public-key",
  win32: "C:\\ProgramData\\claude-kit\\product-evidence-public-key",
});

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    expected
      .slice()
      .sort()
      .every((key, index) => key === actual[index])
  );
}

function assertValidUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
        throw new Error("signed payload contains invalid Unicode");
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error("signed payload contains invalid Unicode");
    }
  }
}

function canonicalJson(value) {
  if (typeof value === "string") assertValidUnicode(value);
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => {
        assertValidUnicode(key);
        return `${JSON.stringify(key)}:${canonicalJson(value[key])}`;
      })
      .join(",")}}`;
  }
  throw new Error("signed payload contains a non-JSON value");
}

function containedRealFile(root, relativePath, label) {
  if (!nonEmptyString(relativePath) || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be a relative path`);
  }
  const realRoot = fs.realpathSync(root);
  const candidate = path.resolve(realRoot, relativePath);
  if (!candidate.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error(`${label} must stay inside the evidence directory`);
  }
  let cursor = realRoot;
  for (const part of path.relative(realRoot, candidate).split(path.sep)) {
    cursor = path.join(cursor, part);
    if (fs.lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`${label} must not use symbolic links`);
    }
  }
  const resolved = fs.realpathSync(candidate);
  if (!resolved.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error(`${label} must stay inside the evidence directory`);
  }
  if (!fs.statSync(resolved).isFile()) {
    throw new Error(`${label} must name a file`);
  }
  return resolved;
}

function decodeBase64(value, label, url = false) {
  if (!nonEmptyString(value)) throw new Error(`${label} is not valid base64`);
  if (url && value.includes("=")) {
    throw new Error(`${label} must be unpadded base64url`);
  }
  const bytes = Buffer.from(value, url ? "base64url" : "base64");
  const encoded = bytes.toString(url ? "base64url" : "base64");
  const unpadded = (input) => {
    let end = input.length;
    while (end > 0 && input[end - 1] === "=") end -= 1;
    return input.slice(0, end);
  };
  if ((url ? encoded : unpadded(encoded)) !== unpadded(value)) {
    throw new Error(`${label} is not canonical base64`);
  }
  return bytes;
}

function trustKey(trustedPublicKey) {
  if (trustedPublicKey) return trustedPublicKey;
  const trustRoot = TRUST_ROOTS[process.platform];
  if (!trustRoot) {
    throw new Error(`product evidence is unsupported on ${process.platform}`);
  }
  let encoded;
  try {
    encoded = fs.readFileSync(trustRoot, "utf8").trim();
  } catch (error) {
    throw new Error(
      `product evidence trust root cannot be read: ${error.message}`,
      {
        cause: error,
      },
    );
  }
  const der = decodeBase64(encoded, "product evidence trust root");
  const key = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("product evidence trust root is not an Ed25519 public key");
  }
  return key;
}

function payloadKeys(kind, expected) {
  const keys = [
    "schemaVersion",
    "issuer",
    "repository",
    "repositoryId",
    "head",
    "requirementsDigest",
    "kind",
    "observedAt",
    "evidenceSource",
    "result",
    "environment",
    "provenance",
    "artifact",
  ];
  if (kind === "behavioralTests") keys.push("command");
  if (
    ["deploymentReceipt", "hostedJourney", "realUserEvidence"].includes(kind) ||
    expected.deploymentIdentity
  ) {
    keys.push("deploymentIdentity");
  }
  if (kind === "hostedJourney") keys.push("url");
  return keys;
}

function validateCommonPayload(payload, expected) {
  if (
    payload.schemaVersion !== 2 ||
    payload.kind !== expected.kind ||
    payload.repository !== expected.repository ||
    payload.repositoryId !== expected.repositoryId ||
    payload.head !== expected.head ||
    payload.requirementsDigest !== expected.requirementsDigest
  ) {
    throw new Error(
      `${expected.kind} receipt has the wrong schema, kind, repository identity, head, or requirements`,
    );
  }
  if (
    !/^[0-9a-f]{40}$/.test(payload.head || "") ||
    !/^[0-9a-f]{64}$/.test(payload.requirementsDigest || "") ||
    !/^[^/]+\/[^/]+$/.test(payload.repository || "") ||
    !/^[1-9][0-9]*$/.test(payload.repositoryId || "")
  ) {
    throw new Error(`${expected.kind} receipt has malformed identity fields`);
  }
  validateObservation(payload, expected);
}

function validateObservation(payload, expected) {
  if (!nonEmptyString(payload.issuer)) {
    throw new Error(`${expected.kind} receipt is missing issuer`);
  }
  if (
    !nonEmptyString(payload.evidenceSource) ||
    !nonEmptyString(payload.environment) ||
    payload.result !== "passed" ||
    !nonEmptyString(payload.observedAt) ||
    Number.isNaN(Date.parse(payload.observedAt))
  ) {
    throw new Error(
      `${expected.kind} receipt has invalid time, source, environment, or result`,
    );
  }
}

function validateProvenance(payload, expected) {
  if (
    !exactKeys(payload.provenance, [
      "executionOwner",
      "runId",
      "runnerIsolation",
    ]) ||
    payload.provenance.executionOwner !== "issuer" ||
    payload.provenance.runnerIsolation !== "fresh-protected" ||
    !nonEmptyString(payload.provenance.runId)
  ) {
    throw new Error(`${expected.kind} receipt has invalid trusted provenance`);
  }
}

function validateExpectedBindings(payload, expected) {
  if (expected.environment && payload.environment !== expected.environment) {
    throw new Error(`${expected.kind} receipt has the wrong environment`);
  }
  if (
    expected.deploymentIdentity &&
    payload.deploymentIdentity !== expected.deploymentIdentity
  ) {
    throw new Error(
      `${expected.kind} receipt has the wrong deployment identity`,
    );
  }
}

function validateKindFields(payload, expected) {
  if (expected.kind === "behavioralTests" && !nonEmptyString(payload.command)) {
    throw new Error("behavioralTests receipt is missing command");
  }
  if (
    ["deploymentReceipt", "hostedJourney", "realUserEvidence"].includes(
      expected.kind,
    ) &&
    !nonEmptyString(payload.deploymentIdentity)
  ) {
    throw new Error(`${expected.kind} receipt is missing deploymentIdentity`);
  }
  if (expected.kind === "hostedJourney") {
    try {
      const url = new URL(payload.url);
      if (url.protocol !== "https:") throw new Error("not HTTPS");
    } catch {
      throw new Error("hostedJourney receipt needs an HTTPS URL");
    }
  }
}

function validateArtifact(payload, expected) {
  if (
    !exactKeys(payload.artifact, ["path", "sha256"]) ||
    !nonEmptyString(payload.artifact.path) ||
    !/^[a-f0-9]{64}$/.test(payload.artifact.sha256 || "")
  ) {
    throw new Error(`${expected.kind} receipt has an invalid artifact binding`);
  }
}

function validatePayload(payload, expected) {
  if (!RECEIPT_KINDS.has(expected.kind)) {
    throw new Error(`unsupported product evidence kind '${expected.kind}'`);
  }
  if (!exactKeys(payload, payloadKeys(expected.kind, expected))) {
    throw new Error(
      `${expected.kind} receipt has unexpected or missing fields`,
    );
  }
  validateCommonPayload(payload, expected);
  validateExpectedBindings(payload, expected);
  validateKindFields(payload, expected);
  validateProvenance(payload, expected);
  validateArtifact(payload, expected);
}

function verifyReceipt(
  reference,
  expected,
  { evidencePath, trustedPublicKey } = {},
) {
  if (
    !exactKeys(reference, ["receipt", "sha256"]) ||
    !nonEmptyString(reference.receipt) ||
    !/^[a-f0-9]{64}$/.test(reference.sha256 || "")
  ) {
    throw new Error(`${expected.kind} needs receipt and sha256`);
  }
  const evidenceRoot = path.dirname(path.resolve(evidencePath || ""));
  const receipt = containedRealFile(
    evidenceRoot,
    reference.receipt,
    `${expected.kind} receipt`,
  );
  const body = fs.readFileSync(receipt);
  if (sha256(body) !== reference.sha256) {
    throw new Error(`${expected.kind} receipt digest does not match`);
  }
  let envelope;
  try {
    envelope = JSON.parse(body.toString("utf8"));
  } catch (error) {
    throw new Error(
      `${expected.kind} receipt is not valid JSON: ${error.message}`,
      {
        cause: error,
      },
    );
  }
  if (!exactKeys(envelope, ["payload", "signature"])) {
    throw new Error(`${expected.kind} receipt envelope has unexpected fields`);
  }
  if (!nonEmptyString(envelope.signature)) {
    throw new Error(`${expected.kind} receipt is unsigned`);
  }
  validatePayload(envelope.payload, expected);
  const signature = decodeBase64(
    envelope.signature,
    `${expected.kind} receipt signature`,
    true,
  );
  if (
    !crypto.verify(
      null,
      Buffer.from(canonicalJson(envelope.payload)),
      trustKey(trustedPublicKey),
      signature,
    )
  ) {
    throw new Error(`${expected.kind} receipt signature is invalid`);
  }
  const artifact = containedRealFile(
    evidenceRoot,
    envelope.payload.artifact.path,
    `${expected.kind} artifact`,
  );
  if (sha256(fs.readFileSync(artifact)) !== envelope.payload.artifact.sha256) {
    throw new Error(`${expected.kind} artifact digest does not match`);
  }
  return envelope.payload;
}

module.exports = {
  canonicalJson,
  sha256,
  verifyReceipt,
};
