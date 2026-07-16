import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const POLICY = path.join(ROOT, "scripts", "quality-provider-policy.sh");

function resolvePolicy(env = {}) {
  return execFileSync(
    "bash",
    [
      "-c",
      `source "${POLICY}"; printf '%s/%s' "$QUALITY_PRIMARY" "$QUALITY_FALLBACK"`,
    ],
    { encoding: "utf8", env: { ...process.env, ...env } },
  );
}

describe("quality provider policy", () => {
  it("keeps the public backwards-compatible default", () => {
    expect(
      resolvePolicy({ HOME: mkdtempSync(path.join(tmpdir(), "qpp-")) }),
    ).toBe("claude/codex");
  });

  it("reads a preference shared by Claude Code and Codex", () => {
    const home = mkdtempSync(path.join(tmpdir(), "qpp-"));
    const config = path.join(home, "providers.json");
    writeFileSync(config, '{"primary":"codex","fallback":"claude"}\n');
    expect(
      resolvePolicy({ HOME: home, BS_QUALITY_PROVIDER_CONFIG: config }),
    ).toBe("codex/claude");
  });

  it("lets explicit environment policy override the file", () => {
    const home = mkdtempSync(path.join(tmpdir(), "qpp-"));
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
});
