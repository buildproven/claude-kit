const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  selectReviewers,
  selectReviewersForRange,
} = require("../quality-agent-selection");

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

  it("handles a large diff without the child-process buffer truncating selection", () => {
    const repo = fs.mkdtempSync(
      path.join(os.tmpdir(), "quality-agent-selection-"),
    );
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Quality Test"], {
      cwd: repo,
    });
    execFileSync("git", ["config", "user.email", "quality@example.com"], {
      cwd: repo,
    });
    fs.writeFileSync(path.join(repo, "README.md"), "base\n");
    execFileSync("git", ["add", "README.md"], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "base"], { cwd: repo });
    fs.writeFileSync(
      path.join(repo, "src.js"),
      `${"const value = true;\n".repeat(100_000)}// large\n`,
    );
    execFileSync("git", ["add", "src.js"], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "large diff"], { cwd: repo });
    const base = execFileSync("git", ["rev-parse", "HEAD~1"], {
      cwd: repo,
      encoding: "utf8",
    }).trim();
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repo,
      encoding: "utf8",
    }).trim();
    expect(
      selectReviewersForRange({ tier: "critical", repo, base, head }),
    ).toEqual({
      agents: ["code-reviewer", "silent-failure-hunter"],
      domain: "general",
      rule: "critical-reliability-backstop",
    });
  });
});
