import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "./helpers/tmp.js";

const repo = resolve(import.meta.dirname, "../..");
const loop = join(repo, "scripts/overnight-loop.sh");
const deadline = join(repo, "scripts/run-with-deadline.py");

function executable(path, body) {
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(path, 0o755);
}

function fixture() {
  const root = makeTempDir("overnight-loop-test-");
  const setup = join(root, "setup");
  const target = join(root, "target");
  const bin = join(root, "bin");
  mkdirSync(join(setup, "scripts"), { recursive: true });
  mkdirSync(target);
  mkdirSync(bin);
  copyFileSync(deadline, join(setup, "scripts/run-with-deadline.py"));
  for (const name of [
    "provider-run.sh",
    "provider-policy.sh",
    "autonomous-loop-runtime.js",
  ]) {
    copyFileSync(join(repo, "scripts", name), join(setup, "scripts", name));
    chmodSync(join(setup, "scripts", name), 0o755);
  }
  execFileSync("git", ["init", "-b", "main"], { cwd: target });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: target,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: target });
  writeFileSync(join(target, "README.md"), "test\n");
  execFileSync("git", ["add", "README.md"], { cwd: target });
  execFileSync("git", ["commit", "-m", "chore: initial"], { cwd: target });
  executable(join(bin, "claude"), "echo claude-must-not-run >&2; exit 91");
  const usage = join(bin, "claude-usage");
  executable(
    usage,
    "printf '%s' '{\"fiveHourPercent\":10,\"sevenDayPercent\":20}'",
  );
  return { root, setup, target, bin, usage };
}

function launchFixture(fx, dryRun = false) {
  const command = `set -- --linear-project test --target-dir "$TEST_TARGET"; OVERNIGHT_LOOP_LIB_ONLY=1 source "$TEST_LOOP"; SCRIPT_DIR="$TEST_SCRIPTS"; linear_next_issue() { echo BUI-42; }; linear_issue_state() { echo Backlog; }; DRY_RUN=${dryRun ? 1 : 0}; main`;
  const child = spawn("/bin/bash", ["-c", command], {
    env: {
      ...process.env,
      TEST_TARGET: fx.target,
      TEST_LOOP: loop,
      TEST_SCRIPTS: join(fx.setup, "scripts"),
      LINEAR_API_KEY: "fixture",
      CLAUDE_USAGE_COMMAND: fx.usage,
      XDG_STATE_HOME: join(fx.root, "state"),
      TMPDIR: fx.root,
      OVERNIGHT_LOOP_STATE_DIR: join(fx.root, "progress"),
      OVERNIGHT_LOOP_HEARTBEAT_SECONDS: "1",
    },
  });
  let output = "";
  child.stdout.on("data", (data) => {
    output += data;
  });
  child.stderr.on("data", (data) => {
    output += data;
  });
  return { child, output: () => output, exited: once(child, "exit") };
}

async function eventually(predicate, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error("timed out waiting for fixture behavior");
}

function sleepingProvider(fx) {
  const marker = join(fx.root, "provider.pid");
  executable(
    join(fx.setup, "scripts/provider-run.sh"),
    `echo $$ > '${marker}'\necho PRIVATE_PROVIDER_OUTPUT\necho PRIVATE_PROVIDER_ERROR >&2\nexec sleep 30`,
  );
  return marker;
}

function stopFixture(run, marker) {
  if (run.child.exitCode === null && run.child.signalCode === null)
    run.child.kill("SIGTERM");
  if (existsSync(marker)) {
    const pid = Number(readFileSync(marker, "utf8").trim());
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
}

describe("overnight loop", () => {
  it("excludes a live duplicate and preserves crash evidence", async () => {
    const fx = fixture();
    const marker = sleepingProvider(fx);
    const first = launchFixture(fx);
    try {
      await eventually(() => existsSync(marker));
      const duplicate = launchFixture(fx, true);
      expect((await duplicate.exited)[0]).not.toBe(0);
      first.child.kill("SIGKILL");
      await first.exited;
      const restarted = launchFixture(fx, true);
      expect((await restarted.exited)[0], restarted.output()).not.toBe(0);
    } finally {
      stopFixture(first, marker);
    }
  }, 15000);

  it("shows sanitized progress while the provider sleeps", async () => {
    const fx = fixture();
    const marker = sleepingProvider(fx);
    const run = launchFixture(fx);
    try {
      await eventually(() => existsSync(marker));
      await eventually(
        () => run.output().split("phase=provider-running").length >= 3,
        2500,
      );
      expect(run.output()).not.toContain("PRIVATE_PROVIDER_OUTPUT");
      expect(run.output()).not.toContain("PRIVATE_PROVIDER_ERROR");
      const progressDirectory = join(fx.root, "progress");
      const filenames = readdirSync(progressDirectory);
      const progressLog = join(
        progressDirectory,
        filenames.find((name) =>
          /^overnight-loop-\d{4}-\d{2}-\d{2}\.log$/.test(name),
        ),
      );
      expect(readFileSync(progressLog, "utf8")).not.toContain(
        "PRIVATE_PROVIDER_OUTPUT",
      );
      expect(readFileSync(progressLog, "utf8")).not.toContain(
        "PRIVATE_PROVIDER_ERROR",
      );
      const privateLog = join(
        progressDirectory,
        filenames.find(
          (name) =>
            name.startsWith("overnight-loop-BUI-42-") && name.endsWith(".log"),
        ),
      );
      expect(readFileSync(privateLog, "utf8")).toContain(
        "PRIVATE_PROVIDER_OUTPUT",
      );
      expect(statSync(privateLog).mode & 0o777).toBe(0o600);
      const status = JSON.parse(
        readFileSync(
          join(fx.root, "progress/overnight-loop-status.json"),
          "utf8",
        ),
      );
      expect(status.phase).toBe("provider-running");
      expect(status.elapsedSeconds).toBeGreaterThanOrEqual(0);
      expect(status.remainingSeconds).toBeGreaterThan(0);
      expect(JSON.stringify(status)).not.toContain("PRIVATE_PROVIDER");
    } finally {
      stopFixture(run, marker);
      await run.exited;
    }
  }, 10000);

  it.each(["SIGTERM", "SIGKILL"])(
    "stops provider descendants after launcher %s",
    async (signal) => {
      const fx = fixture();
      const marker = sleepingProvider(fx);
      const run = launchFixture(fx);
      try {
        await eventually(() => existsSync(marker));
        const providerPid = Number(readFileSync(marker, "utf8").trim());
        run.child.kill(signal);
        await run.exited;
        if (signal === "SIGTERM") {
          const status = JSON.parse(
            readFileSync(
              join(fx.root, "progress/overnight-loop-status.json"),
              "utf8",
            ),
          );
          expect(status).toMatchObject({
            phase: "finished",
            terminalReason: "interrupted",
            exitStatus: 130,
          });
          const restarted = launchFixture(fx, true);
          expect((await restarted.exited)[0], restarted.output()).toBe(0);
        }
        await eventually(() => {
          const result = spawnSync(
            "ps",
            ["-p", String(providerPid), "-o", "stat="],
            { encoding: "utf8" },
          );
          return result.status !== 0 || result.stdout.trim().startsWith("Z");
        }, 4000);
      } finally {
        stopFixture(run, marker);
      }
    },
    10000,
  );

  it("preserves an unknown-owner legacy lock", async () => {
    const fx = fixture();
    const key = createHash("sha256")
      .update(`${fx.target}\0test`)
      .digest("hex")
      .slice(0, 20);
    const legacy = join(fx.root, `buildproven-overnight-loop-${key}.lock`);
    mkdirSync(legacy);
    const run = launchFixture(fx, true);
    expect((await run.exited)[0]).not.toBe(0);
    expect(existsSync(legacy)).toBe(true);
  });
  it.each(["codex", "claude"])(
    "admits a %s loop with the shipped reader and no custom usage command",
    (provider) => {
      const fx = fixture();
      const requestLog = join(fx.root, "usage-provider.txt");
      executable(
        join(fx.bin, "codexbar"),
        `printf '%s' "$3" > '${requestLog}'\nprintf '%s' '[{"provider":"${provider}","usage":{"updatedAt":"${new Date().toISOString()}","primary":{"usedPercent":10}}}]'`,
      );
      executable(
        join(fx.bin, "curl"),
        `printf '%s' '{"data":{"issues":{"nodes":[]}}}'`,
      );
      const result = spawnSync(
        "/bin/bash",
        [
          loop,
          "--linear-project",
          "test",
          "--target-dir",
          fx.target,
          "--provider",
          provider,
          "--fallback",
          "none",
          "--dry-run",
        ],
        {
          encoding: "utf8",
          timeout: 10000,
          env: {
            ...process.env,
            PATH: `${fx.bin}:${process.env.PATH}`,
            BS_PROVIDER_PRIMARY: provider,
            BS_PROVIDER_FALLBACK: "none",
            CLAUDE_USAGE_COMMAND: "",
            CURL_BIN: join(fx.bin, "curl"),
            LINEAR_API_KEY: "test-token",
            XDG_STATE_HOME: join(fx.root, "state"),
            TMPDIR: fx.root,
          },
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("reason=backlog-drained");
      expect(readFileSync(requestLog, "utf8")).toBe(provider);
    },
  );

  it("requires an explicit Linear project", () => {
    const result = spawnSync("bash", [loop, "--dry-run"], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--linear-project is required");
  });

  it("hands every fresh Ralph child explicit compute facts", () => {
    const source = readFileSync(loop, "utf8");
    expect(source).toContain('--phase-request "$execution_facts_file"');
    expect(source).toContain("--caller overnight-ralph");
    expect(source).toContain('if [ "$PROVIDER" = codex ]');
    expect(source).toContain('[ -z "$PROVIDER" ] || provider_args+=');
    expect(source).toContain('[ -z "$PROVIDER_FALLBACK" ] || provider_args+=');
    expect(source).toContain('--output-dir "$provider_output_dir"');
    expect(source).toContain('"phase":"implement"');
    expect(source).toContain('"targetedProof":false');
    expect(source).toContain('"caller":"overnight-ralph"');
  });

  it("keeps default governed evidence outside the target worktree", () => {
    const fx = fixture();
    const stateHome = join(fx.root, "state");
    const command = `set -- --linear-project claude-setup --target-dir '${fx.target}'; OVERNIGHT_LOOP_LIB_ONLY=1 source '${loop}'; printf '%s\n' "$LOG_DIR"`;
    const logDir = execFileSync("bash", ["-c", command], {
      encoding: "utf8",
      env: {
        ...process.env,
        SETUP_REPO: fx.setup,
        XDG_STATE_HOME: stateHome,
      },
    }).trim();
    expect(logDir).toMatch(
      new RegExp(`^${stateHome}/buildproven/overnight-loop/[0-9a-f]{16}$`),
    );
    expect(logDir.startsWith(`${fx.target}/`)).toBe(false);
  });

  it("hard-stops a whole command at its deadline", () => {
    const start = Date.now();
    const result = spawnSync(
      "python3",
      [deadline, "--timeout-seconds", "1", "--", "sleep", "30"],
      {
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(124);
    expect(Date.now() - start).toBeLessThan(5000);
    expect(result.stderr).toContain("deadline exceeded");
  });

  it("dry-runs only the requested project's exact next item", () => {
    const fx = fixture();
    const requestLog = join(fx.root, "curl-request.txt");
    executable(
      join(fx.bin, "curl"),
      `printf '%s\\n' "$*" > '${requestLog}'\nprintf '%s' '{"data":{"issues":{"nodes":[{"identifier":"BUI-42","priority":1,"createdAt":"2026-01-01","project":{"name":"claude-setup"}},{"identifier":"OTHER-1","priority":1,"createdAt":"2025-01-01","project":{"name":"other"}}]}}}'`,
    );
    const result = spawnSync(
      "bash",
      [
        loop,
        "--linear-project",
        "claude-setup",
        "--target-dir",
        fx.target,
        "--dry-run",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          SETUP_REPO: fx.setup,
          CURL_BIN: join(fx.bin, "curl"),
          LINEAR_API_KEY: "test-token",
          CLAUDE_USAGE_COMMAND: fx.usage,
          XDG_STATE_HOME: join(fx.root, "operator-state"),
          TMPDIR: fx.root,
        },
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("next issue=BUI-42");
    expect(result.stdout).toContain("reason=dry-run");
    expect(result.stderr).not.toContain("claude-must-not-run");
    expect(
      execFileSync(
        "grep",
        ["-o", '\\"project\\": \\"claude-setup\\"', requestLog],
        { encoding: "utf8" },
      ),
    ).toContain("claude-setup");
  });

  it("attributes completion to exactly one reviewed commit for the selected issue", () => {
    const fx = fixture();
    const before = execFileSync("git", ["rev-parse", "main"], {
      cwd: fx.target,
      encoding: "utf8",
    }).trim();
    writeFileSync(join(fx.target, "result.txt"), "done\n");
    execFileSync("git", ["add", "result.txt"], { cwd: fx.target });
    execFileSync(
      "git",
      [
        "commit",
        "-m",
        "fix: complete BUI-42",
        "-m",
        "Reviewed-By: codex (status=approve)",
      ],
      { cwd: fx.target },
    );
    const receipt = execFileSync("git", ["rev-parse", "main"], {
      cwd: fx.target,
      encoding: "utf8",
    }).trim();
    writeFileSync(join(fx.target, "unrelated.txt"), "other\n");
    execFileSync("git", ["add", "unrelated.txt"], { cwd: fx.target });
    execFileSync("git", ["commit", "-m", "chore: unrelated concurrent merge"], {
      cwd: fx.target,
    });
    const after = execFileSync("git", ["rev-parse", "main"], {
      cwd: fx.target,
      encoding: "utf8",
    }).trim();
    const sourceAndCall = `issue_arg="$1"; set -- --linear-project claude-setup --target-dir '${fx.target}'; OVERNIGHT_LOOP_LIB_ONLY=1 source '${loop}'; issue_receipt '${before}' '${after}' "$issue_arg"`;

    expect(
      execFileSync("bash", ["-c", sourceAndCall, "receipt-test", "BUI-42"], {
        encoding: "utf8",
        env: { ...process.env, SETUP_REPO: fx.setup },
      }).trim(),
    ).toBe(receipt);
    const mismatch = spawnSync(
      "bash",
      ["-c", sourceAndCall, "receipt-test", "BUI-4"],
      {
        encoding: "utf8",
        env: { ...process.env, SETUP_REPO: fx.setup },
      },
    );
    expect(mismatch.status).not.toBe(0);
  }, 15000);
});
