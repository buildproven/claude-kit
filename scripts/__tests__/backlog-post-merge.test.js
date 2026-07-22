import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "backlog-post-merge.sh");

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "backlog-post-merge-"));
  const bin = path.join(root, "bin");
  const log = path.join(root, "curl.log");
  const result = spawnSync("mkdir", ["-p", bin]);
  expect(result.status).toBe(0);

  const curl = path.join(bin, "curl");
  writeFileSync(
    curl,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$CURL_LOG"
case "$*" in
  *workflowStates*) printf '%s' '{"data":{"workflowStates":{"nodes":[{"id":"done-state"}]}}}' ;;
  *issueUpdate*) printf '%s' '{"data":{"issueUpdate":{"success":true}}}' ;;
  *) printf '%s' '{"data":{"issues":{"nodes":[{"id":"issue-id"}]}}}' ;;
esac
`,
  );
  chmodSync(curl, 0o755);
  return { bin, log };
}

describe("backlog-post-merge", () => {
  it("closes every unique identifier supplied by a bundled merge", () => {
    const fx = fixture();
    const result = spawnSync("bash", [SCRIPT], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        CURL_LOG: fx.log,
        ITEM_ID_OVERRIDE: "Closes BUI-101, BUI-202, BUI-101",
        LINEAR_API_KEY: "test-token",
        PATH: `${fx.bin}:${process.env.PATH}`,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Marked BUI-101 as Done");
    expect(result.stdout).toContain("Marked BUI-202 as Done");
    const requests = spawnSync("cat", [fx.log], { encoding: "utf8" });
    expect(requests.stdout).toContain("BUI-101");
    expect(requests.stdout).toContain("BUI-202");
  });

  it("also reads every identifier cited in the associated pull request body", () => {
    const fx = fixture();
    const gh = path.join(fx.bin, "gh");
    writeFileSync(
      gh,
      "#!/usr/bin/env bash\nprintf '%s' 'Closes BUI-303, BUI-404'\n",
    );
    chmodSync(gh, 0o755);

    const result = spawnSync("bash", [SCRIPT], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        CURL_LOG: fx.log,
        GITHUB_REPOSITORY: "buildproven/claude-kit",
        GITHUB_SHA: "deadbeef",
        LINEAR_API_KEY: "test-token",
        PATH: `${fx.bin}:${process.env.PATH}`,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Marked BUI-303 as Done");
    expect(result.stdout).toContain("Marked BUI-404 as Done");
  });

  it("fails visibly when referenced issues cannot be closed without a token", () => {
    const result = spawnSync("bash", [SCRIPT], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        ITEM_ID_OVERRIDE: "BUI-101",
        LINEAR_API_KEY: "",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("LINEAR_API_KEY is required");
  });
});
