import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..", "..");
const verify = resolve(root, "scripts", "verify");

describe("authoritative verification", () => {
  it("is syntactically valid and fails the process when a gate fails", () => {
    execFileSync("bash", ["-n", verify]);
    const source = readFileSync(verify, "utf8");

    expect(source).toContain('FAILED+=("$name")');
    expect(source).toContain("exit 1");
    expect(source).toContain("run_gate tests npm test");
  });

  it("is the CI quality entry point", () => {
    const workflow = readFileSync(
      resolve(root, ".github", "workflows", "quality.yml"),
      "utf8",
    );

    expect(workflow).toContain("run: ./scripts/verify");
    expect(workflow).not.toContain("run: npm run format:check");
    expect(workflow).not.toContain("run: npm audit --audit-level high");
  });
});
