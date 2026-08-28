import { createRequire } from "node:module";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { classifyProtectedNonstrict } = require(
  path.resolve(import.meta.dirname, "..", "quality-protected-nonstrict.js"),
);
const { normalizeProtectedBranch } = require(
  path.resolve(import.meta.dirname, "..", "quality-protected-nonstrict.js"),
);
const classifierPath = path.resolve(
  import.meta.dirname,
  "..",
  "quality-protected-nonstrict.js",
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

  it("rejects a required check owned by a non-Actions GitHub App", () => {
    const input = fixture();
    input.protection.required_status_checks.checks[0].app_id = 99999;
    expect(() => classifyProtectedNonstrict(input)).toThrow(/GitHub Actions/);
  });

  it("uses a typed policy exit for a valid but ineligible protection", () => {
    const bin = mkdtempSync(path.join(tmpdir(), "protected-nonstrict-gh-"));
    const gh = path.join(bin, "gh");
    const input = fixture();
    input.protection.required_pull_request_reviews = {
      url: "https://api.github.test/reviews",
      dismiss_stale_reviews: true,
      require_code_owner_reviews: false,
      require_last_push_approval: false,
      required_approving_review_count: 1,
    };
    writeFileSync(
      gh,
      `#!/usr/bin/env bash
if [[ "$*" == *"/protection"* ]]; then
  printf '%s\\n' '${JSON.stringify(input.protection)}'
elif [[ "$*" == *"/rules/branches/"* ]]; then
  printf '%s\\n' '${JSON.stringify(input.effectiveRules)}'
elif [ "$2" = graphql ]; then
  printf '%s\\n' '${JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: input.reviewThreads } } } })}'
else
  printf '%s\\n' '${JSON.stringify({ permissions: { admin: input.repositoryAdmin } })}'
fi
`,
    );
    chmodSync(gh, 0o755);
    const result = spawnSync(
      "node",
      [
        classifierPath,
        "inspect",
        "--repo",
        "owner/repo",
        "--branch",
        "main",
        "--pr",
        "1",
      ],
      {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(3);
    expect(result.stderr).toMatch(/review protection is not inert/);
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

  it("accepts either explicit linear-history boolean", () => {
    const input = fixture();
    input.protection.required_linear_history.enabled = false;
    expect(classifyProtectedNonstrict(input).eligible).toBe(true);
  });

  it("normalizes supported protected branch prefixes once", () => {
    expect(normalizeProtectedBranch("origin/release/2026")).toBe(
      "release/2026",
    );
    expect(normalizeProtectedBranch("refs/heads/release/2026")).toBe(
      "release/2026",
    );
  });
});
