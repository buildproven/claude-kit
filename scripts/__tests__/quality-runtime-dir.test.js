import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "./helpers/tmp.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const RESOLVER = path.join(ROOT, "scripts", "quality-runtime-dir.sh");

describe("quality runtime directory resolver", () => {
  const cohort = [
    "quality-invocation.js",
    "quality-run.js",
    "quality-provider-usage.js",
    "provider-run.sh",
    "quality-run-bounded.sh",
  ];

  function isolatedResolver(omitted = []) {
    const root = makeTempDir("quality-runtime-dir-");
    const scripts = path.join(root, "scripts");
    mkdirSync(scripts);
    for (const sibling of ["quality-runtime-dir.sh", ...cohort]) {
      if (!omitted.includes(sibling)) {
        copyFileSync(
          path.join(ROOT, "scripts", sibling),
          path.join(scripts, sibling),
        );
      }
    }
    const resolver = path.join(scripts, "quality-runtime-dir.sh");
    chmodSync(resolver, 0o755);
    return { resolver, scripts };
  }

  it("prints the canonical directory containing a complete cohort", () => {
    const result = spawnSync("bash", [RESOLVER], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(path.join(ROOT, "scripts"));
  });

  it.each(cohort)("fails visibly when %s is absent", (omitted) => {
    const { resolver } = isolatedResolver([omitted]);
    const result = spawnSync("bash", [resolver], { encoding: "utf8" });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`missing: ${omitted}`);
  });

  it("names every missing cohort sibling in one actionable diagnostic", () => {
    const { resolver } = isolatedResolver([
      "quality-run.js",
      "quality-provider-usage.js",
    ]);
    const result = spawnSync("bash", [resolver], { encoding: "utf8" });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "missing: quality-run.js, quality-provider-usage.js",
    );
  });

  it("propagates a present resolver failure instead of falling through", () => {
    const skill = readFileSync(
      path.join(ROOT, "skills", "quality", "SKILL.md"),
      "utf8",
    );

    const resolverLine = skill
      .split("\n")
      .find((line) => line.startsWith('QUALITY_SCRIPTS_DIR="$(for d in '));
    expect(resolverLine).toBeDefined();
    const high = isolatedResolver(["quality-provider-usage.js"]);
    const low = isolatedResolver();
    const home = makeTempDir("quality-runtime-home-");
    const result = spawnSync(
      "bash",
      ["-c", `${resolverLine}\nprintf '%s\\n' "$QUALITY_SCRIPTS_DIR"`],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          CLAUDE_PLUGIN_ROOT: path.dirname(high.scripts),
          CLAUDE_KIT_ROOT: path.dirname(low.scripts),
          HOME: home,
        },
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("missing: quality-provider-usage.js");
    expect(result.stdout).toBe("");
    expect(skill).not.toContain("quality runtime not found");
    expect(skill).not.toContain('quality-runtime-dir.sh" 2>/dev/null');
  });
});
