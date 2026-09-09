const { execFileSync, spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { selectReviewers } = require("../quality-agent-selection");

const ROOT = path.resolve(__dirname, "..", "..");
const INVOCATION = path.join(ROOT, "scripts", "quality-invocation.js");
const RISK = path.join(ROOT, "scripts", "quality-risk-resolve.sh");
const SELECT = path.join(ROOT, "scripts", "quality-select-agents.sh");

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

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

  it("records a low-risk zero-reviewer panel without shell array errors", () => {
    const root = mkdtempSync(path.join(tmpdir(), "quality-select-agents-"));
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["config", "user.name", "Quality Test"]);
    git(root, ["config", "user.email", "quality@example.com"]);
    writeFileSync(path.join(root, "README.md"), "# Base\n");
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: { lint: "true", test: "true", "security:audit": "true" },
      }),
    );
    git(root, ["add", "README.md", "package.json"]);
    git(root, ["commit", "-q", "-m", "docs: base"]);
    git(root, ["branch", "feature"]);
    git(root, ["remote", "add", "origin", root]);
    writeFileSync(path.join(root, "README.md"), "# Updated\n");
    git(root, ["add", "README.md"]);
    git(root, ["commit", "-q", "-m", "docs: update readme"]);
    const manifest = execFileSync(
      "node",
      [
        INVOCATION,
        "create",
        "--repo",
        root,
        "--base-ref",
        "HEAD~1",
        "--level",
        "auto",
      ],
      { cwd: root, encoding: "utf8" },
    ).trim();
    const risk = spawnSync("bash", [RISK, "--manifest", manifest], {
      cwd: root,
      encoding: "utf8",
    });
    expect(risk.status, risk.stderr).toBe(0);
    const selected = spawnSync("bash", [SELECT, "--manifest", manifest], {
      cwd: root,
      encoding: "utf8",
    });
    expect(selected.status, selected.stderr).toBe(0);
    const body = JSON.parse(readFileSync(manifest, "utf8"));
    expect(body.risk.agentTarget).toBe(0);
    expect(body.agents).toEqual([]);
    expect(body.panel).toMatchObject({
      domain: "policy-exempt",
      rule: "low-no-ai",
    });
  });
});
