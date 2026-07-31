import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "./helpers/tmp.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const POLICY = path.join(ROOT, "scripts", "quality-provider-policy.sh");

function resolvePolicy(env = {}) {
  return execFileSync(
    "bash",
    [
      "-c",
      `source "${POLICY}" || exit $?; printf '%s/%s' "$QUALITY_PRIMARY" "$QUALITY_FALLBACK"`,
    ],
    { encoding: "utf8", env: { ...process.env, ...env } },
  );
}

function resolvePolicyResult(env = {}) {
  return spawnSync(
    "bash",
    [
      "-c",
      `source "${POLICY}" || exit $?; printf '%s/%s' "$QUALITY_PRIMARY" "$QUALITY_FALLBACK"`,
    ],
    { encoding: "utf8", env: { ...process.env, ...env } },
  );
}

describe("quality provider policy", () => {
  it("defaults to the invoking provider with no fallback", () => {
    expect(
      resolvePolicy({
        HOME: makeTempDir("qpp-"),
        CODEX_THREAD_ID: "test-thread",
      }),
    ).toBe("codex/none");
  });

  it("reads a preference shared by Claude Code and Codex", () => {
    const home = makeTempDir("qpp-");
    const config = path.join(home, "providers.json");
    writeFileSync(config, '{"primary":"codex","fallback":"claude"}\n');
    expect(
      resolvePolicy({ HOME: home, BS_QUALITY_PROVIDER_CONFIG: config }),
    ).toBe("codex/claude");
  });

  it("normalizes an auto policy that resolves to its configured fallback", () => {
    const home = makeTempDir("qpp-");
    const config = path.join(home, "providers.json");
    writeFileSync(config, '{"primary":"auto","fallback":"codex"}\n');
    expect(
      resolvePolicy({
        HOME: home,
        CODEX_THREAD_ID: "test-thread",
        BS_QUALITY_PROVIDER_CONFIG: config,
      }),
    ).toBe("codex/none");
  });

  it("lets explicit environment policy override the file", () => {
    const home = makeTempDir("qpp-");
    const config = path.join(home, "providers.json");
    writeFileSync(config, '{"primary":"codex","fallback":"claude"}\n');
    expect(
      resolvePolicy({
        HOME: home,
        BS_QUALITY_PROVIDER_CONFIG: config,
        BS_QUALITY_PRIMARY: "claude",
        BS_QUALITY_FALLBACK: "none",
      }),
    ).toBe("claude/none");
  });

  it("accepts Gemini as an explicit governed provider", () => {
    expect(
      resolvePolicy({
        HOME: makeTempDir("qpp-"),
        BS_QUALITY_PRIMARY: "gemini",
        BS_QUALITY_FALLBACK: "none",
      }),
    ).toBe("gemini/none");
  });

  it("fails closed when the provider policy is invalid", () => {
    const result = resolvePolicyResult({
      HOME: makeTempDir("qpp-"),
      BS_QUALITY_PRIMARY: "unknown-provider",
      BS_QUALITY_FALLBACK: "none",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/invalid provider policy/);
  });
});
