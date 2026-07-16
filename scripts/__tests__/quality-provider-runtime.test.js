import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const PLAN = path.join(ROOT, "scripts", "quality-review-plan.sh");
const BOUNDED = path.join(ROOT, "scripts", "quality-run-bounded.sh");
const LOAD_ROOT = path.join(ROOT, "scripts", "quality-load-root.sh");

describe("provider review runtime", () => {
  it.each([
    ["low", "120", "Focused"],
    ["medium", "480", "Broad"],
    ["high", "900", "Deep adversarial"],
    ["critical", "900", "release-veto"],
  ])("maps %s to a mechanical review plan", (tier, timeout, focus) => {
    const result = spawnSync(
      "bash",
      [
        "-c",
        `TIER="$1"; source "$2"; printf '%s|%s' "$QUALITY_REVIEW_TIMEOUT" "$QUALITY_REVIEW_FOCUS"`,
        "plan",
        tier,
        PLAN,
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`${timeout}|`);
    expect(result.stdout).toContain(focus);
  });

  it("kills a hanging provider process group at the wall-clock cap", () => {
    const started = Date.now();
    const result = spawnSync(
      "bash",
      [BOUNDED, "--timeout", "1", "--", "bash", "-c", "sleep 20 & wait"],
      { encoding: "utf8", timeout: 5000 },
    );
    expect(result.status).toBe(124);
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it("names state by Codex thread when no Claude session exists", () => {
    const result = spawnSync(
      "bash",
      [
        "-c",
        `unset CLAUDE_CODE_SESSION_ID; CODEX_THREAD_ID=codex-thread-42; source "$1"; bs_quality_root_file "$2"`,
        "state",
        LOAD_ROOT,
        ROOT,
      ],
      { encoding: "utf8", cwd: ROOT },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("bs-quality-gitroot-codex-thread-42-");
  });
});
