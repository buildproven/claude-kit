import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "./helpers/tmp.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const RESOLVER = path.join(ROOT, "scripts", "quality-runtime-dir.sh");

describe("quality runtime directory resolver", () => {
  it("prints the canonical directory containing quality-invocation.js", () => {
    const result = spawnSync("bash", [RESOLVER], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(path.join(ROOT, "scripts"));
  });

  it("fails visibly when the invocation runtime is absent", () => {
    const root = makeTempDir("quality-runtime-dir-");
    const scripts = path.join(root, "scripts");
    const resolver = path.join(scripts, "quality-runtime-dir.sh");
    mkdirSync(scripts);
    copyFileSync(RESOLVER, resolver);
    chmodSync(resolver, 0o644);
    writeFileSync(path.join(root, "unrelated"), "");

    const result = spawnSync("bash", [resolver], { encoding: "utf8" });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/quality-invocation\.js is missing/);
  });
});
