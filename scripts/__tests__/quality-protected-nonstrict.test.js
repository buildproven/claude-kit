import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { classifyProtectedNonstrict } = require(
  path.resolve(import.meta.dirname, "..", "quality-protected-nonstrict.js"),
);

function fixture(overrides = {}) {
  return {
    protection: {
      url: "https://api.github.test/protection",
      required_status_checks: {
        url: "https://api.github.test/checks",
        strict: false,
        contexts: ["quality"],
        contexts_url: "https://api.github.test/contexts",
        checks: [{ context: "quality", app_id: 15368 }],
      },
      required_signatures: {
        url: "https://api.github.test/signatures",
        enabled: false,
      },
      enforce_admins: {
        url: "https://api.github.test/admins",
        enabled: false,
      },
      required_linear_history: { enabled: true },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
      block_creations: { enabled: false },
      required_conversation_resolution: { enabled: true },
      lock_branch: { enabled: false },
      allow_fork_syncing: { enabled: false },
    },
    effectiveRules: [],
    reviewThreads: {
      pageInfo: { hasNextPage: false },
      nodes: [{ isResolved: true }],
    },
    repositoryAdmin: true,
    ...overrides,
  };
}

describe("protected non-strict outage classifier", () => {
  it("accepts the exact safe classic shape and returns bound checks", () => {
    const result = classifyProtectedNonstrict(fixture());
    expect(result.eligible).toBe(true);
    expect(result.requiredChecks).toEqual([
      { context: "quality", appId: 15368 },
    ]);
    expect(result.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    [
      "strict status checks",
      (value) => (value.protection.required_status_checks.strict = true),
    ],
    [
      "administrator enforcement",
      (value) => (value.protection.enforce_admins.enabled = true),
    ],
    [
      "signatures",
      (value) => (value.protection.required_signatures.enabled = true),
    ],
    [
      "force pushes",
      (value) => (value.protection.allow_force_pushes.enabled = true),
    ],
    [
      "rulesets",
      (value) => value.effectiveRules.push({ type: "required_status_checks" }),
    ],
    [
      "unresolved conversations",
      (value) => (value.reviewThreads.nodes[0].isResolved = false),
    ],
    [
      "paginated conversations",
      (value) => (value.reviewThreads.pageInfo.hasNextPage = true),
    ],
    ["non-admin actor", (value) => (value.repositoryAdmin = false)],
    [
      "unknown protection field",
      (value) => (value.protection.future_rule = { enabled: false }),
    ],
  ])("rejects %s", (_label, mutate) => {
    const input = fixture();
    mutate(input);
    expect(() => classifyProtectedNonstrict(input)).toThrow();
  });

  it("rejects a required conversation rule without complete thread evidence", () => {
    const input = fixture();
    input.reviewThreads = null;
    expect(() => classifyProtectedNonstrict(input)).toThrow(/conversation/i);
  });

  it("accepts an inert zero-approval review object", () => {
    const input = fixture();
    input.protection.required_pull_request_reviews = {
      url: "https://api.github.test/reviews",
      dismiss_stale_reviews: true,
      require_code_owner_reviews: false,
      require_last_push_approval: false,
      required_approving_review_count: 0,
    };
    expect(classifyProtectedNonstrict(input).eligible).toBe(true);
  });
});
