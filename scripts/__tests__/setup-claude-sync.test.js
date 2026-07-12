import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readlinkSync,
  existsSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = path.resolve(import.meta.dirname, "..", "setup-claude-sync.sh");
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

/** Run the sync script against a throwaway config dir. Never touches a real $HOME. */
function run(args, configDir, scriptPath = SCRIPT) {
  try {
    const stdout = execFileSync("bash", [scriptPath, ...args], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

const sandbox = () =>
  path.join(mkdtempSync(path.join(tmpdir(), "kit-sync-")), ".claude");

describe("setup-claude-sync.sh", () => {
  it("--repair links all four dirs and every hook resolves", () => {
    const cfg = sandbox();
    const { code, stdout } = run(["--repair"], cfg);

    expect(code).toBe(0);
    for (const d of ["commands", "skills", "agents", "scripts"]) {
      expect(readlinkSync(path.join(cfg, d))).toBe(path.join(REPO_ROOT, d));
    }
    // scripts/ is the load-bearing one: settings.json wires 14 hooks through it.
    expect(existsSync(path.join(cfg, "scripts", "block-push-main.sh"))).toBe(
      true,
    );
    expect(stdout).toMatch(/hook scripts resolve/);
  });

  // The regression that shipped to main: invoked via the installed symlink,
  // REPO_ROOT collapsed to the config dir, so --repair unlinked the working
  // link and recreated it pointing at itself. ELOOP, all 14 hooks dead, and the
  // next --check reported OK because readlink === src.
  it("does not self-link when invoked through the installed symlink", () => {
    const cfg = sandbox();
    expect(run(["--repair"], cfg).code).toBe(0);

    const viaSymlink = path.join(cfg, "scripts", "setup-claude-sync.sh");
    const { code } = run(["--repair"], cfg, viaSymlink);

    expect(code).toBe(0);
    const link = readlinkSync(path.join(cfg, "scripts"));
    expect(link).not.toBe(path.join(cfg, "scripts")); // would be ELOOP
    expect(link).toBe(path.join(REPO_ROOT, "scripts"));
    expect(existsSync(path.join(cfg, "scripts", "block-push-main.sh"))).toBe(
      true,
    );
  });

  it("--check exits non-zero when scripts/ is not linked", () => {
    const cfg = sandbox();
    mkdirSync(cfg, { recursive: true });
    const { code, stdout } = run(["--check"], cfg);

    expect(code).toBe(1); // must NOT silently pass — this is the original bug
    expect(stdout).toMatch(/scripts/);
  });

  it("--check exits 0 once everything is linked", () => {
    const cfg = sandbox();
    run(["--repair"], cfg);
    expect(run(["--check"], cfg).code).toBe(0);
  });

  it("never clobbers a real directory the user owns", () => {
    const cfg = sandbox();
    const mine = path.join(cfg, "commands");
    mkdirSync(mine, { recursive: true });
    writeFileSync(path.join(mine, "mine.md"), "my own command");

    const { code } = run(["--repair"], cfg);

    expect(code).toBe(1); // refuses, rather than deleting
    expect(existsSync(path.join(mine, "mine.md"))).toBe(true);
  });

  it("repairs a dangling symlink", () => {
    const cfg = sandbox();
    mkdirSync(cfg, { recursive: true });
    symlinkSync("/nonexistent/gone", path.join(cfg, "scripts"));

    expect(run(["--repair"], cfg).code).toBe(0);
    expect(readlinkSync(path.join(cfg, "scripts"))).toBe(
      path.join(REPO_ROOT, "scripts"),
    );
  });

  it("--all errors rather than silently meaning --repair", () => {
    const cfg = sandbox();
    const { code, stdout } = run(["--all"], cfg);

    expect(code).toBe(2);
    expect(stdout).toMatch(/--repair/);
  });
});
