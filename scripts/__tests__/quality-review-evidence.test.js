const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { signEvidence, verifyEvidence } = require("../quality-review-evidence");

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
  it("verifies an exact canonical review tuple", () => {
    const keys = keyPair();
    const signature = signEvidence(fields, keys.privateKey);
    expect(verifyEvidence(fields, signature, keys.publicKey)).toMatchObject(
      fields,
    );
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

  it("rejects a signature whose declared primary reviewer was rewritten", () => {
    const keys = keyPair();
    const signed = { ...fields, primary: "claude", fallback: "ci-only" };
    const signature = signEvidence(signed, keys.privateKey);
    expect(() =>
      verifyEvidence(
        { ...signed, primary: "codex" },
        signature,
        keys.publicKey,
      ),
    ).toThrow(/does not bind/);
  });

  it("rejects a signature whose declared fallback reviewer was rewritten", () => {
    const keys = keyPair();
    const signature = signEvidence(fields, keys.privateKey);
    expect(() =>
      verifyEvidence(
        { ...fields, fallback: "ci-only" },
        signature,
        keys.publicKey,
      ),
    ).toThrow(/does not bind/);
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
