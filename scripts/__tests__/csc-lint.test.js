import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const LINTER = path.resolve(import.meta.dirname, "..", "csc_lint.py");

function write(root, relative, body) {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
}

function lint(skillBody) {
  const root = mkdtempSync(path.join(tmpdir(), "csc-self-delegation-"));
  write(
    root,
    "skills/status/SKILL.md",
    `---\nname: status\ndescription: status\n---\n${skillBody}\n`,
  );
  write(
    root,
    "commands/bs/status.md",
    "---\nname: bs:status\ndescription: status\n---\nInvoke the `status` skill.\n",
  );
  return spawnSync("python3", [LINTER, "--root", root, "--strict", "--json"], {
    encoding: "utf8",
  });
}

describe("CSC agent-visible skill contract", () => {
  it("rejects a skill that delegates to its paired command", () => {
    const result = lint("When triggered, run /bs:status for the report.");
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).violations).toContainEqual(
      expect.objectContaining({ rule: "R6", name: "status" }),
    );
  });

  it("rejects backticked self-delegation after an invocation verb", () => {
    for (const verb of ["run", "use", "start", "trigger", "launch"]) {
      const result = lint(
        `When triggered, ${verb} \`/bs:status\` for the report.`,
      );
      expect(result.status, verb).toBe(1);
      expect(JSON.parse(result.stdout).violations).toContainEqual(
        expect.objectContaining({ rule: "R6", name: "status" }),
      );
    }
  });

  it("allows self-documentation while the skill executes behavior", () => {
    const result = lint(
      "The `/bs:status` command is a human wrapper. Read Git status directly.",
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).violations).toEqual([]);
  });
});
