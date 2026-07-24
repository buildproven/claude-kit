import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "quality-stamp-and-merge.sh");

// Extracts the retry loop verbatim from the real script (between the two
// fence comments) so this test is red-capable against the actual source:
// if BUI-462's retry loop is edited, deleted, or moved, this extraction
// either changes what it tests or fails to find the fences, not silently
// tests a stale copy.
function extractRetryLoop() {
  const source = readFileSync(SCRIPT, "utf8");
  const start = source.indexOf("PR_HEAD_RETRIES=");
  const end = source.indexOf("CI_TIMEOUT=", start);
  if (start === -1 || end === -1) {
    throw new Error(
      "quality-stamp-and-merge.sh: PR_HEAD_RETRIES retry loop not found — BUI-462 test extraction is stale",
    );
  }
  return source.slice(start, end);
}

function harness(ghBody) {
  const root = mkdtempSync(path.join(tmpdir(), "quality-pr-head-retry-"));
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  const gh = path.join(bin, "gh");
  writeFileSync(gh, `#!/usr/bin/env bash\n${ghBody}\n`);
  chmodSync(gh, 0o755);
  return { root, bin };
}

function runRetryLoop({ bin, stampHead, pr, repository, countFile }) {
  const script = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `PR=${JSON.stringify(pr)}`,
    `EXPECTED_REPOSITORY=${JSON.stringify(repository)}`,
    `STAMP_HEAD=${JSON.stringify(stampHead)}`,
    extractRetryLoop(),
    'echo "RETRY_LOOP_RESULT=$PR_HEAD"',
  ].join("\n");
  return spawnSync("bash", ["-c", script], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      QUALITY_STAMP_PR_HEAD_RETRY_DELAY: "0",
      QUALITY_TEST_COUNT_FILE: countFile ?? "",
    },
    encoding: "utf8",
  });
}

describe("BUI-462: quality-stamp-and-merge.sh PR HEAD retry", () => {
  it("retries a transient GitHub read-after-write mismatch and succeeds once it clears", () => {
    const { bin } = harness(`
COUNT_FILE="\${QUALITY_TEST_COUNT_FILE}"
count=0
[ -f "$COUNT_FILE" ] && count=$(cat "$COUNT_FILE")
count=$((count + 1))
echo "$count" > "$COUNT_FILE"
if [ "$count" -lt 3 ]; then
  echo "stale0000000000000000000000000000000000"
else
  echo "matching000000000000000000000000000000"
fi
`);
    const countFile = path.join(bin, "..", "count");
    const result = runRetryLoop({
      bin,
      stampHead: "matching000000000000000000000000000000",
      pr: "42",
      repository: "buildproven/claude-kit",
      countFile,
    });
    if (result.status !== 0) {
      console.error(result.stdout, result.stderr);
    }
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "RETRY_LOOP_RESULT=matching000000000000000000000000000000",
    );
    expect(result.stderr).toContain("retrying");
  });

  it("fails after exhausting retries on a genuine, persistent SHA divergence", () => {
    const { bin } = harness(`
echo "genuinely0different0000000000000000000"
`);
    const result = runRetryLoop({
      bin,
      stampHead: "matching000000000000000000000000000000",
      pr: "42",
      repository: "buildproven/claude-kit",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("after 3 attempts");
  });

  it("does not retry at all when the first read already matches", () => {
    const { bin } = harness(`
echo "matching000000000000000000000000000000"
`);
    const result = runRetryLoop({
      bin,
      stampHead: "matching000000000000000000000000000000",
      pr: "42",
      repository: "buildproven/claude-kit",
    });
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("retrying");
  });

  it("tolerates gh itself failing (network/auth/rate-limit) and retries rather than aborting", () => {
    // silent-failure-hunter caught this in review: under `set -e` (active in
    // the real script), an unguarded `gh pr view` failure on attempt 1 would
    // abort the whole script instead of retrying — defeating the retry loop
    // for exactly the kind of transient API flakiness this fix targets.
    const { bin } = harness(`
COUNT_FILE="\${QUALITY_TEST_COUNT_FILE}"
count=0
[ -f "$COUNT_FILE" ] && count=$(cat "$COUNT_FILE")
count=$((count + 1))
echo "$count" > "$COUNT_FILE"
if [ "$count" -lt 2 ]; then
  echo "gh: rate limit exceeded" >&2
  exit 1
else
  echo "matching000000000000000000000000000000"
fi
`);
    const countFile = path.join(bin, "..", "count");
    const result = runRetryLoop({
      bin,
      stampHead: "matching000000000000000000000000000000",
      pr: "42",
      repository: "buildproven/claude-kit",
      countFile,
    });
    if (result.status !== 0) {
      console.error(result.stdout, result.stderr);
    }
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "RETRY_LOOP_RESULT=matching000000000000000000000000000000",
    );
    expect(result.stderr).toContain("gh pr view failed on attempt 1");
  });

  it("does not let benign stderr noise on a successful call corrupt the captured SHA", () => {
    // 4 review agents converged on this in one round: an earlier version of
    // this fix captured stdout and stderr together (`2>&1`), so a `gh`
    // deprecation notice or update nag printed to stderr on an otherwise
    // successful call got concatenated into PR_HEAD — reintroducing the
    // exact false-mismatch failure this whole PR exists to eliminate.
    const { bin } = harness(`
echo "gh: a new release of gh is available" >&2
echo "matching000000000000000000000000000000"
`);
    const result = runRetryLoop({
      bin,
      stampHead: "matching000000000000000000000000000000",
      pr: "42",
      repository: "buildproven/claude-kit",
    });
    if (result.status !== 0) {
      console.error(result.stdout, result.stderr);
    }
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "RETRY_LOOP_RESULT=matching000000000000000000000000000000",
    );
    expect(result.stderr).not.toContain("retrying");
  });
});
