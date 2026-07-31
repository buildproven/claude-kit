// Regression tests for the gitleaks branch of the post-edit-lint PostToolUse
// hook.
//
// The hook runs under `set -euo pipefail`. gitleaks exits NON-ZERO exactly when
// it FINDS secrets, so the original
//
//     GITLEAKS_OUTPUT=$(gitleaks detect ...)
//     GITLEAKS_EXIT=$?
//
// killed the script at the assignment on the very path that matters. The whole
// "Secrets detected" reporting block was unreachable: a real leak produced
// exit 1 and empty output, and the hook's documented contract treats anything
// other than 2 as "allow". Secrets passed through silently.
//
// gitleaks is stubbed on PATH so these tests exercise the hook's own control
// flow deterministically, without depending on a real gitleaks install or on
// embedding a credential-shaped literal in the repo.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const HOOK = path.resolve(import.meta.dirname, "..", "post-edit-lint.sh");

let stubDir;
let workDir;

/** Install a `gitleaks` stub with the given body on a PATH prefix. */
function stubGitleaks(body) {
  const bin = path.join(stubDir, "gitleaks");
  writeFileSync(bin, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(bin, 0o755);
}

function runHook(fileName) {
  const payload = JSON.stringify({
    tool_name: "Write",
    tool_input: { file_path: path.join(workDir, fileName) },
  });
  try {
    const stdout = execFileSync("bash", [HOOK], {
      input: payload,
      encoding: "utf8",
      env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}` },
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, output: stdout };
  } catch (error) {
    return {
      code: error.status,
      output: (error.stdout ?? "") + (error.stderr ?? ""),
    };
  }
}

beforeAll(() => {
  stubDir = mkdtempSync(path.join(tmpdir(), "pel-stub-"));
  workDir = mkdtempSync(path.join(tmpdir(), "pel-work-"));
  // A package.json terminates the hook's upward project-root walk.
  writeFileSync(path.join(workDir, "package.json"), '{"name":"probe"}\n');
  writeFileSync(path.join(workDir, "sample.js"), "const a = 1;\n");
});

afterAll(() => {
  for (const dir of [stubDir, workDir]) {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("post-edit-lint.sh gitleaks branch", () => {
  it("blocks the edit and reports when gitleaks finds a leak", () => {
    // Mirrors real gitleaks behavior: prints a finding, exits non-zero.
    stubGitleaks('echo "leaks found: 1"\nexit 1');
    const { code, output } = runHook("sample.js");
    expect(code).toBe(2);
    expect(output).toMatch(/secrets detected/i);
  });

  it("reports a scan failure distinctly from a leak", () => {
    // Non-zero exit WITHOUT the "leaks found" marker is a broken scan, which
    // must surface as its own message rather than be misreported as a leak.
    stubGitleaks('echo "fatal: could not open config" >&2\nexit 3');
    const { code, output } = runHook("sample.js");
    expect(code).toBe(2);
    expect(output).toMatch(/gitleaks scan failed \(exit 3\)/i);
  });

  it("allows the edit when gitleaks finds nothing", () => {
    stubGitleaks('echo "no leaks found"\nexit 0');
    expect(runHook("sample.js").code).toBe(0);
  });

  // The hook documents `0 = pass (or skip), 2 = block`. A crash exiting 1 is
  // read as "allow" by Claude Code, which is precisely how the leak path
  // failed open.
  it("never exits outside the documented 0/2 contract", () => {
    for (const stub of [
      'echo "leaks found: 1"\nexit 1',
      'echo "no leaks found"\nexit 0',
      'echo "boom" >&2\nexit 99',
      "exit 1", // non-zero with no output at all
    ]) {
      stubGitleaks(stub);
      expect([0, 2]).toContain(runHook("sample.js").code);
    }
  });
});
