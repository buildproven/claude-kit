const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  bindWorkflowRun,
  fetchEvidence,
  matchesExpected,
  resolveEvidence,
  selectEvidence,
} = require("../quality-ci-evidence");

const sha = "a".repeat(40);
const base = "b".repeat(40);
const expected = {
  repository: "acme/repo",
  workflow: "quality.yml",
  check: "complete-tests",
  headSha: sha,
  baseSha: base,
  candidateKind: "merge-group",
};
const check = {
  name: "complete-tests",
  head_sha: sha,
  status: "completed",
  conclusion: "success",
  completed_at: "2026-08-12T12:00:00Z",
  details_url: "https://github.com/acme/repo/actions/runs/1/job/2",
  app: { slug: "github-actions" },
};

describe("trusted CI evidence", () => {
  it("accepts one exact GitHub Actions check", () => {
    expect(selectEvidence([check], expected)).toMatchObject({
      repository: "acme/repo",
      headSha: sha,
      baseSha: base,
      candidateKind: "merge-group",
      conclusion: "success",
    });
  });

  it("binds the check to the expected workflow run and event", () => {
    const evidence = bindWorkflowRun(
      selectEvidence([check], expected),
      {
        head_sha: sha,
        status: "completed",
        conclusion: "success",
        path: ".github/workflows/quality.yml",
        event: "merge_group",
      },
      expected,
    );
    expect(evidence).toMatchObject({
      sourceWorkflowPath: ".github/workflows/quality.yml",
      sourceEvent: "merge_group",
    });
  });

  it("rejects a same-named check from the wrong workflow", () => {
    expect(() =>
      bindWorkflowRun(
        selectEvidence([check], expected),
        {
          head_sha: sha,
          status: "completed",
          conclusion: "success",
          path: ".github/workflows/untrusted.yml",
          event: "merge_group",
        },
        expected,
      ),
    ).toThrow(/workflow run identity/);
  });

  it.each([
    ["stale SHA", { ...check, head_sha: "c".repeat(40) }],
    ["skipped", { ...check, conclusion: "skipped" }],
    ["foreign app", { ...check, app: { slug: "attacker" } }],
    [
      "foreign URL",
      {
        ...check,
        details_url: "https://github.com/attacker/repo/actions/runs/1",
      },
    ],
  ])("rejects %s", (_name, candidate) => {
    expect(() => selectEvidence([candidate], expected)).toThrow(
      /exactly one trusted/,
    );
  });

  it("rejects ambiguous duplicate check evidence", () => {
    expect(() => selectEvidence([check, check], expected)).toThrow(
      /exactly one trusted/,
    );
  });

  it("slurps paginated checks and verifies the owning workflow run", () => {
    const execute = vi
      .fn()
      .mockReturnValueOnce(JSON.stringify([{ check_runs: [check] }]))
      .mockReturnValueOnce(
        JSON.stringify({
          head_sha: sha,
          status: "completed",
          conclusion: "success",
          path: ".github/workflows/quality.yml",
          event: "merge_group",
        }),
      );
    expect(fetchEvidence(expected, execute)).toMatchObject({
      sourceWorkflowPath: ".github/workflows/quality.yml",
      sourceEvent: "merge_group",
    });
    expect(execute.mock.calls[0][1]).toContain("--slurp");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("reuses immutable evidence for the same exact candidate without an API call", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ci-evidence-"));
    const output = path.join(root, "evidence.json");
    const evidence = bindWorkflowRun(
      selectEvidence([check], expected),
      {
        head_sha: sha,
        status: "completed",
        conclusion: "success",
        path: ".github/workflows/quality.yml",
        event: "merge_group",
      },
      expected,
    );
    fs.writeFileSync(output, JSON.stringify(evidence));
    const execute = vi.fn(() => {
      throw new Error("API must not be called");
    });
    expect(resolveEvidence(expected, output, execute)).toEqual({
      evidence,
      reused: true,
    });
    expect(execute).not.toHaveBeenCalled();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("rejects cached evidence after the candidate head changes", () => {
    const evidence = bindWorkflowRun(
      selectEvidence([check], expected),
      {
        head_sha: sha,
        status: "completed",
        conclusion: "success",
        path: ".github/workflows/quality.yml",
        event: "merge_group",
      },
      expected,
    );
    expect(
      matchesExpected(evidence, { ...expected, headSha: "c".repeat(40) }),
    ).toBe(false);
  });
});
