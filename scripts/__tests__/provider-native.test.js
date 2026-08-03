import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "./helpers/tmp.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const PROVIDER_RUN = path.join(ROOT, "scripts", "provider-run.sh");
const SKILL_SYNC = path.join(ROOT, "scripts", "setup-codex-skills.sh");
const MCP_SYNC = path.join(ROOT, "scripts", "mcp-sync.py");
const AUDIT_REPO = path.join(ROOT, "scripts", "steward", "audit-repo.sh");
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
  it("invokes codex exec without the removed -a/--ask-for-approval flag", () => {
    const source = readFileSync(PROVIDER_RUN, "utf8");
    const invocation = source
      .split("\n")
      .find((line) => line.includes("codex exec --ephemeral"));
    expect(invocation).toBeTruthy();
    // `codex exec` dropped -a/--ask-for-approval; approvals are governed by -s
    // <sandbox>. Passing -a makes codex exit rc=2 ("unexpected argument"),
    // which is not in provider-run's 74/75/76 fallback set, so the whole run
    // hard-fails instead of degrading to the fallback provider.
    expect(invocation).not.toMatch(/\s-a\s/);
    expect(invocation).not.toMatch(/--ask-for-approval/);
    expect(invocation).toMatch(/-s "\$SANDBOX"/);
  });

  it("starts Claude provider work without resuming a parent transcript", () => {
    const source = readFileSync(PROVIDER_RUN, "utf8");
    const invocation = source
      .split("\n")
      .find((line) => line.includes('claude -p "$(cat "$PROMPT_FILE")"'));
    expect(invocation).toContain("--no-session-persistence");
    expect(invocation).not.toContain("--resume");
    expect(invocation).not.toContain("--continue");
    expect(invocation).not.toContain("--fork-session");
  });

  it("keeps cc:update-claudemd bounded and avoids no-op commits", () => {
    const command = readFileSync(
      path.join(ROOT, "commands", "cc", "update-claudemd.md"),
      "utf8",
    );
    expect(command).toContain("wc -l CLAUDE.md");
    expect(command).toMatch(/\*\*at most \+10 lines\*\*/);
    expect(command).toMatch(
      /make no\s+edit and do not create an empty documentation commit/i,
    );
    expect(command).toMatch(/replace, consolidate, or remove/i);
    expect(command).toContain("if git diff --quiet -- CLAUDE.md; then");
    expect(command).toMatch(
      /No stable CLAUDE\.md update; nothing to commit\.[\s\S]*else[\s\S]*git add CLAUDE\.md[\s\S]*git commit/,
    );
  });

  it("classifies every Claude skill and keeps Ralph discoverable", () => {
    const settings = JSON.parse(
      readFileSync(path.join(ROOT, "config", "settings.json"), "utf8"),
    );
    const names = readdirSync(path.join(ROOT, "skills"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(Object.keys(settings.skillOverrides).sort()).toEqual(names);
    expect(settings.skillOverrides.ralph).toBe("on");
    for (const skill of ["ralph", "quality"]) {
      expect(
        readFileSync(path.join(ROOT, "skills", skill, "SKILL.md"), "utf8"),
      ).not.toMatch(/^context: fork$/m);
    }
    expect(settings.hooks.PreCompact).toBeUndefined();
    expect(settings.hooks.PostToolUse).toHaveLength(1);
  });

  it("falls back immediately on a structured quota error event (BUI-325)", () => {
    const dir = makeTempDir("provider-native-");
    const bin = path.join(dir, "bin");
    const output = path.join(dir, "output");
    const prompt = path.join(dir, "prompt");
    mkdirSync(bin);
    writeFileSync(prompt, "review this\n");
    // Real codex --json emits a typed error EVENT on stdout, not free text;
    // classification must key off that structured envelope, not a grep of
    // the transcript.
    executable(
      path.join(bin, "codex"),
      [
        'for arg in "$@"; do',
        '  if [ "$arg" = "-o" ]; then shift_next=1; continue; fi',
        '  if [ "${shift_next:-0}" = 1 ]; then last_message="$arg"; shift_next=0; fi',
        "done",
        'echo "final answer text" > "$last_message"',
        'echo \'{"type":"error","message":"You\\u0027ve hit your usage limit. Purchase more credits or try again at Jul 25th, 2026 10:57 AM."}\'',
        "exit 1",
      ].join("\n"),
    );
    executable(
      path.join(bin, "claude"),
      'echo \'{"is_error":false,"result":"claude fallback completed"}\'',
    );

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

  it("does not classify incidental exhaustion-marker text in the transcript as exhaustion (BUI-325)", () => {
    const dir = makeTempDir("provider-native-fp-");
    const bin = path.join(dir, "bin");
    const output = path.join(dir, "output");
    const prompt = path.join(dir, "prompt");
    mkdirSync(bin);
    writeFileSync(prompt, "review this\n");
    // A successful codex run whose transcript (tool output / agent message)
    // happens to mention "429" and "weekly usage limits" — e.g. because the
    // agent read this repo's own quality docs — must NOT be classified as
    // exhausted. Only a typed error event on a failed run may do that.
    executable(
      path.join(bin, "codex"),
      [
        'for arg in "$@"; do',
        '  if [ "$arg" = "-o" ]; then shift_next=1; continue; fi',
        '  if [ "${shift_next:-0}" = 1 ]; then last_message="$arg"; shift_next=0; fi',
        "done",
        'echo "Docs mention HTTP 429 and weekly usage limits; nothing wrong here." > "$last_message"',
        'echo \'{"type":"item.completed","item":{"type":"agent_message","text":"HTTP 429 weekly usage limits quota exhausted rate limit"}}\'',
        "exit 0",
      ].join("\n"),
    );

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
        "none",
        "--output-dir",
        output,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("exhausted");
    expect(result.stdout).toContain(
      "Docs mention HTTP 429 and weekly usage limits",
    );
    expect(readFileSync(path.join(output, "provider"), "utf8").trim()).toBe(
      "codex",
    );
  });

  it("classifies claude exhaustion from a status-0 error envelope (BUI-325)", () => {
    const dir = makeTempDir("provider-native-claude-exh-");
    const bin = path.join(dir, "bin");
    const output = path.join(dir, "output");
    const prompt = path.join(dir, "prompt");
    mkdirSync(bin);
    writeFileSync(prompt, "review this\n");
    // Some provider CLIs report is_error inside a status-0 JSON envelope
    // rather than a nonzero exit code. The claude branch must classify from
    // that structured envelope even when rc=0, not just from rc alone.
    executable(
      path.join(bin, "claude"),
      [
        'echo \'{"is_error":true,"result":"You have hit your usage limit. Try again at Jul 25th, 2026 10:57 AM."}\'',
        "exit 0",
      ].join("\n"),
    );

    const result = spawnSync(
      "bash",
      [
        PROVIDER_RUN,
        "--prompt-file",
        prompt,
        "--target-dir",
        dir,
        "--provider",
        "claude",
        "--fallback",
        "none",
        "--output-dir",
        output,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("claude exhausted");
  });

  it("does not classify a successful claude status-0 envelope as exhausted (BUI-325)", () => {
    const dir = makeTempDir("provider-native-claude-ok-");
    const bin = path.join(dir, "bin");
    const output = path.join(dir, "output");
    const prompt = path.join(dir, "prompt");
    mkdirSync(bin);
    writeFileSync(prompt, "review this\n");
    executable(
      path.join(bin, "claude"),
      'echo \'{"is_error":false,"result":"claude completed cleanly"}\'',
    );

    const result = spawnSync(
      "bash",
      [
        PROVIDER_RUN,
        "--prompt-file",
        prompt,
        "--target-dir",
        dir,
        "--provider",
        "claude",
        "--fallback",
        "none",
        "--output-dir",
        output,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("exhausted");
    expect(result.stdout).toContain("claude completed cleanly");
    expect(readFileSync(path.join(output, "provider"), "utf8").trim()).toBe(
      "claude",
    );
  });

  it("installs only allowlisted native Codex skills and detects drift", () => {
    const dir = makeTempDir("codex-skills-");
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

  it("keeps Codex skill check mode read-only", () => {
    const dir = makeTempDir("codex-skills-check-");
    const source = path.join(dir, "source");
    const target = path.join(dir, "missing-target");
    const allowlist = path.join(dir, "allowlist.json");
    mkdirSync(path.join(source, "keep"), { recursive: true });
    writeFileSync(path.join(source, "keep", "SKILL.md"), "# Keep\n");
    writeFileSync(allowlist, '{"skills":["keep"]}\n');

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
    expect(existsSync(target)).toBe(false);
  });

  it("removes only stale skills owned by the previous managed manifest", () => {
    const dir = makeTempDir("codex-skill-prune-");
    const source = path.join(dir, "source");
    const target = path.join(dir, "target");
    mkdirSync(path.join(source, "keep"), { recursive: true });
    mkdirSync(path.join(source, "drop"), { recursive: true });
    mkdirSync(path.join(source, "unmanaged"), { recursive: true });
    for (const name of ["keep", "drop", "unmanaged"]) {
      writeFileSync(path.join(source, name, "SKILL.md"), `# ${name}\n`);
    }
    const allowlist = path.join(dir, "allowlist.json");
    writeFileSync(allowlist, '{"skills":["keep","drop"]}\n');

    execFileSync("bash", [
      SKILL_SYNC,
      "--source",
      source,
      "--allowlist",
      allowlist,
      "--target",
      target,
    ]);
    symlinkSync(path.join(source, "unmanaged"), path.join(target, "unmanaged"));
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
    expect(() => readlinkSync(path.join(target, "drop"))).toThrow();
    expect(readlinkSync(path.join(target, "unmanaged"))).toBe(
      path.join(source, "unmanaged"),
    );
  });

  it("rejects invalid allowlists without pruning managed skills", () => {
    const dir = makeTempDir("codex-skill-invalid-");
    const source = path.join(dir, "source");
    const target = path.join(dir, "target");
    const allowlist = path.join(dir, "allowlist.json");
    mkdirSync(path.join(source, "keep"), { recursive: true });
    writeFileSync(path.join(source, "keep", "SKILL.md"), "# keep\n");
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
    writeFileSync(allowlist, "not json\n");

    expect(
      spawnSync("bash", [
        SKILL_SYNC,
        "--source",
        source,
        "--allowlist",
        allowlist,
        "--target",
        target,
      ]).status,
    ).toBe(1);
    expect(readlinkSync(path.join(target, "keep"))).toBe(
      path.join(source, "keep"),
    );
  });

  it("preflights conflicts before removing stale managed skills", () => {
    const dir = makeTempDir("codex-skill-conflict-");
    const source = path.join(dir, "source");
    const target = path.join(dir, "target");
    const allowlist = path.join(dir, "allowlist.json");
    for (const name of ["drop", "blocked"]) {
      mkdirSync(path.join(source, name), { recursive: true });
      writeFileSync(path.join(source, name, "SKILL.md"), `# ${name}\n`);
    }
    writeFileSync(allowlist, '{"skills":["drop"]}\n');
    execFileSync("bash", [
      SKILL_SYNC,
      "--source",
      source,
      "--allowlist",
      allowlist,
      "--target",
      target,
    ]);
    writeFileSync(path.join(target, "blocked"), "unmanaged\n");
    writeFileSync(allowlist, '{"skills":["blocked"]}\n');

    expect(
      spawnSync("bash", [
        SKILL_SYNC,
        "--source",
        source,
        "--allowlist",
        allowlist,
        "--target",
        target,
      ]).status,
    ).toBe(1);
    expect(readlinkSync(path.join(target, "drop"))).toBe(
      path.join(source, "drop"),
    );
  });

  it("rejects unknown allowlisted names before pruning managed skills", () => {
    const dir = makeTempDir("codex-skill-unknown-");
    const source = path.join(dir, "source");
    const target = path.join(dir, "target");
    const allowlist = path.join(dir, "allowlist.json");
    mkdirSync(path.join(source, "keep"), { recursive: true });
    writeFileSync(path.join(source, "keep", "SKILL.md"), "# keep\n");
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
    writeFileSync(allowlist, '{"skills":["kepe"]}\n');

    expect(
      spawnSync("bash", [
        SKILL_SYNC,
        "--source",
        source,
        "--allowlist",
        allowlist,
        "--target",
        target,
      ]).status,
    ).toBe(1);
    expect(readlinkSync(path.join(target, "keep"))).toBe(
      path.join(source, "keep"),
    );
  });

  it("uses the last source for duplicate skill names without partial sync", () => {
    const dir = makeTempDir("codex-skill-overlay-");
    const base = path.join(dir, "base");
    const overlay = path.join(dir, "overlay");
    const target = path.join(dir, "target");
    const allowlist = path.join(dir, "allowlist.json");
    for (const source of [base, overlay]) {
      mkdirSync(path.join(source, "shared"), { recursive: true });
      writeFileSync(path.join(source, "shared", "SKILL.md"), "# shared\n");
    }
    writeFileSync(allowlist, '{"skills":["shared"]}\n');

    execFileSync("bash", [
      SKILL_SYNC,
      "--source",
      base,
      "--source",
      overlay,
      "--allowlist",
      allowlist,
      "--target",
      target,
    ]);

    expect(readlinkSync(path.join(target, "shared"))).toBe(
      path.join(overlay, "shared"),
    );
  });

  it("retargets a previously managed skill and rolls back a failed transition", () => {
    const dir = makeTempDir("codex-skill-retarget-");
    const base = path.join(dir, "base");
    const overlay = path.join(dir, "overlay");
    const target = path.join(dir, "target");
    const bin = path.join(dir, "bin");
    const allowlist = path.join(dir, "allowlist.json");
    for (const source of [base, overlay]) {
      mkdirSync(path.join(source, "shared"), { recursive: true });
      writeFileSync(path.join(source, "shared", "SKILL.md"), "# shared\n");
    }
    writeFileSync(allowlist, '{"skills":["shared"]}\n');
    execFileSync("bash", [
      SKILL_SYNC,
      "--source",
      base,
      "--allowlist",
      allowlist,
      "--target",
      target,
    ]);

    mkdirSync(bin);
    executable(path.join(bin, "ln"), "exit 1");
    expect(
      spawnSync(
        "bash",
        [
          SKILL_SYNC,
          "--source",
          base,
          "--source",
          overlay,
          "--allowlist",
          allowlist,
          "--target",
          target,
        ],
        { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } },
      ).status,
    ).toBe(1);
    expect(readlinkSync(path.join(target, "shared"))).toBe(
      path.join(base, "shared"),
    );

    execFileSync("bash", [
      SKILL_SYNC,
      "--source",
      base,
      "--source",
      overlay,
      "--allowlist",
      allowlist,
      "--target",
      target,
    ]);
    expect(readlinkSync(path.join(target, "shared"))).toBe(
      path.join(overlay, "shared"),
    );
  });

  it("rejects overlapping syncs without changing managed state", () => {
    const dir = makeTempDir("codex-skill-lock-");
    const source = path.join(dir, "source");
    const target = path.join(dir, "target");
    const allowlist = path.join(dir, "allowlist.json");
    mkdirSync(path.join(source, "keep"), { recursive: true });
    mkdirSync(path.join(target, ".buildproven-sync.lock"), { recursive: true });
    writeFileSync(path.join(source, "keep", "SKILL.md"), "# keep\n");
    writeFileSync(allowlist, '{"skills":["keep"]}\n');

    expect(
      spawnSync("bash", [
        SKILL_SYNC,
        "--source",
        source,
        "--allowlist",
        allowlist,
        "--target",
        target,
      ]).status,
    ).toBe(1);
    expect(() => readlinkSync(path.join(target, "keep"))).toThrow();
  });

  it("recovers a stale owned sync lock", () => {
    const dir = makeTempDir("codex-skill-stale-lock-");
    const source = path.join(dir, "source");
    const target = path.join(dir, "target");
    const allowlist = path.join(dir, "allowlist.json");
    const lock = path.join(target, ".buildproven-sync.lock");
    mkdirSync(path.join(source, "keep"), { recursive: true });
    mkdirSync(lock, { recursive: true });
    writeFileSync(path.join(source, "keep", "SKILL.md"), "# keep\n");
    writeFileSync(allowlist, '{"skills":["keep"]}\n');
    writeFileSync(path.join(lock, "owner"), "99999999|stale\n");

    expect(
      spawnSync("bash", [
        SKILL_SYNC,
        "--source",
        source,
        "--allowlist",
        allowlist,
        "--target",
        target,
      ]).status,
    ).toBe(0);
    expect(readlinkSync(path.join(target, "keep"))).toBe(
      path.join(source, "keep"),
    );
  });

  it("rejects path traversal in the managed manifest", () => {
    const dir = makeTempDir("codex-skill-manifest-");
    const target = path.join(dir, "target");
    mkdirSync(target, { recursive: true });
    writeFileSync(
      path.join(target, ".buildproven-managed"),
      "../victim|/tmp/victim\n",
    );

    expect(
      spawnSync("bash", [SKILL_SYNC, "--clean", "--target", target]).status,
    ).toBe(1);
  });

  it("rejects a manifest directory without creating unowned links", () => {
    const dir = makeTempDir("codex-manifest-dir-");
    const source = path.join(dir, "source");
    const target = path.join(dir, "target");
    const allowlist = path.join(dir, "allowlist.json");
    mkdirSync(path.join(source, "keep"), { recursive: true });
    mkdirSync(path.join(target, ".buildproven-managed"), { recursive: true });
    writeFileSync(path.join(source, "keep", "SKILL.md"), "# keep\n");
    writeFileSync(allowlist, '{"skills":["keep"]}\n');

    expect(
      spawnSync("bash", [
        SKILL_SYNC,
        "--source",
        source,
        "--allowlist",
        allowlist,
        "--target",
        target,
      ]).status,
    ).toBe(1);
    expect(() => readlinkSync(path.join(target, "keep"))).toThrow();
  });

  it("measures instruction and allowlisted skill discovery budgets", () => {
    const dir = makeTempDir("surface-budget-");
    const skills = path.join(dir, "skills");
    const config = path.join(dir, "config");
    mkdirSync(path.join(skills, "keep"), { recursive: true });
    mkdirSync(path.join(skills, "skip"), { recursive: true });
    mkdirSync(config);
    writeFileSync(
      path.join(skills, "keep", "SKILL.md"),
      "---\nname: keep\ndescription: Useful workflow\n---\n",
    );
    writeFileSync(
      path.join(skills, "skip", "SKILL.md"),
      "---\nname: skip\ndescription: Hidden workflow\n---\n",
    );
    const allowlist = path.join(config, "skills.json");
    const instructions = path.join(config, "CLAUDE.md");
    writeFileSync(allowlist, '{"skills":["keep"]}\n');
    writeFileSync(instructions, "short\n");

    const payload = JSON.parse(
      execFileSync("node", [
        SURFACE,
        `--root=${dir}`,
        `--skill-source=${skills}`,
        `--skill-allowlist=${allowlist}`,
        `--instruction-file=${instructions}`,
        "--description-budget=100",
        "--instruction-budget=100",
        "--json",
      ]),
    );

    expect(payload.discoverySkillCount).toBe(1);
    expect(payload.descriptionChars).toBe("keep: Useful workflow".length);
    expect(payload.instructionBytes).toBe(6);
    expect(payload.descriptionsOverBudget).toBe(false);
    expect(payload.instructionsOverBudget).toBe(false);
  });

  it("audits the default Codex profile through installed skill symlinks", () => {
    const dir = makeTempDir("surface-symlinks-");
    const skills = path.join(dir, "skills");
    const installed = path.join(dir, "installed");
    const config = path.join(dir, "config");
    mkdirSync(path.join(skills, "keep"), { recursive: true });
    mkdirSync(path.join(skills, "skip"), { recursive: true });
    mkdirSync(config);
    writeFileSync(
      path.join(skills, "keep", "SKILL.md"),
      "---\nname: keep\ndescription: Useful workflow\n---\n",
    );
    writeFileSync(
      path.join(skills, "skip", "SKILL.md"),
      "---\nname: skip\ndescription: Hidden workflow\n---\n",
    );
    writeFileSync(
      path.join(config, "codex-skills.json"),
      '{"skills":["keep"]}\n',
    );
    execFileSync("bash", [
      SKILL_SYNC,
      "--source",
      skills,
      "--allowlist",
      path.join(config, "codex-skills.json"),
      "--target",
      installed,
    ]);

    const installedPayload = JSON.parse(
      execFileSync("node", [
        SURFACE,
        `--root=${dir}`,
        `--skill-source=${installed}`,
        `--skill-allowlist=${path.join(config, "codex-skills.json")}`,
        "--json",
      ]),
    );
    const defaultPayload = JSON.parse(
      execFileSync("node", [SURFACE, `--root=${dir}`, "--json"]),
    );

    expect(installedPayload.discoverySkillCount).toBe(1);
    expect(defaultPayload.discoverySkillCount).toBe(1);
    expect(defaultPayload.descriptionChars).toBe(
      "keep: Useful workflow".length,
    );
  });

  it("counts YAML block-scalar and escaped descriptions", () => {
    const dir = makeTempDir("surface-yaml-");
    const skills = path.join(dir, "skills");
    const allowlist = path.join(dir, "skills.json");
    for (const name of ["folded", "literal", "quoted"]) {
      mkdirSync(path.join(skills, name), { recursive: true });
    }
    writeFileSync(
      path.join(skills, "folded", "SKILL.md"),
      "---\nname: folded\ndescription: >-\n  Folded\n  workflow\n---\n",
    );
    writeFileSync(
      path.join(skills, "literal", "SKILL.md"),
      "---\nname: literal\ndescription: |+\n  Literal\n  workflow\n---\n",
    );
    writeFileSync(
      path.join(skills, "quoted", "SKILL.md"),
      '---\nname: quoted\ndescription: "Escaped\\nworkflow"\n---\n',
    );
    writeFileSync(allowlist, '{"skills":["folded","literal","quoted"]}\n');

    const payload = JSON.parse(
      execFileSync("node", [
        SURFACE,
        `--root=${dir}`,
        `--skill-source=${skills}`,
        `--skill-allowlist=${allowlist}`,
        "--json",
      ]),
    );
    expect(payload.descriptionChars).toBe(
      [
        "folded: Folded workflow",
        "literal: Literal workflow",
        "quoted: Escaped\nworkflow",
      ].reduce((total, description) => total + description.length, 0),
    );
  });

  it("fails when explicit surface-audit inputs are missing or malformed", () => {
    const dir = makeTempDir("surface-invalid-");
    const skills = path.join(dir, "skills");
    const allowlist = path.join(dir, "skills.json");
    mkdirSync(skills);
    writeFileSync(allowlist, '{"skillz":[]}\n');

    expect(
      spawnSync("node", [
        SURFACE,
        `--root=${dir}`,
        `--skill-source=${skills}`,
        `--skill-allowlist=${allowlist}`,
        "--json",
      ]).status,
    ).toBe(1);
    expect(
      spawnSync("node", [
        SURFACE,
        `--root=${dir}`,
        `--skill-source=${path.join(dir, "missing")}`,
        `--instruction-file=${path.join(dir, "missing.md")}`,
        "--json",
      ]).status,
    ).toBe(1);
    mkdirSync(path.join(skills, "keep"));
    writeFileSync(path.join(skills, "keep", "SKILL.md"), "# keep\n");
    writeFileSync(allowlist, '{"skills":[" missing "]}\n');
    expect(
      spawnSync("node", [
        SURFACE,
        `--root=${dir}`,
        `--skill-source=${skills}`,
        `--skill-allowlist=${allowlist}`,
        "--json",
      ]).status,
    ).toBe(1);
    writeFileSync(allowlist, '{"skills":["unknown"]}\n');
    expect(
      spawnSync("node", [
        SURFACE,
        `--root=${dir}`,
        `--skill-source=${skills}`,
        `--skill-allowlist=${allowlist}`,
        "--json",
      ]).status,
    ).toBe(1);
  });

  it("treats absent implicit skill surfaces as empty", () => {
    const dir = makeTempDir("surface-generic-");
    const payload = JSON.parse(
      execFileSync("node", [SURFACE, `--root=${dir}`, "--json"]),
    );
    expect(payload.discoverySkillCount).toBe(0);
    expect(payload.descriptionChars).toBe(0);
  });

  it("fails closed when a surface budget is not a valid integer", () => {
    expect(
      spawnSync("node", [
        SURFACE,
        `--root=${ROOT}`,
        "--description-budget=wat",
        "--json",
      ]).status,
    ).toBe(1);
    expect(
      spawnSync("node", [
        SURFACE,
        `--root=${ROOT}`,
        "--instruction-budget=-1",
        "--json",
      ]).status,
    ).toBe(1);
  });

  it("discovers active non-bot repos and open-PR repos from fixtures", () => {
    const dir = makeTempDir("fleet-discovery-");
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

  it("maps GitHub repos to primary checkouts, never linked worktrees", () => {
    const dir = makeTempDir("fleet-local-map-");
    const root = path.join(dir, "repos");
    const primary = path.join(root, "primary");
    const worktree = path.join(root, "primary-worktree");
    mkdirSync(root);
    execFileSync("git", ["init", "-q", "-b", "main", primary]);
    execFileSync("git", [
      "-C",
      primary,
      "config",
      "user.email",
      "test@example.com",
    ]);
    execFileSync("git", ["-C", primary, "config", "user.name", "Test"]);
    writeFileSync(path.join(primary, "README.md"), "test\n");
    execFileSync("git", ["-C", primary, "add", "README.md"]);
    execFileSync("git", ["-C", primary, "commit", "-q", "-m", "init"]);
    execFileSync("git", [
      "-C",
      primary,
      "remote",
      "add",
      "origin",
      "https://github.com/buildproven/active.git",
    ]);
    execFileSync("git", [
      "-C",
      primary,
      "worktree",
      "add",
      "-q",
      "-b",
      "feature",
      worktree,
    ]);
    const config = path.join(dir, "fleet.json");
    const fixture = path.join(dir, "repos.json");
    writeFileSync(
      config,
      JSON.stringify({
        owners: ["buildproven"],
        windowDays: 14,
        minimumCommits: 1,
        localRoots: [root],
      }),
    );
    writeFileSync(
      fixture,
      JSON.stringify([
        {
          nameWithOwner: "buildproven/active",
          commits: [{ author: { login: "brett" } }],
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
    expect(payload.repositories[0].localPath).toBe(
      execFileSync(
        "python3",
        ["-c", "import os,sys; print(os.path.realpath(sys.argv[1]))", primary],
        {
          encoding: "utf8",
        },
      ).trim(),
    );
  });

  it("syncs the same declarative MCP server into both clients", () => {
    const dir = makeTempDir("mcp-sync-");
    const bin = path.join(dir, "bin");
    const codexHome = path.join(dir, "codex");
    const calls = path.join(dir, "calls");
    mkdirSync(bin);
    mkdirSync(codexHome);
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
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
        PATH: `${bin}:${process.env.PATH}`,
      },
    });
    expect(result.status).toBe(0);
    const logged = readFileSync(calls, "utf8");
    expect(logged).toContain(
      "claude mcp add --scope user --transport http shared https://example.test/mcp",
    );
    expect(logged).not.toContain("codex mcp add shared");
    expect(readFileSync(path.join(codexHome, "config.toml"), "utf8")).toContain(
      '[mcp_servers."shared"]\nurl = "https://example.test/mcp"',
    );
  });

  it("runs fleet checks with the repository's declared Node version", () => {
    const dir = makeTempDir("steward-node-version-");
    const repo = path.join(dir, "repo");
    const bin = path.join(dir, "bin");
    const nvm = path.join(dir, "nvm");
    const observed = path.join(dir, "observed-version");
    mkdirSync(repo);
    mkdirSync(bin);
    mkdirSync(nvm);
    writeFileSync(path.join(repo, ".nvmrc"), "22\n");
    writeFileSync(
      path.join(repo, "package.json"),
      JSON.stringify({ scripts: { test: "test" } }),
    );
    executable(
      path.join(bin, "git"),
      `case "$*" in
        *"branch --show-current"*) echo main ;;
        *"rev-list --left-right --count"*) echo "0 0" ;;
        *"remote get-url"*) exit 0 ;;
      esac`,
    );
    executable(path.join(bin, "npm"), 'echo "npm $*"');
    writeFileSync(
      path.join(nvm, "nvm.sh"),
      `nvm() {
        shift
        shift
        printf '%s\\n' "$1" > '${observed}'
        shift
        "$@"
      }`,
    );

    const result = spawnSync("bash", [AUDIT_REPO, repo], {
      encoding: "utf8",
      env: {
        ...process.env,
        NVM_DIR: nvm,
        PATH: `${bin}:${process.env.PATH}`,
      },
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).failedChecks).toBe(0);
    expect(readFileSync(observed, "utf8").trim()).toBe("22");
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
