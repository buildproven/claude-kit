// Tests for scripts/quality-verify-app.sh — the BUI-306 "does it actually
// boot" gate. Uses real throwaway fixtures (not mocks) per this repo's
// red-capable test preference: a real npm dev script is booted, a real port
// is polled, and for the web path a real headless browser (agent-browser)
// loads the real page and reads its real console/error buffers.
//
// The web-path tests are gated behind an `agent-browser` binary check
// (mirrors the /bin/bash gate in claude-review-companion.test.js) because
// CI does not install it globally — only this repo's own dev machines with
// agent-browser on PATH exercise that path locally. The library/CLI/timeout
// paths need nothing beyond node + bash and always run.

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCRIPT = path.resolve(__dirname, "..", "quality-verify-app.sh");

function hasBinary(name) {
  const result = spawnSync("bash", ["-c", `command -v ${name}`]);
  return result.status === 0;
}

const HAS_AGENT_BROWSER = hasBinary("agent-browser");

function run(cwd, env = {}) {
  const result = spawnSync("bash", [SCRIPT], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function fixtureDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `verify-app-${label}-`));
}

function writePackageJson(dir, contents) {
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(contents, null, 2),
  );
}

describe("quality-verify-app.sh", () => {
  it("is executable and starts with a bash shebang", () => {
    const source = fs.readFileSync(SCRIPT, "utf8");
    expect(source.startsWith("#!/usr/bin/env bash")).toBe(true);
  });

  it("treats a repo with no package.json as not-applicable and passes", () => {
    const dir = fixtureDir("no-package-json");
    const { status, stdout } = run(dir);
    expect(status).toBe(0);
    expect(stdout).toMatch(/not applicable/);
  });

  it("treats a library (no dev/start script, no bin) as not-applicable and passes", () => {
    const dir = fixtureDir("library");
    writePackageJson(dir, {
      name: "some-lib",
      version: "1.0.0",
      main: "index.js",
    });
    fs.writeFileSync(path.join(dir, "index.js"), "module.exports = {};\n");
    const { status, stdout } = run(dir);
    expect(status).toBe(0);
    expect(stdout).toMatch(/not applicable/);
    expect(stdout).toMatch(/no-op library gate/);
  });

  it("runs a CLI's --help and passes on a clean exit", () => {
    const dir = fixtureDir("cli-clean");
    fs.mkdirSync(path.join(dir, "bin"));
    writePackageJson(dir, {
      name: "some-cli",
      version: "1.0.0",
      bin: { "some-cli": "bin/cli.js" },
    });
    fs.writeFileSync(
      path.join(dir, "bin", "cli.js"),
      '#!/usr/bin/env node\nif (process.argv.includes("--help")) { console.log("usage"); process.exit(0); }\n',
    );
    const { status, stdout } = run(dir);
    expect(status).toBe(0);
    expect(stdout).toMatch(/SUCCESS: CLI/);
  });

  it("fails a CLI whose --help exits non-zero", () => {
    const dir = fixtureDir("cli-broken");
    fs.mkdirSync(path.join(dir, "bin"));
    writePackageJson(dir, {
      name: "broken-cli",
      version: "1.0.0",
      bin: { "broken-cli": "bin/cli.js" },
    });
    fs.writeFileSync(
      path.join(dir, "bin", "cli.js"),
      "#!/usr/bin/env node\nprocess.exit(2);\n",
    );
    const { status, stderr } = run(dir);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/FAIL:.*exited with status 2/);
  });

  it("fails clearly if package.json#bin points at a missing file", () => {
    const dir = fixtureDir("cli-missing-bin");
    writePackageJson(dir, {
      name: "missing-bin",
      version: "1.0.0",
      bin: { "missing-bin": "bin/does-not-exist.js" },
    });
    const { status, stderr } = run(dir);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/FAIL:.*does not exist/);
  });

  it("fails within its boot timeout when the dev script never binds a port", () => {
    const dir = fixtureDir("hangs");
    writePackageJson(dir, {
      name: "hangs",
      version: "1.0.0",
      scripts: { dev: "sleep 300" },
    });
    const started = Date.now();
    const { status, stderr } = run(dir, {
      QUALITY_VERIFY_APP_BOOT_TIMEOUT: "3",
    });
    const elapsedSeconds = (Date.now() - started) / 1000;
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/did not bind port 3000 within 3s/);
    // Generous upper bound: must not hang anywhere near the 300s sleep.
    expect(elapsedSeconds).toBeLessThan(20);
  });

  it("fails clearly if the dev script exits before binding its port", () => {
    const dir = fixtureDir("exits-immediately");
    writePackageJson(dir, {
      name: "exits-immediately",
      version: "1.0.0",
      scripts: { dev: 'node -e "process.exit(1)"' },
    });
    const { status, stderr } = run(dir, {
      QUALITY_VERIFY_APP_BOOT_TIMEOUT: "5",
    });
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/exited before binding port 3000/);
  });

  it("boots a non-HTML server and passes without invoking a browser", () => {
    const dir = fixtureDir("json-server");
    fs.mkdirSync(path.join(dir, "srv"));
    fs.writeFileSync(
      path.join(dir, "srv", "server.js"),
      [
        "const http = require('http');",
        "http.createServer((req, res) => {",
        "  res.writeHead(200, { 'Content-Type': 'application/json' });",
        "  res.end(JSON.stringify({ ok: true }));",
        "}).listen(4601, '127.0.0.1');",
      ].join("\n"),
    );
    writePackageJson(dir, {
      name: "json-server",
      version: "1.0.0",
      // Port 4601 is repeated in the script command itself (not just
      // inside server.js) so quality-verify-app.sh's literal port-scan of
      // the dev/start command string can discover it, matching how a real
      // repo's `dev: "PORT=4601 node srv/server.js"` convention would read.
      scripts: { dev: "node srv/server.js --port 4601" },
    });
    const { status, stdout } = run(dir);
    expect(status).toBe(0);
    expect(stdout).toMatch(/non-HTML response, skipping browser check/);
  });

  (HAS_AGENT_BROWSER ? describe : describe.skip)(
    "web path (requires agent-browser on PATH)",
    () => {
      function htmlFixture(label, bodyScript, port) {
        const dir = fixtureDir(label);
        const html = `<!doctype html><html><head><title>${label}</title></head><body><h1>hi</h1><script>${bodyScript}</script></body></html>`;
        fs.mkdirSync(path.join(dir, "srv"));
        fs.writeFileSync(
          path.join(dir, "srv", "server.js"),
          [
            "const http = require('http');",
            `const html = ${JSON.stringify(html)};`,
            "http.createServer((req, res) => {",
            "  res.writeHead(200, { 'Content-Type': 'text/html' });",
            "  res.end(html);",
            `}).listen(${port}, '127.0.0.1');`,
          ].join("\n"),
        );
        writePackageJson(dir, {
          name: label,
          version: "1.0.0",
          // Port is repeated in the dev script command itself (see the
          // json-server fixture above) so the gate's literal port scan finds
          // it without needing to parse server.js.
          scripts: { dev: `node srv/server.js --port ${port}` },
        });
        return dir;
      }

      it("passes a known-good web project with a clean console", () => {
        const dir = htmlFixture("good-web", 'console.log("boot ok")', 4611);
        const { status, stdout } = run(dir);
        expect(status).toBe(0);
        expect(stdout).toMatch(
          /root page loaded cleanly: 0 page errors, 0 console\.error messages/,
        );
      });

      it("fails a deliberately-broken web project that throws on mount", () => {
        const dir = htmlFixture(
          "broken-web",
          'throw new Error("boom on mount")',
          4612,
        );
        const { status, stderr } = run(dir);
        expect(status).not.toBe(0);
        expect(stderr).toMatch(/produced 1 JavaScript error/);
        expect(stderr).toMatch(/boom on mount/);
      });
    },
  );
});
