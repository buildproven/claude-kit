#!/usr/bin/env node
"use strict";

const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");

function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`, {
      cause: error,
    });
  }
}

function parseRequest(raw) {
  const request = parseJson(raw, "request");
  if (
    !request ||
    !Array.isArray(request.argv) ||
    request.argv.some((value) => typeof value !== "string")
  ) {
    throw new Error("request must contain a string argv array");
  }
  return request.argv;
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

function approvalRequested() {
  return process.env.BREAK_GLASS_APPROVED === "true";
}

function childEnvironment(challengeSha256, publicKey) {
  const environment = { ...process.env };
  delete environment.BREAK_GLASS_APPROVED;
  delete environment.BREAK_GLASS_APPROVER;
  delete environment.BS_QUALITY_APPROVAL_TTL_SECONDS;
  delete environment.BS_QUALITY_APPROVAL_PUBLIC_KEY;
  if (challengeSha256) {
    environment.BS_QUALITY_APPROVAL_CHALLENGE_SHA256 = challengeSha256;
    environment.BS_QUALITY_APPROVAL_PUBLIC_KEY = publicKey;
  } else {
    delete environment.BS_QUALITY_APPROVAL_CHALLENGE_SHA256;
  }
  return environment;
}

function issueApprovalCapability(
  manifestPath,
  invocationScript,
  challenge,
  privateKey,
) {
  const manifest = parseJson(
    fs.readFileSync(manifestPath, "utf8"),
    "quality manifest",
  );
  const ttl = Number(process.env.BS_QUALITY_APPROVAL_TTL_SECONDS || "3600");
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 86400) {
    throw new Error(
      "approval TTL must be an integer between 1 and 86400 seconds",
    );
  }
  const issuedAt = new Date();
  const payload = {
    schemaVersion: 1,
    repoKey: manifest.repo.key,
    pr: manifest.repo.pr,
    head: manifest.revisions.currentHead,
    invocationId: manifest.invocationId,
    approver: process.env.BREAK_GLASS_APPROVER || process.env.USER || "unknown",
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + ttl * 1000).toISOString(),
    nonce: crypto.randomUUID(),
    challenge,
  };
  const artifact = {
    schemaVersion: 1,
    payload,
    signature: crypto
      .sign(
        null,
        Buffer.from(JSON.stringify(canonicalJson(payload))),
        privateKey,
      )
      .toString("base64"),
  };
  const directory = path.join(manifest.stateRoot, "approval");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const artifactPath = path.join(
    directory,
    `${manifest.revisions.currentHead}-${payload.nonce}.json`,
  );
  fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  const attached = spawnSync(
    process.execPath,
    [
      invocationScript,
      "approval-attach",
      manifestPath,
      "--artifact",
      artifactPath,
    ],
    { encoding: "utf8", env: childEnvironment() },
  );
  if (attached.status !== 0) {
    throw new Error(attached.stderr || "approval capability attachment failed");
  }
}

function main() {
  const bootstrap = process.argv[2];
  if (!bootstrap) throw new Error("bootstrap path is required");
  const argv = parseRequest(fs.readFileSync(0, "utf8"));
  const wantsApproval = approvalRequested();
  const challenge = wantsApproval
    ? crypto.randomBytes(32).toString("hex")
    : null;
  const keyPair = wantsApproval ? crypto.generateKeyPairSync("ed25519") : null;
  const publicKey = keyPair
    ? keyPair.publicKey
        .export({ type: "spki", format: "der" })
        .toString("base64")
    : null;
  const challengeSha256 = challenge
    ? crypto.createHash("sha256").update(challenge).digest("hex")
    : null;
  const result = spawnSync("bash", [bootstrap, ...argv], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: childEnvironment(challengeSha256, publicKey),
  });
  if (result.status === 0 && wantsApproval) {
    const manifestPath = (result.stdout || "")
      .split("\n")
      .find((line) => line.startsWith("BS_QUALITY_MANIFEST="))
      ?.slice("BS_QUALITY_MANIFEST=".length);
    if (!manifestPath)
      throw new Error("bootstrap did not return a manifest path");
    issueApprovalCapability(
      manifestPath,
      path.join(path.dirname(bootstrap), "quality-invocation.js"),
      challenge,
      keyPair.privateKey,
    );
  }
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  process.exit(result.status ?? 1);
}

module.exports = { parseRequest };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`quality-wrapper: ${error.message}\n`);
    process.exit(1);
  }
}
