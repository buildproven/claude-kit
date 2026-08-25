import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
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

  it.each(["quality-run.js", "quality-provider-usage.js"])(
    "fails visibly when %s is absent",
    (omitted) => {
      const { resolver } = isolatedResolver([omitted]);
      const result = spawnSync("bash", [resolver], { encoding: "utf8" });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`missing: ${omitted}`);
    },
  );
});
