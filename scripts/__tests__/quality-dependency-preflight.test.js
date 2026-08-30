const { execFileSync, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { ZipFS } = require("@yarnpkg/libzip");
const { makeTempDir } = require("./helpers/tmp.js");

const PREFLIGHT = path.resolve(
  __dirname,
  "..",
  "quality-dependency-preflight.js",
);
const BUNDLED_PREFLIGHT = path.resolve(
  __dirname,
  "..",
  "generated",
  "quality-dependency-preflight",
  "index.js",
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
      name: "fixture",
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

function selectFixtureManager(root, manager, version) {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  pkg.packageManager = `${manager}@${version}`;
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(pkg));
}

function installFixturePackage(root) {
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
  fs.writeFileSync(path.join(packageRoot, "bin.js"), "", { mode: 0o755 });
  fs.symlinkSync(
    path.join("..", "eslint", "bin.js"),
    path.join(binRoot, "eslint"),
  );
}

function installPnpmFixturePackage(root) {
  const packageRoot = path.join(
    root,
    "node_modules",
    ".pnpm",
    "eslint@1.2.3",
    "node_modules",
    "eslint",
  );
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
  fs.writeFileSync(path.join(packageRoot, "bin.js"), "", { mode: 0o755 });
  fs.symlinkSync(
    path.join(".pnpm", "eslint@1.2.3", "node_modules", "eslint"),
    path.join(root, "node_modules", "eslint"),
  );
  fs.symlinkSync(
    path.join("..", "eslint", "bin.js"),
    path.join(binRoot, "eslint"),
  );
}

function installYarnPnpFixture(root) {
  selectFixtureManager(root, "yarn", "4.18.0");
  const zip = new ZipFS(null);
  zip.mkdirpSync("/node_modules/eslint");
  zip.writeFileSync(
    "/node_modules/eslint/package.json",
    JSON.stringify({ name: "eslint", version: "1.2.3", bin: "bin.js" }),
  );
  zip.writeFileSync("/node_modules/eslint/bin.js", "#!/usr/bin/env node\n");
  zip.writeFileSync("/node_modules/eslint/a.txt", "a");
  zip.writeFileSync("/node_modules/eslint/b.txt", "b");
  const bytes = zip.getBufferAndClose();
  const archive = path.join(root, ".yarn", "cache", "eslint.zip");
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  fs.writeFileSync(archive, bytes);
  const checksum = crypto.createHash("sha512").update(bytes).digest("hex");
  fs.writeFileSync(
    path.join(root, "yarn.lock"),
    `__metadata:\n  version: 10\n"eslint@npm:1.2.3":\n  version: 1.2.3\n  resolution: "eslint@npm:1.2.3"\n  checksum: test/${checksum}\n  linkType: hard\n"fixture@workspace:.":\n  version: 0.0.0-use.local\n  resolution: "fixture@workspace:."\n  dependencies:\n    eslint: "npm:1.2.3"\n`,
  );
  fs.writeFileSync(
    path.join(root, ".yarnrc.yml"),
    "pnpEnableInlining: false\n",
  );
  fs.writeFileSync(
    path.join(root, ".pnp.data.json"),
    JSON.stringify({
      dependencyTreeRoots: [{ name: "fixture", reference: "workspace:." }],
      packageRegistryData: [
        [
          "fixture",
          [
            [
              "workspace:.",
              {
                packageLocation: "./",
                packageDependencies: [
                  ["eslint", "npm:1.2.3"],
                  ["fixture", "workspace:."],
                ],
                linkType: "SOFT",
              },
            ],
          ],
        ],
        [
          "eslint",
          [
            [
              "npm:1.2.3",
              {
                packageLocation:
                  "./.yarn/cache/eslint.zip/node_modules/eslint/",
                packageDependencies: [["eslint", "npm:1.2.3"]],
                linkType: "HARD",
              },
            ],
          ],
        ],
      ],
    }),
  );
  return { archive };
}

describe("quality dependency preflight", () => {
  it("accepts a package repository with no direct dependencies", () => {
    const root = fixture();
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { test: "node test.js" } }),
    );
    fs.rmSync(path.join(root, "package-lock.json"));
    const result = spawnSync("node", [PREFLIGHT, "--repo", root], {
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
  });

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
    installFixturePackage(root);
    const result = spawnSync("node", [PREFLIGHT, "--repo", root], {
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it("accepts exact pnpm schema 9 state", () => {
    const root = fixture();
    selectFixtureManager(root, "pnpm", "11.25.0");
    fs.writeFileSync(
      path.join(root, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\nimporters:\n  .:\n    devDependencies:\n      eslint:\n        specifier: 1.2.3\n        version: 1.2.3\npackages:\n  eslint@1.2.3: {}\nsnapshots:\n  eslint@1.2.3: {}\n",
    );
    installPnpmFixturePackage(root);
    const result = spawnSync("node", [PREFLIGHT, "--repo", root], {
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it("accepts exact Yarn node-modules state without loading .pnp.cjs", () => {
    const root = fixture();
    selectFixtureManager(root, "yarn", "4.18.0");
    fs.writeFileSync(
      path.join(root, "yarn.lock"),
      '__metadata:\n  version: 10\n"eslint@npm:1.2.3":\n  version: 1.2.3\n  resolution: "eslint@npm:1.2.3"\n"fixture@workspace:.":\n  version: 0.0.0-use.local\n  resolution: "fixture@workspace:."\n  dependencies:\n    eslint: "npm:1.2.3"\n',
    );
    fs.writeFileSync(
      path.join(root, ".yarnrc.yml"),
      "nodeLinker: node-modules\n",
    );
    fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "node_modules", ".yarn-state.yml"),
      '__metadata:\n  version: 1\n"eslint@npm:1.2.3":\n  locations:\n    - "node_modules/eslint"\n',
    );
    installFixturePackage(root);
    const result = spawnSync("node", [PREFLIGHT, "--repo", root], {
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it("accepts exact Bun text lock state", () => {
    const root = fixture();
    selectFixtureManager(root, "bun", "1.4.0");
    fs.writeFileSync(
      path.join(root, "bun.lock"),
      '{\n  "lockfileVersion": 1,\n  "workspaces": {"": {"devDependencies": {"eslint": "1.2.3"}}},\n  "packages": {"eslint": ["eslint@1.2.3", "", {}]},\n}\n',
    );
    installFixturePackage(root);
    const result = spawnSync("node", [PREFLIGHT, "--repo", root], {
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
  });

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

  it("rejects ambiguous lockfiles when packageManager is absent", () => {
    const root = fixture();
    fs.writeFileSync(
      path.join(root, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n",
    );
    const result = spawnSync("node", [PREFLIGHT, "--repo", root], {
      encoding: "utf8",
    });
    expect(result.status).toBe(78);
    expect(result.stderr).toMatch(/ambiguous \(npm, pnpm\)/);
  });

  it("does not execute an inline Yarn PnP loader", () => {
    const root = fixture();
    const marker = path.join(root, "executed");
    selectFixtureManager(root, "yarn", "4.18.0");
    fs.writeFileSync(
      path.join(root, "yarn.lock"),
      '__metadata:\n  version: 10\n"fixture@workspace:.":\n  version: 0.0.0-use.local\n  resolution: "fixture@workspace:."\n  dependencies:\n    eslint: "npm:1.2.3"\n"eslint@npm:1.2.3":\n  version: 1.2.3\n  resolution: "eslint@npm:1.2.3"\n',
    );
    fs.writeFileSync(
      path.join(root, ".pnp.cjs"),
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "bad");\n`,
    );
    const result = spawnSync("node", [PREFLIGHT, "--repo", root], {
      encoding: "utf8",
    });
    expect(result.status).toBe(78);
    expect(result.stderr).toMatch(/pnpEnableInlining: false/);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("accepts data-only Yarn PnP with a checksum-bound hard-cache ZIP", () => {
    const root = fixture();
    installYarnPnpFixture(root);
    const result = spawnSync("node", [PREFLIGHT, "--repo", root], {
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it("rejects duplicate raw ZIP entries before Yarn path normalization", () => {
    const root = fixture();
    const { archive } = installYarnPnpFixture(root);
    const bytes = fs.readFileSync(archive);
    const from = Buffer.from("node_modules/eslint/b.txt");
    const to = Buffer.from("node_modules/eslint/a.txt");
    const centralName = bytes.lastIndexOf(from);
    expect(centralName).toBeGreaterThan(-1);
    to.copy(bytes, centralName);
    fs.writeFileSync(archive, bytes);
    const lockFile = path.join(root, "yarn.lock");
    const lock = fs
      .readFileSync(lockFile, "utf8")
      .replace(
        /checksum: test\/[a-f0-9]+/u,
        `checksum: test/${crypto.createHash("sha512").update(bytes).digest("hex")}`,
      );
    fs.writeFileSync(lockFile, lock);
    const result = spawnSync("node", [PREFLIGHT, "--repo", root], {
      encoding: "utf8",
    });
    expect(result.status).toBe(78);
    expect(result.stderr).toMatch(/duplicate or unsafe entry/);
  });

  it("rejects a regular command shim with injected shell code", () => {
    const root = fixture();
    installPnpmFixturePackage(root);
    const target = fs.realpathSync(
      path.join(root, "node_modules", "eslint", "bin.js"),
    );
    const command = path.join(root, "node_modules", ".bin", "eslint");
    fs.unlinkSync(command);
    fs.writeFileSync(
      command,
      `#!/bin/sh\ntouch /tmp/preflight-pwned\n# cmd-shim-target=${target}\n`,
      { mode: 0o755 },
    );
    const result = spawnSync("node", [PREFLIGHT, "--repo", root], {
      encoding: "utf8",
    });
    expect(result.status).toBe(78);
    expect(result.stderr).toMatch(/differs from the supported template/);
  });

  it("accepts exact POSIX, CMD, and PowerShell wrappers from the supported generator", async () => {
    const root = fixture();
    installPnpmFixturePackage(root);
    const target = fs.realpathSync(
      path.join(root, "node_modules", "eslint", "bin.js"),
    );
    const command = path.join(root, "node_modules", ".bin", "eslint");
    fs.unlinkSync(command);
    const { cmdShim } = await import("@zkochan/cmd-shim");
    await cmdShim(target, command, {
      createCmdFile: true,
      createPwshFile: true,
      nodePath: [path.join(root, "node_modules")],
    });
    const result = spawnSync("node", [PREFLIGHT, "--repo", root], {
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it("rejects an orphan executable omitted from its target package manifest", () => {
    const root = fixture();
    installFixturePackage(root);
    const manifest = path.join(root, "node_modules", "eslint", "package.json");
    fs.writeFileSync(
      manifest,
      JSON.stringify({ name: "eslint", version: "1.2.3" }),
    );
    const result = spawnSync("node", [PREFLIGHT, "--repo", root], {
      encoding: "utf8",
    });
    expect(result.status).toBe(78);
    expect(result.stderr).toMatch(
      /executable is not declared by its target package/,
    );
  });

  it("rejects an installed package symlink that escapes the repository", () => {
    const root = fixture();
    const external = makeTempDir("quality-dependency-external-");
    fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
    fs.writeFileSync(
      path.join(external, "package.json"),
      JSON.stringify({ name: "eslint", version: "1.2.3" }),
    );
    fs.symlinkSync(external, path.join(root, "node_modules", "eslint"));
    const result = spawnSync("node", [PREFLIGHT, "--repo", root], {
      encoding: "utf8",
    });
    expect(result.status).toBe(78);
    expect(result.stderr).toMatch(/escapes the repository/);
  });

  it("rejects reversed pnpm environment and project documents", () => {
    const root = fixture();
    selectFixtureManager(root, "pnpm", "11.25.0");
    fs.writeFileSync(
      path.join(root, "pnpm-lock.yaml"),
      "---\nlockfileVersion: '9.0'\nimporters:\n  .:\n    devDependencies: {}\npackages: {}\nsnapshots: {}\n---\nlockfileVersion: '9.0'\nimporters:\n  .:\n    configDependencies: {}\npackages: {}\nsnapshots: {}\n",
    );
    const result = spawnSync("node", [PREFLIGHT, "--repo", root], {
      encoding: "utf8",
    });
    expect(result.status).toBe(78);
    expect(result.stderr).toMatch(
      /first document is not an environment lockfile/,
    );
  });

  it("rejects a pnpm patched locator backed by the unpatched package path", () => {
    const root = fixture();
    selectFixtureManager(root, "pnpm", "11.25.0");
    fs.writeFileSync(
      path.join(root, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\nimporters:\n  .:\n    devDependencies:\n      eslint:\n        specifier: 1.2.3\n        version: 1.2.3(patch_hash=deadbeef)\npackages: {}\nsnapshots: {}\n",
    );
    installPnpmFixturePackage(root);
    const result = spawnSync("node", [PREFLIGHT, "--repo", root], {
      encoding: "utf8",
    });
    expect(result.status).toBe(78);
    expect(result.stderr).toMatch(/eslint@1\.2\.3_patch_hash=deadbeef/);
  });

  it("reports the exact Bun binary-lock migration command", () => {
    const root = fixture();
    selectFixtureManager(root, "bun", "1.4.0");
    fs.writeFileSync(path.join(root, "bun.lockb"), "binary");
    const result = spawnSync("node", [PREFLIGHT, "--repo", root], {
      encoding: "utf8",
    });
    expect(result.status).toBe(78);
    expect(result.stderr).toMatch(
      /bun install --save-text-lockfile --frozen-lockfile --lockfile-only/,
    );
  });

  it("rejects a Bun schema 3 override that differs from package.json", () => {
    const root = fixture();
    selectFixtureManager(root, "bun", "1.4.0");
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    );
    pkg.overrides = { eslint: "1.2.3" };
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(pkg));
    fs.writeFileSync(
      path.join(root, "bun.lock"),
      '{"lockfileVersion":3,"overrides":{"eslint":"9.9.9"},"workspaces":{"":{"devDependencies":{"eslint":"1.2.3"}}},"packages":{"eslint":["eslint@1.2.3","",{}]}}',
    );
    const result = spawnSync("node", [PREFLIGHT, "--repo", root], {
      encoding: "utf8",
    });
    expect(result.status).toBe(78);
    expect(result.stderr).toMatch(/schema 3 overrides do not match/);
  });

  it("rejects a Bun schema 2 external tarball without integrity", () => {
    const root = fixture();
    selectFixtureManager(root, "bun", "1.4.0");
    fs.writeFileSync(
      path.join(root, "bun.lock"),
      '{"lockfileVersion":2,"workspaces":{"":{"devDependencies":{"eslint":"1.2.3"}}},"packages":{"eslint":["eslint@1.2.3","https://outside.example/eslint.tgz",{},""]}}',
    );
    const result = spawnSync("node", [PREFLIGHT, "--repo", root], {
      encoding: "utf8",
    });
    expect(result.status).toBe(78);
    expect(result.stderr).toMatch(/remote package has no integrity/);
  });

  it("rejects Bun external global-store mode", () => {
    const root = fixture();
    selectFixtureManager(root, "bun", "1.4.0");
    fs.writeFileSync(
      path.join(root, "bunfig.toml"),
      "[install]\nglobalStore = true\n",
    );
    fs.writeFileSync(
      path.join(root, "bun.lock"),
      '{"lockfileVersion":1,"workspaces":{"":{"devDependencies":{"eslint":"1.2.3"}}},"packages":{"eslint":["eslint@1.2.3","",{}]}}',
    );
    const result = spawnSync("node", [PREFLIGHT, "--repo", root], {
      encoding: "utf8",
    });
    expect(result.status).toBe(78);
    expect(result.stderr).toMatch(/install.globalStore is unsupported/);
  });

  it("rejects JSON input deeper than the parser contract", () => {
    const root = fixture();
    let nested = {};
    for (let depth = 0; depth < 130; depth += 1) nested = { child: nested };
    const lock = JSON.parse(
      fs.readFileSync(path.join(root, "package-lock.json"), "utf8"),
    );
    lock.nested = nested;
    fs.writeFileSync(
      path.join(root, "package-lock.json"),
      JSON.stringify(lock),
    );
    const result = spawnSync("node", [PREFLIGHT, "--repo", root], {
      encoding: "utf8",
    });
    expect(result.status).toBe(78);
    expect(result.stderr).toMatch(/exceeds 128 levels/);
  });

  it("rejects a lockfile symlink instead of following it", () => {
    const root = fixture();
    const external = makeTempDir("quality-lock-external-");
    const lockFile = path.join(root, "package-lock.json");
    const externalLock = path.join(external, "package-lock.json");
    fs.writeFileSync(externalLock, fs.readFileSync(lockFile));
    fs.unlinkSync(lockFile);
    fs.symlinkSync(externalLock, lockFile);
    const result = spawnSync("node", [PREFLIGHT, "--repo", root], {
      encoding: "utf8",
    });
    expect(result.status).toBe(78);
    expect(result.stderr).toMatch(/regular non-symlink file/);
  });

  it("rejects a file identity that changes during a stable read", async () => {
    const root = fixture();
    const original = fs.fstatSync;
    let firstDescriptor;
    let observations = 0;
    const spy = vi.spyOn(fs, "fstatSync").mockImplementation((descriptor) => {
      const stat = original(descriptor);
      if (firstDescriptor === undefined) firstDescriptor = descriptor;
      if (descriptor !== firstDescriptor) return stat;
      observations += 1;
      if (observations !== 2) return stat;
      return new Proxy(stat, {
        get(target, property) {
          return property === "mtimeMs" ? target.mtimeMs + 1 : target[property];
        },
      });
    });
    try {
      const { inspectDependencies } = require(PREFLIGHT);
      await expect(inspectDependencies(root)).rejects.toThrow(
        /changed while being read/,
      );
    } finally {
      spy.mockRestore();
    }
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
      'generated/quality-dependency-preflight/index.js" --repo "$GIT_ROOT"',
    );
    expect(
      source.indexOf("generated/quality-dependency-preflight"),
    ).toBeLessThan(
      source.indexOf('quality-invocation.js" "${CREATE_ARGS[@]}"'),
    );
  });

  it("runs the source-owned bundle without loading parser packages from the candidate", () => {
    const root = fixture();
    installFixturePackage(root);
    const result = spawnSync("node", [BUNDLED_PREFLIGHT, "--repo", root], {
      encoding: "utf8",
      env: { ...process.env, NODE_PATH: path.join(root, "missing-node-path") },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("package dependency preflight passed");
  });
});
