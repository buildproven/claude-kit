import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "./helpers/tmp.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const INVOCATION = path.join(ROOT, "scripts", "quality-invocation.js");
const STATUS = path.join(ROOT, "scripts", "quality-status.sh");

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function repo(label) {
  const root = makeTempDir(`quality-${label}-`);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.name", "Quality Test"]);
  git(root, ["config", "user.email", "quality@example.com"]);
  writeFileSync(path.join(root, "file.js"), "export const value = 1;\n");
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      scripts: { lint: "true", test: "true", "security:audit": "true" },
    }),
  );
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "base"]);
  git(root, ["remote", "add", "origin", root]);
  git(root, ["fetch", "-q", "origin", "main"]);
  git(root, ["switch", "-q", "-c", "feature"]);
  writeFileSync(path.join(root, "file.js"), "export const value = 2;\n");
  git(root, ["commit", "-qam", "change"]);
  return root;
}

describe("quality-status.sh (BUI-383)", () => {
  it("prints buildDiagnosis output on demand for an existing manifest, exit 0", () => {
    const root = repo("status-basic");
    const manifest = execFileSync(
      "node",
      [
        INVOCATION,
        "create",
        "--repo",
        root,
        "--base-ref",
        "origin/main",
        "--level",
        "auto",
      ],
      { cwd: root, encoding: "utf8" },
    ).trim();

    const result = spawnSync("bash", [STATUS, "--manifest", manifest], {
      cwd: root,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("QUALITY TERMINAL DIAGNOSIS");
    expect(result.stderr).toContain("Repository gates:");
    expect(result.stderr).toContain("Provider review/checkpoint:");
    expect(result.stderr).toContain("Break-glass:");
    expect(result.stderr).toContain(
      `Retry/resume: /bs:quality --manifest ${manifest}`,
    );
  });

  it("does not mutate the manifest (read-only)", () => {
    const root = repo("status-readonly");
    const manifest = execFileSync(
      "node",
      [
        INVOCATION,
        "create",
        "--repo",
        root,
        "--base-ref",
        "origin/main",
        "--level",
        "auto",
      ],
      { cwd: root, encoding: "utf8" },
    ).trim();
    const before = execFileSync("cat", [manifest], { encoding: "utf8" });

    spawnSync("bash", [STATUS, "--manifest", manifest], {
      cwd: root,
      encoding: "utf8",
    });

    const after = execFileSync("cat", [manifest], { encoding: "utf8" });
    expect(after).toBe(before);
  });

  it("fails closed with a clear error when --manifest is omitted", () => {
    const root = repo("status-no-arg");
    const result = spawnSync("bash", [STATUS], { cwd: root, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--manifest <path> is required");
    // Explicit: no PR-number or session-glob discovery, matching the
    // repo-wide "caller must pass the exact manifest path" convention.
    expect(result.stderr).toContain("no PR-number or session lookup");
  });

  it("fails closed with a clear error when the manifest path does not exist", () => {
    const root = repo("status-missing-manifest");
    const result = spawnSync(
      "bash",
      [STATUS, "--manifest", "/nonexistent/quality-manifest.json"],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("manifest not found");
  });

  it("rejects an unknown flag", () => {
    const root = repo("status-unknown-flag");
    const result = spawnSync("bash", [STATUS, "--pr", "7"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unknown argument");
  });
});
