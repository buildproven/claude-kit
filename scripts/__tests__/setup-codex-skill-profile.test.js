import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "./helpers/tmp.js";

const PROFILE = path.resolve(
  import.meta.dirname,
  "..",
  "setup-codex-skill-profile.sh",
);

describe("setup-codex-skill-profile.sh", () => {
  it("runs the skill installer when no check or clean mode is selected", () => {
    const root = makeTempDir("kit-codex-profile-");
    const engineDir = path.join(root, "core", "scripts");
    const output = path.join(root, "engine-args.txt");
    mkdirSync(engineDir, { recursive: true });
    const engine = path.join(engineDir, "setup-codex-skills.sh");
    writeFileSync(
      engine,
      '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$ENGINE_ARGS_FILE"\n',
    );
    chmodSync(engine, 0o755);

    expect(() =>
      execFileSync("bash", [PROFILE, "--target", path.join(root, "target")], {
        env: {
          ...process.env,
          HOME: path.join(root, "home"),
          SETUP_REPO: root,
          ENGINE_ARGS_FILE: output,
        },
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ).not.toThrow();

    expect(readFileSync(output, "utf8")).toContain("--target");
  });
});
