const crypto = require("node:crypto");
const {
  CHECK_NAME,
  checkRunBody,
  evidenceFields,
  newestSuccessfulEvidence,
  recordForFields,
  recordFromCheckRun,
  validateStandaloneEvidence,
  verifyOptions,
} = require("../quality-review-check");
const { signEvidence, verifyEvidence } = require("../quality-review-evidence");

function keyPair() {
  const pair = crypto.generateKeyPairSync("ed25519");
  return {
    privateKey: pair.privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64"),
    publicKey: pair.publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64"),
  };
}

const authorization = {
  head: "a".repeat(40),
  base: "b".repeat(40),
  tier: "high",
  blockingCount: 0,
  provider: "codex",
  primary: "codex",
  fallback: "claude",
};

describe("quality-review-check", () => {
  it("round-trips signed evidence through a completed check run", () => {
    const fields = evidenceFields(authorization);
    const keys = keyPair();
    const record = recordForFields(
      fields,
      signEvidence(fields, keys.privateKey),
    );
    const checkRun = {
      id: 42,
      name: CHECK_NAME,
      status: "completed",
      conclusion: "success",
      completed_at: "2026-08-11T12:00:00Z",
      output: { text: JSON.stringify(record) },
    };

    expect(recordFromCheckRun(checkRun)).toEqual(record);
    expect(
      verifyEvidence(record.evidence, record.signature, keys.publicKey),
    ).toMatchObject(fields);
  });

  it("selects the newest valid successful evidence and ignores stale or malformed runs", () => {
    const fields = evidenceFields(authorization);
    const keys = keyPair();
    const record = recordForFields(
      fields,
      signEvidence(fields, keys.privateKey),
    );
    const valid = (id, completedAt) => ({
      id,
      name: CHECK_NAME,
      status: "completed",
      conclusion: "success",
      completed_at: completedAt,
      output: { text: JSON.stringify(record) },
    });

    expect(
      newestSuccessfulEvidence([
        valid(1, "2026-08-11T11:00:00Z"),
        { ...valid(2, "2026-08-11T13:00:00Z"), output: { text: "{}" } },
        {
          ...valid(3, "2026-08-11T12:00:00Z"),
          conclusion: "failure",
        },
        valid(4, "2026-08-11T13:00:00Z"),
        {
          ...valid(5, "2026-08-11T14:00:00Z"),
          name: "unrelated-check",
        },
      ]),
    ).toMatchObject({ id: 4 });
  });

  it("includes the complete v2 authorization tuple when present", () => {
    const fields = evidenceFields({
      ...authorization,
      contractVersion: 2,
      leads: 1,
      reviewStatus: "complete",
      policyDigest: "c".repeat(64),
      agentsSha256: "d".repeat(64),
      domain: "reliability",
      selectionRule: "reliability-domain",
      repositoryKey: "buildproven/claude-kit",
      diffSha256: "e".repeat(64),
      evidenceSha256: "f".repeat(64),
    });

    expect(fields).toMatchObject({
      contractVersion: 2,
      leads: 1,
      reviewStatus: "complete",
      repositoryKey: "buildproven/claude-kit",
    });
  });

  it("rejects stale or incomplete standalone evidence", () => {
    const fields = evidenceFields({
      ...authorization,
      contractVersion: 2,
      leads: 0,
      reviewStatus: "complete",
      policyDigest: "c".repeat(64),
      agentsSha256: "d".repeat(64),
      domain: "reliability",
      selectionRule: "reliability-domain",
      repositoryKey: "buildproven/claude-kit",
      diffSha256: "e".repeat(64),
      evidenceSha256: "f".repeat(64),
    });
    const record = recordForFields(fields, "signature");

    expect(() =>
      validateStandaloneEvidence(
        record,
        "a".repeat(40),
        "buildproven/claude-kit",
      ),
    ).toThrow(/base is stale/);
    expect(() =>
      validateStandaloneEvidence(record, fields.base, "BuildProven/Claude-Kit"),
    ).not.toThrow();
    expect(() =>
      validateStandaloneEvidence(
        {
          ...record,
          evidence: { ...record.evidence, reviewStatus: "incomplete" },
        },
        fields.base,
        "buildproven/claude-kit",
      ),
    ).toThrow(/complete review evidence/);
  });

  it("binds standalone v2 evidence to the requested repository", () => {
    const fields = evidenceFields({
      ...authorization,
      contractVersion: 2,
      leads: 0,
      reviewStatus: "complete",
      policyDigest: "c".repeat(64),
      agentsSha256: "d".repeat(64),
      domain: "reliability",
      selectionRule: "reliability-domain",
      repositoryKey: "buildproven/claude-kit",
      diffSha256: "e".repeat(64),
      evidenceSha256: "f".repeat(64),
    });
    const record = recordForFields(fields, "signature");

    expect(() =>
      validateStandaloneEvidence(record, fields.base, "other/repository"),
    ).toThrow(/repository is stale or mismatched/);
  });

  it("rejects unbound v1 evidence in standalone verification", () => {
    const record = recordForFields(evidenceFields(authorization), "signature");

    expect(() =>
      validateStandaloneEvidence(
        record,
        record.evidence.base,
        "buildproven/claude-kit",
      ),
    ).toThrow(/repository-bound v2 evidence/);
  });

  it("omits create-only head_sha when updating an existing check run", () => {
    const record = recordForFields(evidenceFields(authorization), "signature");
    const common = {
      repository: "buildproven/claude-kit",
      pullRequest: 313,
      head: authorization.head,
      authorization,
      record,
    };

    expect(checkRunBody({ ...common, includeHead: true }).head_sha).toBe(
      authorization.head,
    );
    expect(checkRunBody({ ...common, includeHead: false })).not.toHaveProperty(
      "head_sha",
    );
  });

  it("maps hyphenated verifier CLI options to verify parameters", () => {
    expect(
      verifyOptions({
        repository: "buildproven/claude-kit",
        head: "a".repeat(40),
        "required-tier": "critical",
        base: "origin/main",
      }),
    ).toEqual({
      repository: "buildproven/claude-kit",
      head: "a".repeat(40),
      requiredTier: "critical",
      manifestPath: undefined,
      baseRef: "origin/main",
    });
  });
});
