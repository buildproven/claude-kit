import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir } from "./helpers/tmp.js";
const {
  selectReviewers,
  selectReviewersForRange,
} = require("../quality-agent-selection");

describe("quality agent selection", () => {
  it("classifies security content beyond the first MiB of a generated diff", () => {
    const repo = makeTempDir("review-selection-large-diff-");
    const git = (...args) =>
      execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
    git("init", "-b", "main");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.com");
    git("commit", "--allow-empty", "-m", "chore: base");
    const base = git("rev-parse", "HEAD");
    writeFileSync(
      join(repo, "generated.txt"),
      "x".repeat(1100000) + "\nauthentication\n",
    );
    git("add", "generated.txt");
    git("commit", "-m", "chore: generated data");
    expect(
      selectReviewersForRange({
        tier: "high",
        repo,
        base,
        head: git("rev-parse", "HEAD"),
      }),
    ).toMatchObject({
      agents: ["security-auditor"],
      domain: "security",
    });
  });

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
});
