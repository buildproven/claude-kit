import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "./helpers/tmp.js";

const GUARD = path.resolve(
  import.meta.dirname,
  "..",
  "quality-codex-cache-guard.sh",
);
const HOME_SELECTOR = path.resolve(
  import.meta.dirname,
  "..",
  "quality-codex-home.sh",
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
    expect(stderr).toMatch(/using the fallback/);
  });

  it("keeps quality cache healthy when a competing client rewrites the source cache", () => {
    const sourceHome = makeTempDir("codex-source-");
    const stateRoot = makeTempDir("codex-quality-state-");
    const binDir = makeTempDir("codex-bin-");
    const sourceCache = path.join(sourceHome, "models_cache.json");
    const authPath = path.join(sourceHome, "auth.json");
    const execCount = path.join(binDir, "exec-count");
    writeFileSync(authPath, "test-auth-placeholder");
    writeFileSync(
      sourceCache,
      '{"client_version":"0.200.0","models":[{"slug":"desktop"}]}',
    );
    writeFileSync(
      path.join(binDir, "codex"),
      `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "codex-cli 0.149.1"; exit 0; fi
if [ "$1" = "exec" ]; then
  count=0; [ ! -f "${execCount}" ] || count="$(cat "${execCount}")"
  printf '%s' "$((count + 1))" > "${execCount}"
  printf '%s' '{"client_version":"0.149.1","models":[{"slug":"review"}]}' > "$CODEX_HOME/models_cache.json"
fi
`,
      { mode: 0o755 },
    );
    const env = {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      QUALITY_CODEX_SOURCE_HOME: sourceHome,
      QUALITY_CODEX_STATE_ROOT: stateRoot,
    };
    const firstHome = spawnSync("bash", [HOME_SELECTOR], {
      encoding: "utf8",
      env,
    }).stdout.trim();
    const secondHome = spawnSync("bash", [HOME_SELECTOR], {
      encoding: "utf8",
      env,
    }).stdout.trim();
    expect(secondHome).toBe(firstHome);
    expect(realpathSync(path.join(firstHome, "auth.json"))).toBe(
      realpathSync(authPath),
    );

    const reviewEnv = { ...env, CODEX_HOME: firstHome };
    const first = spawnSync("bash", [GUARD], {
      encoding: "utf8",
      env: reviewEnv,
    });
    expect(first.status).toBe(0);
    expect(first.stderr).toMatch(/refreshed/);
    writeFileSync(
      sourceCache,
      '{"client_version":"0.201.0","models":[{"slug":"desktop-new"}]}',
    );
    const second = spawnSync("bash", [GUARD], {
      encoding: "utf8",
      env: reviewEnv,
    });
    expect(second.status).toBe(0);
    expect(second.stderr).toBe("");
    expect(readFileSync(execCount, "utf8")).toBe("1");
    expect(readFileSync(sourceCache, "utf8")).toContain("0.201.0");
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
