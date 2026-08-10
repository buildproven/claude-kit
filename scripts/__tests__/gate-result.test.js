const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { inspectFile, validateEnvelope } = require("../lib/gate-result.js");

const ROOT = path.resolve(__dirname, "..", "..");
const RUN_GATE = path.join(ROOT, "scripts", "lib", "run-gate.sh");
const RESULT_HELPER = path.join(ROOT, "scripts", "lib", "gate-result.sh");
const TEMP_DIRECTORIES = new Set();

function tempDirectory(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TEMP_DIRECTORIES.add(directory);
  return directory;
}

afterEach(() => {
  for (const directory of TEMP_DIRECTORIES) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  TEMP_DIRECTORIES.clear();
});

describe("gate result protocol", () => {
  it("accepts only the exact PASS/FAIL/SKIP envelope shape", () => {
    expect(
      validateEnvelope({ status: "PASS", checks: 1, reason: "ok" }),
    ).toEqual({
      valid: true,
    });
    expect(
      validateEnvelope({ status: "PASS", checks: 0, reason: "nothing" }),
    ).toEqual(expect.objectContaining({ valid: false }));
    expect(validateEnvelope({ status: "SKIP", checks: 0, reason: "" })).toEqual(
      expect.objectContaining({ valid: false }),
    );
    expect(
      validateEnvelope({
        status: "PASS",
        checks: 1,
        reason: "ok",
        extra: true,
      }),
    ).toEqual(expect.objectContaining({ valid: false }));
  });

  it("ignores unrelated JSON logs that only happen to contain a status key", () => {
    const log = path.join(tempDirectory("gate-envelope-"), "result.log");
    fs.writeFileSync(log, '{"status":"running","message":"progress"}\n');
    expect(inspectFile(log)).toEqual({ envelopes: [], invalid: [] });
  });

  it("wraps a legacy successful command as one completed check", () => {
    const result = spawnSync(
      "bash",
      [RUN_GATE, "legacy", "node", "-e", "process.exit(0)"],
      { cwd: ROOT, encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    const log = path.join(tempDirectory("gate-envelope-"), "result.log");
    fs.writeFileSync(log, result.stdout);
    expect(inspectFile(log)).toMatchObject({
      invalid: [],
      envelopes: [{ value: { status: "PASS", checks: 1 } }],
    });
  });

  it("rejects a native gate that exits without an envelope", () => {
    const result = spawnSync(
      "bash",
      [RUN_GATE, "native-fixture", "--native", "node", "-e", "process.exit(0)"],
      { cwd: ROOT, encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("without exactly one result envelope");
  });

  it("propagates a native helper contract failure through the EXIT trap", () => {
    const directory = tempDirectory("gate-envelope-");
    const script = path.join(directory, "native-fixture.sh");
    fs.writeFileSync(
      script,
      `#!/usr/bin/env bash\nset -u\nsource ${JSON.stringify(RESULT_HELPER)}\ngate_result_init\nexit 0\n`,
    );
    fs.chmodSync(script, 0o755);
    const result = spawnSync("bash", [script], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      '"reason":"PASS requires at least one completed check"',
    );
  });
});
