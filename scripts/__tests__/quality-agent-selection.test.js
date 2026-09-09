const {
  selectReviewers,
  selectReviewersForRange,
} = require("../quality-agent-selection");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

describe("quality agent selection", () => {
  it("selects no AI reviewer at low risk", () => {
    expect(
      selectReviewers({
        tier: "low",
        files: ["docs/readme.md"],
        patches: ["+Clarify setup"],
        taskType: "docs",
      }),
    ).toEqual({ agents: [], domain: "policy-exempt", rule: "low-no-ai" });
  });

  it.each([
    ["src/auth/session.js", "+authorize(user)", "security-auditor", "security"],
    ["scripts/install.sh", "+set -e", "silent-failure-hunter", "reliability"],
    [
      "schemas/event.json",
      '+"required": ["id"]',
      "type-design-analyzer",
      "contract",
    ],
  ])("selects a domain reviewer for %s", (file, patch, agent, domain) => {
    expect(
      selectReviewers({ tier: "high", files: [file], patches: [patch] }),
    ).toMatchObject({ agents: [agent], domain });
  });

  it("selects the test specialist only for a medium test-only diff", () => {
    expect(
      selectReviewers({
        tier: "medium",
        files: ["scripts/__tests__/widget.test.js"],
        patches: ["+expect(run()).toBe(true)"],
      }),
    ).toMatchObject({
      agents: ["pr-test-analyzer"],
      domain: "test-only",
    });
  });

  it("uses a general reviewer plus a distinct reliability backstop for an unclassified critical diff", () => {
    expect(
      selectReviewers({
        tier: "critical",
        files: ["src/widget.js"],
        patches: ["+export function widget() { return true; }"],
      }),
    ).toEqual({
      agents: ["code-reviewer", "silent-failure-hunter"],
      domain: "general",
      rule: "critical-reliability-backstop",
    });
  });

  it("keeps the critical general reviewer distinct from the selected specialist", () => {
    const result = selectReviewers({
      tier: "critical",
      files: ["src/auth/session.js", "src/widget.js"],
      patches: ["+authorize(user)", "+runWidget()"],
    });
    expect(result.agents).toEqual(["code-reviewer", "security-auditor"]);
    expect(new Set(result.agents).size).toBe(2);
    expect(result.rule).toBe("security-domain");
  });

  it("reads review patches larger than Node's default child-process buffer", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "quality-selector-"));
    try {
      const git = (args) =>
        execFileSync("git", args, {
          cwd: repo,
          stdio: "ignore",
        });
      git(["init", "--quiet"]);
      git(["config", "user.name", "Quality Test"]);
      git(["config", "user.email", "quality@example.invalid"]);
      fs.writeFileSync(path.join(repo, "fixture.txt"), "base\n");
      git(["add", "fixture.txt"]);
      git(["commit", "--quiet", "-m", "base"]);
      fs.writeFileSync(
        path.join(repo, "fixture.txt"),
        `${"x".repeat(1_100_000)}\nset -e\n`,
      );
      git(["add", "fixture.txt"]);
      git(["commit", "--quiet", "-m", "large-patch"]);

      expect(
        selectReviewersForRange({
          tier: "high",
          repo,
          base: "HEAD~1",
          head: "HEAD",
        }),
      ).toMatchObject({
        agents: ["silent-failure-hunter"],
        domain: "reliability",
      });
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
