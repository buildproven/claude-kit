import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");
const devSkill = readFileSync(join(root, "skills/dev/SKILL.md"), "utf8");
const workflowSkill = readFileSync(
  join(root, "skills/workflow/SKILL.md"),
  "utf8",
);

describe("dev delivery handoff", () => {
  it("ships a completed single task by default through exact-worktree quality", () => {
    expect(devSkill).toContain("immediately invoke the `quality` skill");
    expect(devSkill).toContain(
      '/bs:quality --merge --target-dir "$WORKTREE_DIR"',
    );
    expect(devSkill).not.toContain(
      "Run `/bs:quality --merge` to test, create PR, deploy",
    );
  });

  it("requires an explicit local-only escape hatch", () => {
    expect(devSkill).toContain("[--no-ship]");
    expect(devSkill).toMatch(
      /Never infer `--no-ship`\s+from `--experiment` alone\./,
    );
    expect(workflowSkill).toContain("/bs:dev --no-ship");
  });
});
