const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { makeTempDir } = require("./helpers/tmp.js");

const PREFLIGHT = path.resolve(
  __dirname,
  "..",
  "quality-dependency-preflight.js",
);
const BOOTSTRAP = path.resolve(__dirname, "..", "quality-bootstrap.sh");

function fixture() {
  const root = makeTempDir("quality-dependency-preflight-");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Quality Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "quality@example.com"], {
    cwd: root,
  });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      scripts: {
        lint: "eslint .",
        test: "node test.js",
        "security:audit": "true",
      },
      devDependencies: { eslint: "1.2.3" },
    }),
  );
  fs.writeFileSync(
    path.join(root, "package-lock.json"),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { devDependencies: { eslint: "1.2.3" } },
        "node_modules/eslint": { version: "1.2.3" },
      },
    }),
  );
  fs.writeFileSync(path.join(root, "test.js"), "process.exit(0);\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  return root;
}

describe("quality dependency preflight", () => {
  it("rejects missing package-local dependencies before campaign creation and records telemetry", () => {
    const root = fixture();
    const telemetry = path.join(root, "preflight.jsonl");
    const result = spawnSync("node", [PREFLIGHT, "--repo", root], {
      encoding: "utf8",
      env: { ...process.env, BS_QUALITY_PREFLIGHT_TELEMETRY_FILE: telemetry },
    });
    expect(result.status).toBe(78);
    expect(result.stderr).toMatch(/eslint: package is not installed/);
    expect(result.stderr).toMatch(/Run npm ci in this exact worktree/);
    expect(JSON.parse(fs.readFileSync(telemetry, "utf8"))).toMatchObject({
      recordClass: "preflight",
      failureCount: 1,
      manager: "npm",
    });
  });

  it("accepts the exact lockfile package and package-local executable", () => {
    const root = fixture();
    const packageRoot = path.join(root, "node_modules", "eslint");
    const binRoot = path.join(root, "node_modules", ".bin");
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.mkdirSync(binRoot, { recursive: true });
    fs.writeFileSync(
      path.join(packageRoot, "package.json"),
      JSON.stringify({
        name: "eslint",
        version: "1.2.3",
        bin: { eslint: "bin.js" },
      }),
    );
    fs.writeFileSync(path.join(binRoot, "eslint"), "", { mode: 0o755 });
    const result = spawnSync("node", [PREFLIGHT, "--repo", root], {
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it.each(["pnpm", "yarn", "bun"])(
    "fails closed without a source-owned %s dependency verifier",
    (manager) => {
      const root = fixture();
      const pkg = JSON.parse(
        fs.readFileSync(path.join(root, "package.json"), "utf8"),
      );
      pkg.packageManager = `${manager}@1.0.0`;
      fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(pkg));
      const result = spawnSync("node", [PREFLIGHT, "--repo", root], {
        encoding: "utf8",
        env: {
          ...process.env,
          BS_QUALITY_PREFLIGHT_TELEMETRY_FILE: path.join(
            root,
            "preflight.jsonl",
          ),
        },
      });
      expect(result.status).toBe(78);
      expect(result.stderr).toMatch(
        /source-owned exact dependency-state verification is not available/,
      );
    },
  );

  it("reports the repair command for the declared package manager", () => {
    const root = fixture();
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    );
    pkg.packageManager = "pnpm@10.0.0";
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(pkg));
    const result = spawnSync("node", [PREFLIGHT, "--repo", root], {
      encoding: "utf8",
      env: {
        ...process.env,
        BS_QUALITY_PREFLIGHT_TELEMETRY_FILE: path.join(root, "preflight.jsonl"),
      },
    });
    expect(result.status).toBe(78);
    expect(result.stderr).toMatch(/pnpm install --frozen-lockfile/);
  });

  it.each([
    {
      name: "npm workspace link records",
      lock: {
        lockfileVersion: 3,
        packages: {
          "": { devDependencies: { eslint: "1.2.3" } },
          "node_modules/eslint": { link: true, resolved: "packages/eslint" },
          "packages/eslint": { version: "1.2.3" },
        },
      },
    },
  ])("accepts $name when the installed package matches", ({ lock }) => {
    const root = fixture();
    fs.writeFileSync(
      path.join(root, "package-lock.json"),
      JSON.stringify(lock),
    );
    const packageRoot = path.join(root, "node_modules", "eslint");
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.writeFileSync(
      path.join(packageRoot, "package.json"),
      JSON.stringify({ name: "eslint", version: "1.2.3" }),
    );
    const result = spawnSync("node", [PREFLIGHT, "--repo", root], {
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it("wires the preflight before immutable manifest creation", () => {
    const source = fs.readFileSync(BOOTSTRAP, "utf8");
    expect(source).toContain(
      'quality-dependency-preflight.js" --repo "$GIT_ROOT"',
    );
    expect(source.indexOf("quality-dependency-preflight.js")).toBeLessThan(
      source.indexOf('quality-invocation.js" "${CREATE_ARGS[@]}"'),
    );
  });
});
