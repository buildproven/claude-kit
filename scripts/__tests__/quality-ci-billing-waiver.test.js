import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "./helpers/tmp.js";

const require = createRequire(import.meta.url);
const {
  classifyBillingWaiver,
  configuredWaiverUntil,
  evidenceDigestValid,
  jobIsPreallocationBillingFailure,
  parseJobId,
  runIsPreallocationBillingActionRequired,
  synthesizePullRequestActionRequiredEvidence,
  synthesizeWorkflowDispatchEvidence,
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
    expect(classify().evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(jobIsPreallocationBillingFailure(job)).toBe(true);
    expect(parseJobId(check.link, repository)).toBe("34");
  });

  it("synthesizes exact-head dispatch checks when GitHub has no PR check context", () => {
    const evidence = synthesizeWorkflowDispatchEvidence(
      repository,
      head,
      [
        {
          id: 12,
          name: "Quality Checks",
          event: "workflow_dispatch",
          head_sha: head,
          status: "completed",
          conclusion: "failure",
        },
        {
          id: 13,
          name: "stale head",
          event: "workflow_dispatch",
          head_sha: "b".repeat(40),
          status: "completed",
          conclusion: "failure",
        },
      ],
      {
        12: [
          {
            ...job,
            id: 34,
            name: "lint-and-format",
          },
        ],
        13: [
          {
            ...job,
            id: 35,
            name: "stale",
          },
        ],
      },
    );
    expect(evidence.checks).toEqual([
      {
        name: "Quality Checks/lint-and-format",
        state: "FAILURE",
        link: "https://github.com/owner/repo/actions/runs/12/job/34",
      },
    ]);
    expect(evidence.jobsById[34]).toMatchObject({
      runner_name: "",
      steps: [],
    });
    expect(evidence.jobsById[35]).toBeUndefined();
  });

  it("synthesizes an exact-head no-job pull-request billing block", () => {
    const run = {
      id: 12,
      name: "Quality Checks",
      workflow_id: 77,
      event: "pull_request",
      head_sha: head,
      status: "completed",
      conclusion: "action_required",
      created_at: "2026-07-20T01:00:00Z",
      updated_at: "2026-07-20T01:00:03Z",
    };
    const evidence = synthesizePullRequestActionRequiredEvidence(
      repository,
      head,
      [run],
      { 12: [] },
      77,
    );
    expect(evidence.checks).toEqual([
      {
        name: "Quality Checks/billing-preallocation",
        state: "ACTION_REQUIRED",
        link: "https://github.com/owner/repo/actions/runs/12",
        runId: 12,
        billingPreallocation: true,
      },
    ]);
    expect(runIsPreallocationBillingActionRequired(run, [])).toBe(true);
    expect(
      classify({
        checks: evidence.checks,
        jobsById: {},
      }).failedRuns,
    ).toEqual([
      {
        check: "Quality Checks/billing-preallocation",
        runId: "12",
      },
    ]);
  });

  it("does not waive unverified action-required checks", () => {
    expect(() =>
      classify({
        checks: [
          {
            name: "unrelated",
            state: "ACTION_REQUIRED",
            link: "https://example.com/check/12",
          },
        ],
        jobsById: {},
      }),
    ).toThrow(/no billing-signature failures/);
  });

  it("can restrict synthesized evidence to the quality workflow identity", () => {
    const evidence = synthesizeWorkflowDispatchEvidence(
      repository,
      head,
      [
        {
          id: 12,
          name: "Quality Checks",
          workflow_id: 77,
          event: "workflow_dispatch",
          head_sha: head,
          status: "completed",
          conclusion: "failure",
        },
        {
          id: 14,
          name: "Unrelated manual workflow",
          workflow_id: 88,
          event: "workflow_dispatch",
          head_sha: head,
          status: "completed",
          conclusion: "failure",
        },
      ],
      {
        12: [{ ...job, id: 34, name: "lint-and-format" }],
        14: [{ ...job, id: 36, name: "lint-and-format" }],
      },
      77,
    );
    expect(evidence.checks).toHaveLength(1);
    expect(evidence.checks[0].link).toContain("/runs/12/job/34");
    expect(evidence.jobsById[36]).toBeUndefined();
  });

  it("rejects evidence tampering that retains the original digest", () => {
    const evidence = classify();
    expect(evidenceDigestValid(evidence)).toBe(true);
    expect(
      evidenceDigestValid({
        ...evidence,
        failedJobs: [{ check: "different", jobId: "34" }],
      }),
    ).toBe(false);
  });

  it("keeps equivalent evidence digests stable when GitHub reorders results", () => {
    const secondCheck = {
      name: "security",
      state: "FAILURE",
      link: "https://github.com/owner/repo/actions/runs/12/job/35",
    };
    const secondJob = {
      ...job,
      started_at: "2026-07-20T01:00:04Z",
      completed_at: "2026-07-20T01:00:07Z",
    };
    const ordered = classify({
      checks: [check, secondCheck],
      jobsById: { 34: job, 35: secondJob },
    });
    const reversed = classify({
      checks: [secondCheck, check],
      jobsById: { 34: job, 35: secondJob },
    });
    expect(reversed.evidenceSha256).toBe(ordered.evidenceSha256);
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
    const home = makeTempDir("quality-ci-policy-");
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
