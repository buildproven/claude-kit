const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  assertDispatchNonceAvailable,
  dispatchExternalId,
  publicKeyFromPrivate,
  signDispatchAuthorization,
  signEvidence,
  verifyDispatchAuthorization,
  verifyEvidence,
} = require("../quality-review-evidence");

const STAMP_AND_MERGE = fs.readFileSync(
  path.join(__dirname, "..", "quality-stamp-and-merge.sh"),
  "utf8",
);

const fields = {
  head: "a".repeat(40),
  base: "b".repeat(40),
  tier: "critical",
  findings: 0,
  reviewer: "codex",
  primary: "codex",
  fallback: "claude",
};

function keyPair() {
  const pair = crypto.generateKeyPairSync("ed25519");
  return {
    privateKey: pair.privateKey
      .export({ type: "pkcs8", format: "der" })
      .toString("base64"),
    publicKey: pair.publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64"),
  };
}

describe("quality review evidence signatures", () => {
  it("verifies a dispatch authorization bound to repository and event", () => {
    const keys = keyPair();
    const authorization = signDispatchAuthorization(
      {
        schemaVersion: 1,
        repository: "owner/repo",
        eventType: "harness-summary",
        head: "a".repeat(40),
        base: "b".repeat(40),
        nonce: "c".repeat(32),
        issuedAt: "2027-01-01T00:00:00.000Z",
        expiresAt: "2027-01-01T00:10:00.000Z",
      },
      keys.privateKey,
    );
    expect(
      verifyDispatchAuthorization(
        {
          repository: "owner/repo",
          eventType: "harness-summary",
          head: "a".repeat(40),
          base: "b".repeat(40),
          nonce: "c".repeat(32),
        },
        authorization,
        keys.publicKey,
      ),
    ).toMatchObject({ repository: "owner/repo", eventType: "harness-summary" });
  });

  it("rejects a dispatch authorization replayed for another event", () => {
    const keys = keyPair();
    const authorization = signDispatchAuthorization(
      {
        schemaVersion: 1,
        repository: "owner/repo",
        eventType: "harness-summary",
        head: "a".repeat(40),
        base: "b".repeat(40),
        nonce: "c".repeat(32),
        issuedAt: "2027-01-01T00:00:00.000Z",
        expiresAt: "2027-01-01T00:10:00.000Z",
      },
      keys.privateKey,
    );
    expect(() =>
      verifyDispatchAuthorization(
        {
          repository: "owner/repo",
          eventType: "secret-history-scan",
          head: "a".repeat(40),
          base: "b".repeat(40),
          nonce: "c".repeat(32),
        },
        authorization,
        keys.publicKey,
      ),
    ).toThrow(/eventType does not match/);
  });

  it("derives and claims one durable external ID per dispatch nonce", () => {
    const dispatch = {
      schemaVersion: 1,
      repository: "owner/repo",
      eventType: "harness-summary",
      head: "a".repeat(40),
      base: "b".repeat(40),
      nonce: "c".repeat(32),
      issuedAt: "2027-01-01T00:00:00.000Z",
      expiresAt: "2027-01-01T00:10:00.000Z",
    };
    const externalId = dispatchExternalId(dispatch);
    expect(externalId).toBe(
      `harness-summary:${dispatch.head}:${dispatch.base}:${dispatch.nonce}`,
    );
    expect(assertDispatchNonceAvailable(dispatch, [])).toBe(externalId);
    expect(() => assertDispatchNonceAvailable(dispatch, [externalId])).toThrow(
      /already been claimed/,
    );
  });

  it("verifies an exact canonical review tuple", () => {
    const keys = keyPair();
    const signature = signEvidence(fields, keys.privateKey);
    expect(verifyEvidence(fields, signature, keys.publicKey)).toMatchObject(
      fields,
    );
  });

  it("derives the verifier key from an operator signing key", () => {
    const keys = keyPair();
    expect(publicKeyFromPrivate(keys.privateKey)).toBe(keys.publicKey);
  });

  it("rejects a signature replayed for a different reviewed head", () => {
    const keys = keyPair();
    const signature = signEvidence(fields, keys.privateKey);
    expect(() =>
      verifyEvidence(
        { ...fields, head: "c".repeat(40) },
        signature,
        keys.publicKey,
      ),
    ).toThrow(/does not bind/);
  });

  it("rejects a signature whose declared reviewer was rewritten", () => {
    const keys = keyPair();
    const signed = {
      ...fields,
      reviewer: "ci-only",
      primary: "codex",
      fallback: "claude",
    };
    const signature = signEvidence(signed, keys.privateKey);
    expect(() =>
      verifyEvidence(
        { ...signed, reviewer: "codex" },
        signature,
        keys.publicKey,
      ),
    ).toThrow(/does not bind/);
  });

  it("rejects ci-only as a fallback reviewer", () => {
    expect(() =>
      signEvidence({ ...fields, fallback: "ci-only" }, keyPair().privateKey),
    ).toThrow(/fallback reviewer is invalid/);
  });

  it("signs an explicit policy exemption without claiming an AI reviewer", () => {
    const exempt = {
      ...fields,
      tier: "low",
      reviewer: "policy-exempt",
      contractVersion: 2,
      leads: 0,
      reviewStatus: "policy-exempt",
      policyDigest: "c".repeat(64),
      agentsSha256: "d".repeat(64),
      domain: "policy-exempt",
      selectionRule: "low-no-ai",
      repositoryKey: "repository-key",
      diffSha256: "e".repeat(64),
      evidenceSha256: "f".repeat(64),
    };
    const keys = keyPair();
    const signature = signEvidence(exempt, keys.privateKey);
    expect(verifyEvidence(exempt, signature, keys.publicKey)).toMatchObject(
      exempt,
    );
  });

  it("binds operator override scope and approval details into signed evidence", () => {
    const override = {
      ...fields,
      reviewer: "operator-quality-override",
      primary: "unavailable",
      fallback: "unavailable",
      contractVersion: 2,
      leads: 0,
      reviewStatus: "incomplete",
      policyDigest: "c".repeat(64),
      agentsSha256: "d".repeat(64),
      domain: "operator-override",
      selectionRule: "operator-override",
      repositoryKey: "repository-key",
      diffSha256: "e".repeat(64),
      evidenceSha256: "f".repeat(64),
      override: {
        scope: "operator-quality-override",
        reason: "accepted bounded gate failure",
        acceptedConditions: ["gate:test"],
        approver: "brett",
        issuedAt: "2026-08-11T12:00:00.000Z",
        expiresAt: "2026-08-11T12:15:00.000Z",
        artifactSha256: "1".repeat(64),
      },
    };
    const keys = keyPair();
    const signature = signEvidence(override, keys.privateKey);
    expect(verifyEvidence(override, signature, keys.publicKey)).toMatchObject(
      override,
    );
    expect(() =>
      signEvidence({ ...override, override: undefined }, keys.privateKey),
    ).toThrow(/operator override evidence is required/);
  });

  it("rejects policy-exempt as a configured fallback reviewer", () => {
    expect(() =>
      signEvidence(
        { ...fields, fallback: "policy-exempt" },
        keyPair().privateKey,
      ),
    ).toThrow(/fallback reviewer is invalid/);
  });

  it("signs an explicit incomplete discovery attestation", () => {
    const incomplete = {
      ...fields,
      reviewer: "review-incomplete",
      contractVersion: 2,
      leads: 0,
      reviewStatus: "incomplete",
      policyDigest: "c".repeat(64),
      agentsSha256: "d".repeat(64),
      domain: "security",
      selectionRule: "security-domain",
      repositoryKey: "repository-key",
      diffSha256: "e".repeat(64),
      evidenceSha256: "f".repeat(64),
    };
    const keys = keyPair();
    const signature = signEvidence(incomplete, keys.privateKey);
    expect(verifyEvidence(incomplete, signature, keys.publicKey)).toMatchObject(
      incomplete,
    );
  });

  it("signs a primary-only policy with no fallback", () => {
    const keys = keyPair();
    // Gemini is a supported configured provider.  Keep this paired with the
    // no-fallback form so a signed Gemini review can traverse the setup CI
    // evidence verifier without an impossible fallback identity.
    const primaryOnly = {
      ...fields,
      reviewer: "gemini",
      primary: "gemini",
      fallback: "none",
    };
    const signature = signEvidence(primaryOnly, keys.privateKey);
    expect(() =>
      verifyEvidence(primaryOnly, signature, keys.publicKey),
    ).not.toThrow();
  });

  it("rejects identical primary and fallback reviewers", () => {
    expect(() =>
      signEvidence({ ...fields, fallback: "codex" }, keyPair().privateKey),
    ).toThrow(/fallback reviewer must differ/);
  });

  it("signs the distinct sanctioned operator-override tuple", () => {
    const keys = keyPair();
    const override = {
      ...fields,
      reviewer: "operator-quality-override",
      primary: "unavailable",
      fallback: "unavailable",
      contractVersion: 2,
      leads: 0,
      reviewStatus: "incomplete",
      policyDigest: "c".repeat(64),
      agentsSha256: "d".repeat(64),
      domain: "operator-override",
      selectionRule: "operator-override",
      repositoryKey: "repository-key",
      diffSha256: "e".repeat(64),
      evidenceSha256: "f".repeat(64),
      override: {
        scope: "operator-quality-override",
        reason: "accepted bounded gate failure",
        acceptedConditions: ["gate:test"],
        approver: "brett",
        issuedAt: "2026-08-11T12:00:00.000Z",
        expiresAt: "2026-08-11T12:15:00.000Z",
        artifactSha256: "1".repeat(64),
      },
    };
    const signature = signEvidence(override, keys.privateKey);
    expect(verifyEvidence(override, signature, keys.publicKey)).toMatchObject(
      override,
    );
  });

  it("rejects a mixed operator-override reviewer tuple", () => {
    expect(() =>
      signEvidence(
        { ...fields, reviewer: "operator-quality-override" },
        keyPair().privateKey,
      ),
    ).toThrow(/must use unavailable/);
  });

  it("rejects a signature from an untrusted key", () => {
    const signature = signEvidence(fields, keyPair().privateKey);
    expect(() =>
      verifyEvidence(fields, signature, keyPair().publicKey),
    ).toThrow(/signature is invalid/);
  });

  it("requests a signature for either supported operator key source", () => {
    expect(STAMP_AND_MERGE).toMatch(
      /QUALITY_REVIEW_EVIDENCE_PRIVATE_KEY:-.*QUALITY_REVIEW_EVIDENCE_PRIVATE_KEY_FILE:-/s,
    );
  });
});
