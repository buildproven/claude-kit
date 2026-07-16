import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { classifyFile, autoScope } = require("../quality-auto-scope.js");

describe("classifyFile", () => {
  it("classifies scripts/ as critical", () => {
    expect(classifyFile("scripts/risk-policy-gate.js")).toBe("critical");
  });

  it("classifies config/ as critical", () => {
    expect(classifyFile("config/settings.json")).toBe("critical");
  });

  it("classifies .github/workflows/ as critical", () => {
    expect(classifyFile(".github/workflows/ci.yml")).toBe("critical");
  });

  it("classifies package.json as high pending semantic scoring", () => {
    expect(classifyFile("package.json")).toBe("high");
  });

  it("classifies skills/quality/ as high", () => {
    expect(classifyFile("skills/quality/SKILL.md")).toBe("high");
    expect(classifyFile("skills/quality/reference.md")).toBe("high");
  });

  it("classifies commands/bs/quality.md as high", () => {
    expect(classifyFile("commands/bs/quality.md")).toBe("high");
  });

  it("classifies other commands/bs/ as medium", () => {
    expect(classifyFile("commands/bs/status.md")).toBe("medium");
  });

  it("classifies other skills/ as medium", () => {
    expect(classifyFile("skills/status/SKILL.md")).toBe("medium");
  });

  it("classifies docs/ as low", () => {
    expect(classifyFile("docs/root-cause-guide.md")).toBe("low");
  });

  it("classifies *.md at root as low", () => {
    expect(classifyFile("README.md")).toBe("low");
    expect(classifyFile("CHANGELOG.md")).toBe("low");
  });

  it("classifies unknown source files as medium", () => {
    expect(classifyFile("src/index.ts")).toBe("medium");
    expect(classifyFile("lib/utils.js")).toBe("medium");
  });
});

describe("autoScope", () => {
  it("selects scope=changed for all-low files under 200 lines", () => {
    const result = autoScope(["docs/guide.md", "CHANGELOG.md"], 73);
    expect(result.scope).toBe("changed");
    expect(result.level).toBe(95);
    expect(result.tier).toBe("low");
  });

  it("selects scope=branch for all-low files over 200 lines", () => {
    const result = autoScope(["docs/guide.md", "README.md"], 201);
    expect(result.scope).toBe("branch");
    expect(result.tier).toBe("low");
  });

  it("selects scope=branch when any file is medium tier", () => {
    const result = autoScope(["docs/guide.md", "skills/status/SKILL.md"], 50);
    expect(result.scope).toBe("branch");
    expect(result.tier).toBe("medium");
  });

  it("selects scope=branch for high-tier changes regardless of line count", () => {
    const result = autoScope(["skills/quality/SKILL.md"], 5);
    expect(result.scope).toBe("branch");
    expect(result.tier).toBe("high");
  });

  it("selects scope=branch for critical-tier changes", () => {
    const result = autoScope(["scripts/foo.sh", "docs/bar.md"], 10);
    expect(result.scope).toBe("branch");
    expect(result.tier).toBe("critical");
  });

  it("highest tier wins when multiple tiers present", () => {
    const result = autoScope(["docs/readme.md", "config/settings.json"], 30);
    expect(result.tier).toBe("critical");
    expect(result.scope).toBe("branch");
  });

  it("returns a human-readable reason string", () => {
    const result = autoScope(["docs/guide.md"], 10);
    expect(result.reason).toContain("low-tier");
  });

  it("handles empty file list as low/changed", () => {
    const result = autoScope([], 0);
    expect(result.scope).toBe("changed");
    expect(result.tier).toBe("low");
  });
});
