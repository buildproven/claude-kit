const crypto = require("crypto");
const { signEvidence, verifyEvidence } = require("../quality-review-evidence");

const fields = {
  head: "a".repeat(40),
  base: "b".repeat(40),
  tier: "critical",
  findings: 0,
  reviewer: "codex",
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

  it("rejects a signature from an untrusted key", () => {
    const signature = signEvidence(fields, keyPair().privateKey);
    expect(() =>
      verifyEvidence(fields, signature, keyPair().publicKey),
    ).toThrow(/signature is invalid/);
  });
});
