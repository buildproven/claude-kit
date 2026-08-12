const { plan } = require("../test-impact");

describe("cross-language test impact", () => {
  it("uses Vitest dependency-aware related tests for JS and TS", () => {
    expect(plan(["src/a.ts", "lib/b.js"])).toMatchObject({
      mode: "focused",
      commands: [
        {
          executable: "npx",
          args: ["vitest", "related", "--run", "lib/b.js", "src/a.ts"],
        },
      ],
    });
  });

  it("runs only explicitly changed Python tests", () => {
    expect(plan(["tests/test_api.py"])).toMatchObject({
      mode: "focused",
      commands: [{ executable: "pytest", args: ["tests/test_api.py"] }],
    });
  });

  it.each([
    "src/api.py",
    "package-lock.json",
    ".github/workflows/quality.yml",
    "scripts/verify.sh",
    "config/runtime.json",
    "src/styles.css",
    "unknown.bin",
  ])("falls back to the full suite for %s", (file) => {
    expect(plan([file]).mode).toBe("full");
  });

  it("skips tests for docs-only changes", () => {
    expect(plan(["README.md"])).toMatchObject({ mode: "none", commands: [] });
  });
});
