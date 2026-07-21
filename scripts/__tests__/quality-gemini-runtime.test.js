import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SCRIPTS = path.join(ROOT, "scripts");
const INVOCATION = path.join(SCRIPTS, "quality-invocation.js");
const RISK = path.join(SCRIPTS, "quality-risk-resolve.sh");
const SELECT = path.join(SCRIPTS, "quality-select-agents.sh");
const GOVERNOR = path.join(SCRIPTS, "quality-run-governor.js");
const RUN_REVIEW = path.join(SCRIPTS, "quality-run-review.sh");

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function fixtureRepo(root) {
  const remote = path.join(root, "remote.git");
  const repo = path.join(root, "repo");
  git(root, ["init", "--bare", "-q", remote]);
  git(root, ["init", "-q", "-b", "main", repo]);
  git(repo, ["config", "user.name", "Quality Test"]);
  git(repo, ["config", "user.email", "quality@example.com"]);
  writeFileSync(path.join(repo, "reviewed.js"), "export const value = 1;\n");
  writeFileSync(
    path.join(repo, "package.json"),
    JSON.stringify({
      scripts: { lint: "true", test: "true", "security:audit": "true" },
    }),
  );
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "chore: base"]);
  git(repo, ["remote", "add", "origin", remote]);
  git(repo, ["push", "-q", "-u", "origin", "main"]);
  git(repo, ["switch", "-q", "-c", "feature"]);
  writeFileSync(path.join(repo, "reviewed.js"), "export const value = 2;\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "fix: change reviewed behavior"]);
  return repo;
}

describe("governed Gemini review", () => {
  it("records strict Gemini evidence inside the existing campaign budget", () => {
    const root = mkdtempSync(path.join(tmpdir(), "quality-gemini-"));
    const repo = fixtureRepo(root);
    const bin = path.join(root, "bin");
    const state = path.join(root, "state");
    const argsCapture = path.join(root, "gemini-args.txt");
    const promptCapture = path.join(root, "gemini-prompt.txt");
    mkdirSync(bin);
    const gemini = path.join(bin, "gemini");
    writeFileSync(
      gemini,
      `#!/usr/bin/env bash
printf '%s\\n' "$*" > "$GEMINI_ARGS_CAPTURE"
cat > "$GEMINI_PROMPT_CAPTURE"
printf '%s\\n' '{"response":"{\\"verdict\\":\\"approve\\",\\"summary\\":\\"No actionable findings.\\",\\"findings\\":[]}"}'
`,
    );
    chmodSync(gemini, 0o755);
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      XDG_STATE_HOME: state,
      BS_QUALITY_PRIMARY: "gemini",
      BS_QUALITY_FALLBACK: "none",
      GEMINI_ARGS_CAPTURE: argsCapture,
      GEMINI_PROMPT_CAPTURE: promptCapture,
    };
    const manifest = execFileSync(
      "node",
      [
        INVOCATION,
        "create",
        "--repo",
        repo,
        "--base-ref",
        "origin/main",
        "--level",
        "95",
      ],
      { cwd: repo, env, encoding: "utf8" },
    ).trim();
    execFileSync("bash", [RISK, "--manifest", manifest], { cwd: repo, env });
    execFileSync("bash", [SELECT, "--manifest", manifest], {
      cwd: repo,
      env,
    });
    execFileSync("node", [GOVERNOR, "bump-round", manifest], {
      cwd: repo,
      env,
    });

    const result = spawnSync("bash", [RUN_REVIEW, "--manifest", manifest], {
      cwd: repo,
      env,
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(result.status).toBe(0);
    expect(readFileSync(argsCapture, "utf8")).toContain("--approval-mode plan");
    expect(readFileSync(argsCapture, "utf8")).not.toContain("--yolo");
    expect(readFileSync(promptCapture, "utf8")).toContain(
      "fix: change reviewed behavior",
    );
    const body = JSON.parse(readFileSync(manifest, "utf8"));
    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0]).toMatchObject({
      provider: "gemini",
      status: "success",
    });
    expect(body.governor.providerAttempts).toHaveLength(1);
  }, 30_000);
});
