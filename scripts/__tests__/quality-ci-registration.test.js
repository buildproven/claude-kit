import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "./helpers/tmp.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const WAIT = path.join(ROOT, "scripts", "quality-wait-required-checks.sh");

function harness(body) {
  const root = makeTempDir("quality-ci-registration-");
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  const gh = path.join(bin, "gh");
  writeFileSync(gh, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(gh, 0o755);
  return { root, bin };
}

describe("quality CI registration wait", () => {
  it("retries exact pending registration responses, then watches success", () => {
    const { root, bin } = harness(`
count=0
[ -f "$QUALITY_TEST_COUNT" ] && count=$(cat "$QUALITY_TEST_COUNT")
count=$((count + 1))
printf '%s' "$count" > "$QUALITY_TEST_COUNT"
printf '%s\n' "$*" >> "$QUALITY_TEST_CALLS"
case "$count" in
  1) echo 'no checks reported' >&2; exit 1 ;;
  2) echo 'no required checks reported' >&2; exit 1 ;;
  3) exit 0 ;;
  4) exit 0 ;;
  *) exit 99 ;;
esac
`);
    execFileSync("bash", [WAIT, "--pr", "17", "--interval", "0"], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        QUALITY_TEST_CALLS: path.join(root, "calls.log"),
        QUALITY_TEST_COUNT: path.join(root, "count"),
      },
    });
    expect(
      readFileSync(path.join(root, "calls.log"), "utf8").trim().split("\n"),
    ).toEqual([
      "pr checks 17 --required",
      "pr checks 17 --required",
      "pr checks 17",
      "pr checks 17 --watch --interval 10",
    ]);
  });

  it("waits on all registered CI when the base cannot require checks", () => {
    const { root, bin } = harness(`
printf '%s\n' "$*" >> "$QUALITY_TEST_CALLS"
case "$*" in
  "pr checks 17 --required") echo 'no required checks reported' >&2; exit 1 ;;
  "pr checks 17") echo 'test pass'; exit 0 ;;
  "pr checks 17 --watch --interval 10") exit 0 ;;
  *) exit 99 ;;
esac
`);
    execFileSync("bash", [WAIT, "--pr", "17", "--interval", "0"], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        QUALITY_TEST_CALLS: path.join(root, "calls.log"),
      },
    });
    expect(
      readFileSync(path.join(root, "calls.log"), "utf8").trim().split("\n"),
    ).toEqual([
      "pr checks 17 --required",
      "pr checks 17",
      "pr checks 17 --watch --interval 10",
    ]);
  });

  it("fails immediately for non-registration errors", () => {
    const { root, bin } = harness(`
echo "$*" >> "$QUALITY_TEST_CALLS"
echo 'authentication required' >&2
exit 1
`);
    const result = spawnSync("bash", [WAIT, "--pr", "17", "--interval", "0"], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        QUALITY_TEST_CALLS: path.join(root, "calls.log"),
      },
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("authentication required");
    expect(readFileSync(path.join(root, "calls.log"), "utf8").trim()).toBe(
      "pr checks 17 --required",
    );
  });
});
