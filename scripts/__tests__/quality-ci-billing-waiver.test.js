import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  classifyBillingWaiver,
  configuredWaiverUntil,
  jobIsPreallocationBillingFailure,
  parseJobId,
} = require(
  path.resolve(import.meta.dirname, "..", "quality-ci-billing-waiver.js"),
);

const repository = "owner/repo";
const head = "a".repeat(40);
const check = {
  name: "test",
  state: "FAILURE",
  link: "https://github.com/owner/repo/actions/runs/12/job/34",
};
const job = {
  status: "completed",
  conclusion: "failure",
  runner_name: "",
  steps: [],
  started_at: "2026-07-20T01:00:00Z",
  completed_at: "2026-07-20T01:00:03Z",
};

function classify(overrides = {}) {
  return classifyBillingWaiver({
    repository,
    expectedHead: head,
    actualHead: head,
    checks: [check],
    jobsById: { 34: job },
    waiverUntil: "2026-08-01T05:00:00Z",
    now: Date.parse("2026-07-20T02:00:00Z"),
    ...overrides,
  });
}

describe("quality CI billing waiver", () => {
  it("accepts only failed Actions jobs that never acquired a runner", () => {
    expect(classify()).toMatchObject({
      category: "github-actions-billing-preallocation",
      repository,
      head,
      failedJobs: [{ check: "test", jobId: "34" }],
    });
    expect(jobIsPreallocationBillingFailure(job)).toBe(true);
    expect(parseJobId(check.link, repository)).toBe("34");
  });

  it.each([
    ["ran a step", { ...job, steps: [{ name: "checkout" }] }],
    ["acquired a runner", { ...job, runner_name: "GitHub Actions 1" }],
    ["ran too long", { ...job, completed_at: "2026-07-20T01:00:31Z" }],
    ["was cancelled", { ...job, conclusion: "cancelled" }],
  ])("rejects a failed job that %s", (_label, changedJob) => {
    expect(() => classify({ jobsById: { 34: changedJob } })).toThrow(
      /billing preallocation signature/,
    );
  });

  it("rejects changed HEAD, pending checks, and expired authority", () => {
    expect(() => classify({ actualHead: "b".repeat(40) })).toThrow(
      /HEAD changed/,
    );
    expect(() =>
      classify({
        checks: [...[check], { name: "pending", state: "IN_PROGRESS" }],
      }),
    ).toThrow(/pending or unknown/);
    expect(() => classify({ waiverUntil: "2026-07-20T01:00:00Z" })).toThrow(
      /absent or expired/,
    );
  });

  it("rejects non-Actions failures and mixed non-waivable results", () => {
    expect(() =>
      classify({
        checks: [
          {
            ...check,
            link: "https://example.com/external/check/34",
          },
        ],
      }),
    ).toThrow(/not a GitHub Actions job/);
    expect(() =>
      classify({
        checks: [...[check], { name: "cancelled", state: "CANCELLED" }],
      }),
    ).toThrow(/non-waivable terminal/);
  });

  it("reads time-bounded authority from the shared provider policy file", () => {
    const home = mkdtempSync(path.join(tmpdir(), "quality-ci-policy-"));
    writeFileSync(
      path.join(home, "providers.json"),
      '{"ciBillingWaiverUntil":"2026-08-01T05:00:00Z"}\n',
    );
    const previous = process.env.BS_QUALITY_PROVIDER_CONFIG;
    process.env.BS_QUALITY_PROVIDER_CONFIG = path.join(home, "providers.json");
    try {
      expect(configuredWaiverUntil()).toBe("2026-08-01T05:00:00Z");
    } finally {
      if (previous === undefined) {
        delete process.env.BS_QUALITY_PROVIDER_CONFIG;
      } else {
        process.env.BS_QUALITY_PROVIDER_CONFIG = previous;
      }
    }
  });
});
