import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");
const RUNTIME = join(ROOT, "scripts", "autonomous-loop-runtime.js");
const temporaryRoots = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "autonomous-loop-runtime-"));
  temporaryRoots.push(root);
  return {
    root,
    state: join(root, "operator-state"),
    repo: join(root, "repo"),
  };
}

function executable(file, body) {
  writeFileSync(file, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

function usageAdapter(root, payload) {
  return executable(
    join(root, `usage-${temporaryRoots.length}.sh`),
    `printf '%s' '${JSON.stringify(payload)}'`,
  );
}

function runtime(args, options = {}) {
  return spawnSync("node", [RUNTIME, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...options.env },
  });
}

function response(result) {
  return JSON.parse(result.status === 0 ? result.stdout : result.stderr);
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("autonomous-loop runtime", () => {
  it("shares the two-loop cap across otherwise independent repositories", () => {
    const fx = fixture();
    const adapter = usageAdapter(fx.root, {
      fiveHourPercent: 12,
      sevenDayPercent: 18,
    });
    const common = [
      "--state-dir",
      fx.state,
      "--usage-command",
      adapter,
      "--max-loops",
      "2",
    ];

    const first = runtime([
      "admit",
      "--kind",
      "ralph",
      "--id",
      "repo-one/run",
      ...common,
    ]);
    const second = runtime([
      "admit",
      "--kind",
      "quality",
      "--id",
      "repo-two/run",
      ...common,
    ]);
    const third = runtime([
      "admit",
      "--kind",
      "merge-train",
      "--id",
      "repo-three/run",
      ...common,
    ]);

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(response(third)).toMatchObject({
      ok: false,
      code: "CONCURRENCY_CAP",
    });
    expect(response(first).usage).toEqual({
      fiveHourPercent: 12,
      sevenDayPercent: 18,
    });
  });

  it("fails closed when account-usage evidence is absent or at the configured cap", () => {
    const fx = fixture();
    const unavailable = runtime([
      "admit",
      "--kind",
      "ralph",
      "--id",
      "unavailable",
      "--state-dir",
      fx.state,
      "--usage-command",
      join(fx.root, "not-installed"),
    ]);
    expect(response(unavailable)).toMatchObject({
      ok: false,
      code: "USAGE_UNAVAILABLE",
    });

    const capped = runtime([
      "admit",
      "--kind",
      "ralph",
      "--id",
      "capped",
      "--state-dir",
      fx.state,
      "--usage-command",
      usageAdapter(fx.root, { fiveHourPercent: 70, sevenDayPercent: 9 }),
      "--max-utilization-percent",
      "70",
    ]);
    expect(response(capped)).toMatchObject({ ok: false, code: "USAGE_CAP" });

    const telemetry = readFileSync(join(fx.state, "telemetry.jsonl"), "utf8");
    expect(telemetry).toContain('"result":"usage-unavailable"');
    expect(telemetry).toContain('"result":"usage-cap"');
    expect(telemetry).not.toContain("not-installed");
  });

  it("persists a context-cap handoff without changing completed backlog state", () => {
    const fx = fixture();
    const state = join(fx.root, "ralph-state.json");
    writeFileSync(
      state,
      JSON.stringify({
        queue: ["BUI-414", "BUI-415"],
        completed: ["BUI-414"],
        current: "BUI-415",
      }),
    );

    const result = runtime([
      "context-break",
      "--state",
      state,
      "--observed-tokens",
      "80000",
      "--cap-tokens",
      "80000",
    ]);
    const persisted = JSON.parse(readFileSync(state, "utf8"));

    expect(response(result)).toMatchObject({ ok: true, breakRequired: true });
    expect(persisted).toMatchObject({
      queue: ["BUI-414", "BUI-415"],
      completed: ["BUI-414"],
      current: "BUI-415",
      continuation: {
        reason: "context-cap",
        observedTokens: 80000,
        capTokens: 80000,
      },
    });
  });

  it("launches a fresh campaign without passing a parent session or resume flag", () => {
    const fx = fixture();
    const handoff = join(fx.root, "handoff.json");
    const capture = join(fx.root, "claude-call.json");
    writeFileSync(
      handoff,
      JSON.stringify({ continuation: { reason: "context-cap" } }),
    );
    const fakeClaude = executable(
      join(fx.root, "claude"),
      `node -e 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({ argv: process.argv.slice(2), session: process.env.CLAUDE_CODE_SESSION_ID || null }))' '${capture}' "$@"`,
    );

    const result = runtime(
      [
        "fresh-launch",
        "--handoff",
        handoff,
        "--target-dir",
        fx.root,
        "--workflow",
        "ralph",
        "--claude-bin",
        fakeClaude,
      ],
      { env: { CLAUDE_CODE_SESSION_ID: "parent-session" } },
    );
    const launched = JSON.parse(readFileSync(capture, "utf8"));

    expect(result.status).toBe(0);
    expect(launched.session).toBeNull();
    expect(launched.argv).toContain("--no-session-persistence");
    expect(launched.argv).not.toContain("--resume");
    expect(launched.argv).not.toContain("--continue");
    expect(launched.argv).not.toContain("--fork-session");
    expect(launched.argv.at(-1)).toContain(handoff);
  });
});
