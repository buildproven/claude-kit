import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "./helpers/tmp.js";

const GUARD = path.resolve(
  import.meta.dirname,
  "..",
  "quality-codex-cache-guard.sh",
);

// Run the guard with a fake `codex` on PATH and an isolated CODEX_HOME so the
// probe/refresh logic is exercised without touching the real ~/.codex.
function runGuard({ codexVersion, cache, regenWrites }) {
  const home = makeTempDir("codex-guard-");
  const binDir = makeTempDir("codex-bin-");
  const cachePath = path.join(home, "models_cache.json");
  if (cache !== undefined) writeFileSync(cachePath, cache);

  // Fake codex: `--version` prints the version; `exec` writes regenWrites to the
  // cache (simulating what real codex regeneration produces — healthy or not).
  const fake = `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "codex-cli ${codexVersion}"; exit 0; fi
if [ "$1" = "exec" ]; then
  ${regenWrites !== undefined ? `printf '%s' '${regenWrites}' > "${cachePath}"` : ":"}
  exit 0
fi
exit 0
`;
  writeFileSync(path.join(binDir, "codex"), fake, { mode: 0o755 });

  const res = spawnSync("bash", [GUARD], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      CODEX_HOME: home,
    },
  });
  return { code: res.status, stderr: res.stderr, cachePath };
}

describe("quality-codex-cache-guard", () => {
  it("exit 0 when the cache already matches the installed codex", () => {
    const { code } = runGuard({
      codexVersion: "0.144.6",
      cache: '{"client_version":"0.144.6","models":[{"slug":"x"}]}',
    });
    expect(code).toBe(0);
  });

  it("refreshes and exits 0 when regeneration produces a matching cache", () => {
    const { code, stderr } = runGuard({
      codexVersion: "0.144.6",
      cache: '{"client_version":"0.145.0","models":[{"slug":"x"}]}', // stale
      regenWrites: '{"client_version":"0.144.6","models":[{"slug":"x"}]}', // healed
    });
    expect(code).toBe(0);
    expect(stderr).toMatch(/refreshed/);
  });

  it("exits 1 (skip codex → fallback) when regen keeps writing an incompatible cache", () => {
    const { code, stderr } = runGuard({
      codexVersion: "0.144.6",
      cache: '{"client_version":"0.145.0","models":[{"slug":"x"}]}',
      regenWrites: '{"client_version":"0.145.0","models":[{"slug":"x"}]}', // desktop app rewins
    });
    expect(code).toBe(1);
    expect(stderr).toMatch(/cannot be won|using the fallback/);
  });

  it("exits 1 on a corrupt cache that regen can't fix", () => {
    const { code } = runGuard({
      codexVersion: "0.144.6",
      cache: "not json",
      regenWrites: "still not json",
    });
    expect(code).toBe(1);
  });

  it("exits 0 (defers to runner) when codex is not installed", () => {
    // No fake codex on PATH → command -v codex fails.
    const home = makeTempDir("codex-guard-");
    const res = spawnSync("bash", [GUARD], {
      encoding: "utf8",
      env: { ...process.env, PATH: "/usr/bin:/bin", CODEX_HOME: home },
    });
    expect(res.status).toBe(0);
  });
});
