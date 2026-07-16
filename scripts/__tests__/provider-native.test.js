import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const PROVIDER_RUN = path.join(ROOT, "scripts", "provider-run.sh");
const SKILL_SYNC = path.join(ROOT, "scripts", "setup-codex-skills.sh");
const MCP_SYNC = path.join(ROOT, "scripts", "mcp-sync.py");
const DISCOVER = path.join(
  ROOT,
  "scripts",
  "steward",
  "discover-active-repos.py",
);
const SURFACE = path.join(ROOT, "scripts", "surface-audit.js");

function executable(file, body) {
  writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(file, 0o755);
}

describe("provider-native platform", () => {
  it("falls back immediately on a surfaced quota response", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "provider-native-"));
    const bin = path.join(dir, "bin");
    const output = path.join(dir, "output");
    const prompt = path.join(dir, "prompt");
    mkdirSync(bin);
    writeFileSync(prompt, "review this\n");
    executable(
      path.join(bin, "codex"),
      'echo "HTTP 429: weekly usage limit; try again at tomorrow" >&2; exit 1',
    );
    executable(path.join(bin, "claude"), 'echo "claude fallback completed"');

    const result = spawnSync(
      "bash",
      [
        PROVIDER_RUN,
        "--prompt-file",
        prompt,
        "--target-dir",
        dir,
        "--provider",
        "codex",
        "--fallback",
        "claude",
        "--output-dir",
        output,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("codex exhausted");
    expect(result.stderr).toContain("trying claude");
    expect(result.stdout).toContain("claude fallback completed");
    expect(readFileSync(path.join(output, "provider"), "utf8").trim()).toBe(
      "claude",
    );
  });

  it("installs only allowlisted native Codex skills and detects drift", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "codex-skills-"));
    const source = path.join(dir, "source");
    const target = path.join(dir, "target");
    mkdirSync(path.join(source, "keep"), { recursive: true });
    mkdirSync(path.join(source, "skip"), { recursive: true });
    writeFileSync(path.join(source, "keep", "SKILL.md"), "# Keep\n");
    writeFileSync(path.join(source, "skip", "SKILL.md"), "# Skip\n");
    const allowlist = path.join(dir, "allowlist.json");
    writeFileSync(allowlist, '{"skills":["keep"]}\n');

    execFileSync("bash", [
      SKILL_SYNC,
      "--source",
      source,
      "--allowlist",
      allowlist,
      "--target",
      target,
    ]);
    expect(readlinkSync(path.join(target, "keep"))).toBe(
      path.join(source, "keep"),
    );
    expect(
      spawnSync("bash", [
        SKILL_SYNC,
        "--source",
        source,
        "--allowlist",
        allowlist,
        "--target",
        target,
        "--check",
      ]).status,
    ).toBe(0);

    unlinkSync(path.join(target, "keep"));
    symlinkSync(path.join(source, "skip"), path.join(target, "keep"));
    expect(
      spawnSync("bash", [
        SKILL_SYNC,
        "--source",
        source,
        "--allowlist",
        allowlist,
        "--target",
        target,
        "--check",
      ]).status,
    ).toBe(1);
  });

  it("discovers active non-bot repos and open-PR repos from fixtures", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "fleet-discovery-"));
    const config = path.join(dir, "fleet.json");
    const fixture = path.join(dir, "repos.json");
    writeFileSync(
      config,
      JSON.stringify({
        owners: ["buildproven"],
        windowDays: 14,
        minimumCommits: 2,
        localRoots: [],
        include: [],
        exclude: [],
      }),
    );
    writeFileSync(
      fixture,
      JSON.stringify([
        {
          nameWithOwner: "buildproven/active",
          commits: [
            { author: { login: "brett" } },
            { author: { login: "dependabot[bot]", type: "Bot" } },
          ],
          pullRequests: [],
        },
        {
          nameWithOwner: "buildproven/pr-only",
          commits: [],
          pullRequests: [{ isDraft: false }],
        },
        {
          nameWithOwner: "buildproven/bots-only",
          commits: [
            { author: { login: "dependabot[bot]", type: "Bot" } },
            { author: { login: "renovate[bot]", type: "Bot" } },
          ],
          pullRequests: [],
        },
      ]),
    );

    const payload = JSON.parse(
      execFileSync("python3", [
        DISCOVER,
        "--config",
        config,
        "--fixture",
        fixture,
      ]),
    );
    expect(payload.repositories.map((repo) => repo.nameWithOwner)).toEqual([
      "buildproven/active",
      "buildproven/pr-only",
    ]);
  });

  it("syncs the same declarative MCP server into both clients", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mcp-sync-"));
    const bin = path.join(dir, "bin");
    const calls = path.join(dir, "calls");
    mkdirSync(bin);
    const body = `printf '%s %s\\n' "$(basename "$0")" "$*" >> '${calls}'\nif [ "$1 $2" = "mcp list" ]; then exit 0; fi`;
    executable(path.join(bin, "claude"), body);
    executable(path.join(bin, "codex"), body);
    const manifest = path.join(dir, "mcp.json");
    writeFileSync(
      manifest,
      JSON.stringify({
        servers: [
          {
            name: "shared",
            transport: "http",
            url: "https://example.test/mcp",
            clients: ["claude", "codex"],
          },
        ],
      }),
    );

    const result = spawnSync("python3", [MCP_SYNC, "--manifest", manifest], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
    expect(result.status).toBe(0);
    const logged = readFileSync(calls, "utf8");
    expect(logged).toContain(
      "claude mcp add --scope user --transport http shared https://example.test/mcp",
    );
    expect(logged).toContain(
      "codex mcp add shared --url https://example.test/mcp",
    );
  });

  it("keeps the public command surface within its budget", () => {
    const report = JSON.parse(
      execFileSync("node", [SURFACE, "--json"], {
        cwd: ROOT,
        encoding: "utf8",
      }),
    );
    expect(report.overBudget).toBe(false);
    expect(report.commandCount).toBeLessThanOrEqual(24);
  });
});
