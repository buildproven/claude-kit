const { execute, loadPolicy, plan } = require("../test-impact");
const {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const ROOT = path.resolve(__dirname, "..", "..");

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
  ])(
    "reports unmapped impact instead of launching the full suite for %s",
    (file) => {
      expect(plan([file])).toMatchObject({
        mode: "unmapped",
        uncovered: [file],
      });
    },
  );

  it("skips tests for docs-only changes", () => {
    expect(plan(["README.md"])).toMatchObject({ mode: "none", commands: [] });
  });

  it("maps executable documentation to its smallest contract test", () => {
    const policy = {
      version: 1,
      mappings: [
        {
          paths: ["STRATEGY.md"],
          commands: [
            {
              executable: "pytest",
              args: ["tests/test_direction_consistency.py"],
            },
          ],
        },
      ],
    };
    expect(plan(["STRATEGY.md"], policy)).toMatchObject({
      mode: "focused",
      commands: [
        {
          executable: "pytest",
          args: ["tests/test_direction_consistency.py"],
        },
      ],
    });
  });

  it("does not rerun a changed test already named by an explicit mapping", () => {
    const policy = {
      version: 1,
      mappings: [
        {
          paths: ["scripts/tool.js"],
          commands: [
            {
              executable: "npx",
              args: ["vitest", "run", "scripts/__tests__/tool.test.js"],
            },
          ],
        },
      ],
    };
    expect(
      plan(
        ["scripts/tool.js", "scripts/__tests__/tool.test.js", "src/other.js"],
        policy,
      ),
    ).toMatchObject({
      mode: "focused",
      commands: [
        {
          executable: "npx",
          args: ["vitest", "run", "scripts/__tests__/tool.test.js"],
        },
        {
          executable: "npx",
          args: ["vitest", "related", "--run", "src/other.js"],
        },
      ],
    });
  });

  it("does not treat an option value as an executed test target", () => {
    const test = "scripts/__tests__/tool.test.js";
    const result = plan(["scripts/tool.js", test], {
      version: 1,
      mappings: [
        {
          paths: ["scripts/tool.js"],
          commands: [
            {
              executable: "npx",
              args: ["vitest", "run", "--config", test],
            },
          ],
        },
      ],
    });
    expect(result.commands).toContainEqual({
      executable: "npx",
      args: ["vitest", "related", "--run", test],
    });
  });

  it("keeps related coverage when a positional Jest target has runner options", () => {
    const test = "tests/tool.test.js";
    const result = plan(["src/tool.js", test], {
      version: 1,
      jsRunner: "jest",
      mappings: [
        {
          paths: ["src/tool.js"],
          commands: [
            { executable: "npx", args: ["jest", test, "--runInBand"] },
          ],
        },
      ],
    });
    expect(result.commands).toEqual([
      { executable: "npx", args: ["jest", test, "--runInBand"] },
      { executable: "npx", args: ["jest", "--findRelatedTests", test] },
    ]);
  });

  it("keeps related coverage when a trailing option can exclude the target", () => {
    const test = "scripts/__tests__/tool.test.js";
    const result = plan(["scripts/tool.js", test], {
      version: 1,
      mappings: [
        {
          paths: ["scripts/tool.js"],
          commands: [
            {
              executable: "npx",
              args: ["vitest", "run", test, "--exclude", test],
            },
          ],
        },
      ],
    });
    expect(result.commands).toContainEqual({
      executable: "npx",
      args: ["vitest", "related", "--run", test],
    });
  });

  it("keeps a mixed diff blocked when one executable path is unmapped", () => {
    expect(plan(["README.md", "src/api.py", "src/view.ts"])).toMatchObject({
      mode: "unmapped",
      uncovered: ["src/api.py"],
      commands: [
        {
          executable: "npx",
          args: ["vitest", "related", "--run", "src/view.ts"],
        },
      ],
    });
  });

  it("supports Jest related-test selection", () => {
    expect(
      plan(["src/view.ts"], { version: 1, jsRunner: "jest" }),
    ).toMatchObject({
      mode: "focused",
      commands: [
        {
          executable: "npx",
          args: ["jest", "--findRelatedTests", "src/view.ts"],
        },
      ],
    });
  });

  it("runs changed plain Node test files directly", () => {
    expect(
      plan(["tests/a.test.js", "scripts/__tests__/b.test.js"], {
        version: 1,
        jsRunner: "node",
      }),
    ).toMatchObject({
      mode: "focused",
      commands: [
        { executable: "node", args: ["scripts/__tests__/b.test.js"] },
        { executable: "node", args: ["tests/a.test.js"] },
      ],
    });
  });

  it("keeps Node source changes unmapped without a repository mapping", () => {
    expect(
      plan(["lib/a.js", "tests/a.test.js"], {
        version: 1,
        jsRunner: "node",
      }),
    ).toMatchObject({
      mode: "unmapped",
      uncovered: ["lib/a.js"],
      commands: [{ executable: "node", args: ["tests/a.test.js"] }],
    });
  });

  it("does not direct-run TypeScript tests with plain Node", () => {
    expect(
      plan(["tests/a.test.ts", "tests/b.test.tsx"], {
        version: 1,
        jsRunner: "node",
      }),
    ).toMatchObject({
      mode: "unmapped",
      uncovered: ["tests/a.test.ts", "tests/b.test.tsx"],
      commands: [],
    });
  });

  it("runs a complete regression only for an explicit audit rule", () => {
    const result = plan(["package-lock.json"], {
      version: 1,
      audits: [
        {
          paths: ["package-lock.json"],
          reason: "dependency graph changed",
          commands: [{ executable: "npm", args: ["test"] }],
        },
      ],
    });
    expect(result).toEqual({
      mode: "audit",
      reason: "dependency graph changed",
      files: ["package-lock.json"],
      commands: [{ executable: "npm", args: ["test"] }],
    });
  });

  it("maps the protected-push guard to its behavioral contract", () => {
    expect(
      plan(["scripts/block-push-main.sh"], loadPolicy(ROOT)),
    ).toMatchObject({
      mode: "focused",
      commands: [
        {
          executable: "npx",
          args: [
            "vitest",
            "run",
            "scripts/__tests__/branch-guard-hooks.test.js",
          ],
        },
      ],
    });
  });

  it("treats a trailing-slash path as an explicit directory prefix", () => {
    expect(
      plan([".github/workflows/quality.yml"], {
        version: 1,
        mappings: [
          {
            paths: [".github/workflows/"],
            commands: [
              {
                executable: "node",
                args: ["tests/workflow-contract.test.js"],
              },
            ],
          },
        ],
      }),
    ).toMatchObject({
      mode: "focused",
      commands: [
        {
          executable: "node",
          args: ["tests/workflow-contract.test.js"],
        },
      ],
    });
  });

  it("does not authorize an unknown change set", () => {
    expect(plan([])).toMatchObject({
      mode: "unmapped",
      reason: "unknown-change-set",
    });
  });

  it("executes argv commands without a shell", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "test-impact-"));
    const target = path.join(root, "evidence.txt");
    expect(
      execute(
        {
          mode: "focused",
          commands: [
            {
              executable: process.execPath,
              args: [
                "-e",
                `require('node:fs').writeFileSync(${JSON.stringify(target)}, 'ok')`,
              ],
            },
          ],
        },
        root,
      ),
    ).toBe(0);
    expect(readFileSync(target, "utf8")).toBe("ok");
  });

  it("fails visibly instead of executing partial commands when impact is unmapped", () => {
    expect(
      execute({
        mode: "unmapped",
        remediation: "map src/api.py",
        commands: [
          { executable: process.execPath, args: ["-e", "process.exit(0)"] },
        ],
      }),
    ).toBe(2);
  });

  it("rejects a policy whose content no longer matches the persisted gate", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "test-impact-policy-"));
    mkdirSync(path.join(root, ".buildproven"));
    writeFileSync(
      path.join(root, ".buildproven", "test-impact.json"),
      JSON.stringify({ version: 1 }),
    );
    const child = spawnSync(
      process.execPath,
      [
        path.resolve(__dirname, "..", "test-impact.js"),
        "--execute",
        "--policy-sha256",
        "0".repeat(64),
        "--",
        "README.md",
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(child.status).toBe(2);
    expect(child.stderr).toContain(
      "does not match the persisted exact-head policy",
    );
  });

  it("rejects misspelled policy fields instead of silently weakening selection", () => {
    expect(() => plan(["src/a.ts"], { version: 1, mapping: [] })).toThrow(
      /unsupported fields: mapping/,
    );
  });

  it("reports malformed policy JSON as an actionable configuration error", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "test-impact-json-"));
    mkdirSync(path.join(root, ".buildproven"));
    writeFileSync(path.join(root, ".buildproven", "test-impact.json"), "{");
    expect(() => loadPolicy(root)).toThrow(
      /.buildproven\/test-impact.json is not valid JSON/,
    );
  });
});
