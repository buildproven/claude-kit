const { buildDiagnosis } = require("../quality-terminal-status");

describe("quality terminal diagnosis", () => {
  it("separates gates, provider exhaustion, approval, CI, and exact recovery", () => {
    const manifest = {
      requiredGates: [{ name: "lint" }, { name: "security" }],
      gates: [
        { name: "lint", head: "abc", status: "success" },
        { name: "security", head: "old", status: "success" },
      ],
      revisions: { currentHead: "abc" },
      reviews: [],
      risk: { tier: "critical" },
      approval: { approved: false },
    };
    const output = buildDiagnosis("/tmp/exact/invocation.json", manifest, {
      category: "provider-exhaustion",
      provider: "claude",
      resetAt: "2026-07-20T03:00:00.000Z",
    });

    expect(output).toContain(
      "Repository gates: lint=success, security=pending",
    );
    expect(output).toContain(
      "Provider review/checkpoint: blocked — claude exhaustion; reset 2026-07-20T03:00:00.000Z",
    );
    expect(output).toContain("Break-glass: required and missing or stale");
    expect(output).toContain("GitHub CI: not checked by this failure path");
    expect(output).toContain(
      "Retry/resume: /bs:quality --manifest /tmp/exact/invocation.json",
    );
  });

  it("does not collapse malformed review output into provider exhaustion", () => {
    const output = buildDiagnosis(
      "/tmp/exact/invocation.json",
      {
        requiredGates: [],
        gates: [],
        revisions: { currentHead: "abc" },
        reviews: [],
        risk: { tier: "medium" },
      },
      { category: "parser-inconclusive", provider: "codex" },
    );
    expect(output).toContain("codex review output was inconclusive");
    expect(output).not.toContain("exhaustion");
  });

  it("labels billing failures independently", () => {
    const output = buildDiagnosis(
      "/tmp/exact/invocation.json",
      {
        requiredGates: [],
        gates: [],
        revisions: { currentHead: "abc" },
        reviews: [],
        risk: { tier: "medium" },
      },
      { category: "provider-billing", provider: "codex" },
    );
    expect(output).toContain("codex billing or credits failure");
    expect(output).not.toContain("exhaustion");
  });

  it("labels code findings independently from CI and provider failures", () => {
    const output = buildDiagnosis(
      "/tmp/exact/invocation.json",
      {
        requiredGates: [],
        gates: [],
        revisions: { currentHead: "abc" },
        reviews: [{ status: "success" }],
        risk: { tier: "medium" },
      },
      { category: "code-findings" },
    );
    expect(output).toContain("actionable code findings remain");
    expect(output).toContain("GitHub CI: not checked by this failure path");
  });
});
