import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const MUTATION = path.join(ROOT, "scripts", "quality-mutation-check.sh");

describe("quality mutation recursion guard", () => {
  it("excludes the contract suite from mutation proof runs", () => {
    const script = readFileSync(MUTATION, "utf8");

    expect(script).toContain(
      "--exclude scripts/__tests__/quality-mutation-check.test.js",
    );
  });
});
