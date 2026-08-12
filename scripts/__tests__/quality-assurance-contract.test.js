const { validateEnvelope } = require("../quality-assurance-contract");

const sha = "a".repeat(40);
const digest = "b".repeat(64);
const envelope = {
  schemaVersion: 1,
  requirements: { sha256: digest, source: "docs/prd.md" },
  revision: {
    repository: "example/repo",
    baseSha: sha,
    headSha: sha,
    candidateKind: "branch-head",
  },
  risk: { tier: "low", score: 12 },
  gates: [
    {
      name: "test",
      status: "success",
      headSha: sha,
      source: "local",
      sha256: digest,
      completedAt: "2026-08-12T12:00:00Z",
    },
  ],
  reviews: [],
  terminal: { result: "passed", at: "2026-08-12T12:01:00Z", reason: null },
};

describe("quality assurance envelope", () => {
  it("accepts the small provider-neutral contract", () => {
    expect(validateEnvelope(envelope)).toMatchObject({
      valid: true,
      errors: [],
    });
  });

  it("rejects a stale or malformed revision identity", () => {
    const invalid = structuredClone(envelope);
    invalid.revision.headSha = "short";
    expect(validateEnvelope(invalid).valid).toBe(false);
  });

  it("rejects unversioned extra fields", () => {
    expect(validateEnvelope({ ...envelope, internalLease: {} }).valid).toBe(
      false,
    );
  });
});
