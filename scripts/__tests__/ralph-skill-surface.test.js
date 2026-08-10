import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const skillPath = path.join(ROOT, "skills", "ralph", "SKILL.md");
const referencePath = path.join(ROOT, "skills", "ralph", "reference.md");

describe("Ralph progressive-disclosure surface", () => {
  it("keeps the invoked entrypoint small and navigable", () => {
    const skill = readFileSync(skillPath, "utf8");
    expect(statSync(skillPath).size).toBeLessThanOrEqual(8_000);
    expect(skill).toContain("reference.md");
    expect(skill).toMatch(/PICK.*IMPLEMENT.*QUALITY.*REFLECT.*DECIDE/s);
    expect(skill).toMatch(/QUALITY.*mandatory/i);
    expect(skill).toMatch(/eight state transitions/i);
  });

  it("keeps the detailed runner contract in the on-demand reference", () => {
    const reference = readFileSync(referencePath, "utf8");
    expect(reference.length).toBeGreaterThan(20_000);
    expect(reference).toContain("Failure-Class Retry Matrix");
    expect(reference).toContain("Inline-backlog detection");
    expect(reference).toContain("context-break");
  });
});
