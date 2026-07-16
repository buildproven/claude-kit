import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const FINISH = path.join(ROOT, "scripts", "quality-finish-merge.sh");

function fixture(mode, seconds = 600) {
  const dir = mkdtempSync(path.join(tmpdir(), "quality-merge-"));
  const bin = path.join(dir, "bin");
  const log = path.join(dir, "gh.log");
  const governor = path.join(dir, "governor.json");
  spawnSync("mkdir", ["-p", bin]);
  const start = Math.floor(Date.now() / 1000);
  writeFileSync(
    governor,
    JSON.stringify({
      start_epoch: start,
      deadline_epoch: start + seconds,
      max_wall_seconds: seconds,
    }),
  );
  const gh = path.join(bin, "gh");
  writeFileSync(
    gh,
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$GH_LOG"
cmd="$*"
case "$GH_MODE:$cmd" in
  auto-pending:"pr merge --auto --squash") exit 0 ;;
  auto-pending:"pr view --json state --jq .state") echo OPEN; exit 0 ;;
  view-timeout:"pr merge --auto --squash")
    jq '.deadline_epoch = (now | floor) + 91' "$GH_GOVERNOR" > "$GH_GOVERNOR.tmp"
    mv "$GH_GOVERNOR.tmp" "$GH_GOVERNOR"
    exit 0
    ;;
  view-timeout:"pr view --json state --jq .state") sleep 5 ;;
  ci-fail:"pr merge --auto --squash") exit 1 ;;
  ci-fail:"pr checks --watch") exit 7 ;;
  fallback-success:"pr merge --auto --squash") exit 1 ;;
  fallback-success:"pr checks --watch") exit 0 ;;
  fallback-success:"pr merge --squash") exit 0 ;;
  final-timeout:"pr merge --auto --squash") exit 1 ;;
  final-timeout:"pr checks --watch")
    jq '.deadline_epoch = (now | floor)' "$GH_GOVERNOR" > "$GH_GOVERNOR.tmp"
    mv "$GH_GOVERNOR.tmp" "$GH_GOVERNOR"
    exit 0
    ;;
  *) exit 9 ;;
esac
`,
  );
  chmodSync(gh, 0o755);
  const result = spawnSync("bash", [FINISH, "--governor", governor], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GH_LOG: log,
      GH_MODE: mode,
      GH_GOVERNOR: governor,
    },
  });
  return {
    result,
    commands: existsSync(log)
      ? readFileSync(log, "utf8").trim().split("\n")
      : [],
  };
}

describe("quality-finish-merge", () => {
  it("arms auto-merge and returns a truthful pending status", () => {
    const { result, commands } = fixture("auto-pending");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("LOCAL_PASS_CI_PENDING");
    expect(commands).toEqual([
      "pr merge --auto --squash",
      "pr view --json state --jq .state",
    ]);
  });

  it("blocks on failed CI rather than reporting pending success", () => {
    const { result, commands } = fixture("ci-fail");
    expect(result.status).toBe(7);
    expect(result.stderr).toContain("MERGE BLOCKED");
    expect(commands).toEqual(["pr merge --auto --squash", "pr checks --watch"]);
  });

  it("waits and merges through bounded calls when auto-merge is unavailable", () => {
    const { result, commands } = fixture("fallback-success");
    expect(result.status).toBe(0);
    expect(commands).toEqual([
      "pr merge --auto --squash",
      "pr checks --watch",
      "pr merge --squash",
    ]);
  });

  it("returns pending on deadline without launching gh", () => {
    const { result, commands } = fixture("auto-pending", 1);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("LOCAL_PASS_CI_PENDING");
    expect(commands).toEqual([]);
  });

  it("returns pending when auto-merge state inspection times out", () => {
    const { result, commands } = fixture("view-timeout");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("LOCAL_PASS_CI_PENDING");
    expect(commands).toEqual(["pr merge --auto --squash"]);
  });

  it("returns pending when the final merge reaches the shared deadline", () => {
    const { result, commands } = fixture("final-timeout");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("LOCAL_PASS_CI_PENDING");
    expect(commands).toEqual(["pr merge --auto --squash", "pr checks --watch"]);
  });
});
