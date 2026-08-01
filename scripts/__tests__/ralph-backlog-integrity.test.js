// BACKLOG.md must never lose a row, and the session bound must never vanish.
//
// move_item_to_completed removes the active row with awk's `next` and
// re-inserts it only inside the Completed section. With no `## Completed`
// section — or one without a `| ---` divider — the re-insert never fired and
// the row was simply gone, while the command reported success and exited 0.
// Reproduced before the fix: 2 rows in, 1 row out, "moved to Completed"
// logged, and no backup file, because only the session loop backed anything up
// and the subcommands (which skills/ralph tells the orchestrator to drive)
// did not.

import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "./helpers/tmp.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const RALPH = path.join(ROOT, "scripts", "ralph-next-run.sh");

const ACTIVE_ROWS = `| CS-001 | Important work | feature | P1 | M | 0.9 | Pending |
| CS-002 | Other work | bug | P1 | S | 0.8 | Pending |`;

const WITHOUT_COMPLETED = `# Backlog

## Active

| ID | Description | Type | Priority | Size | Score | Status |
| --- | --- | --- | --- | --- | --- | --- |
${ACTIVE_ROWS}
`;

const WITH_COMPLETED = `${WITHOUT_COMPLETED}
## Completed

| ID | Description | Completed |
| --- | --- | --- |
`;

let repo;

const git = (args) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();

function ralph(args, env = {}) {
  const r = spawnSync("bash", [RALPH, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { code: r.status, output: (r.stdout ?? "") + (r.stderr ?? "") };
}

const backlog = () => readFileSync(path.join(repo, "BACKLOG.md"), "utf8");
const activeIds = () =>
  [...backlog().matchAll(/^\| (CS-\d+) /gm)].map((m) => m[1]);

function seed(content) {
  repo = makeTempDir("ralph-backlog-");
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  writeFileSync(
    path.join(repo, "package.json"),
    '{"scripts":{"lint":"echo ok"}}\n',
  );
  writeFileSync(path.join(repo, "BACKLOG.md"), content);
  git(["add", "-A"]);
  git(["commit", "-qm", "init"]);
  // complete-item refuses without quality evidence; produce it first.
  ralph(["init"]);
  ralph(["run-quality", "CS-001", "1"]);
}

describe("BACKLOG.md row integrity", () => {
  it("refuses to complete an item when there is no Completed section", () => {
    seed(WITHOUT_COMPLETED);
    const { output } = ralph(["complete-item", "CS-001"]);
    expect(output).toMatch(/could not be moved to Completed/i);
  });

  it("leaves every row intact when the move cannot be performed", () => {
    seed(WITHOUT_COMPLETED);
    ralph(["complete-item", "CS-001"]);
    // The whole point: the row must still be there.
    expect(activeIds()).toEqual(["CS-001", "CS-002"]);
  });

  it("does not report success when the row was not moved", () => {
    seed(WITHOUT_COMPLETED);
    const { output } = ralph(["complete-item", "CS-001"]);
    expect(output).not.toMatch(/moved to Completed in BACKLOG\.md/);
  });

  it("still moves the row when a Completed section exists", () => {
    seed(WITH_COMPLETED);
    const { output } = ralph(["complete-item", "CS-001"]);
    expect(output).toMatch(/moved to Completed/);
    const completed = backlog().slice(backlog().indexOf("## Completed"));
    expect(completed).toMatch(/\| CS-001 \|/);
    // CS-002 untouched in the active table.
    expect(activeIds()).toContain("CS-002");
  });

  it("backs the file up before a subcommand mutation", () => {
    seed(WITH_COMPLETED);
    ralph(["complete-item", "CS-001"]);
    const backups = readdirSync(repo).filter((f) =>
      f.startsWith("BACKLOG.md.ralph-next-backup"),
    );
    expect(backups.length).toBeGreaterThan(0);
  });

  // A fixed backup filename was overwritten by the next run, so after two runs
  // the pre-mutation state was unrecoverable — the backup destroyed the very
  // thing it existed to preserve.
  it("uses a timestamped backup name so a rerun cannot clobber it", () => {
    seed(WITH_COMPLETED);
    ralph(["complete-item", "CS-001"]);
    const backups = readdirSync(repo).filter((f) =>
      f.startsWith("BACKLOG.md.ralph-next-backup"),
    );
    expect(backups.every((f) => /backup-\d{8}-\d{6}$/.test(f))).toBe(true);
  });
});

describe("--until session bound", () => {
  beforeEach(() => seed(WITH_COMPLETED));

  // `$(( n * 3600 ))` wraps NEGATIVE on 64-bit overflow, and the guard is
  // `[[ $SESSION_LIMIT_SECONDS -gt 0 && ... ]]`, so a negative limit skipped
  // the wall-clock check for the entire run — an autonomous loop with its time
  // bound silently removed.
  const rejected = [
    ["an overflowing hour count", "999999999999999999999 hours"],
    ["zero hours", "0 hours"],
    ["more than a week", "200 hours"],
    ["zero items", "0 items"],
  ];

  it.each(rejected)("rejects %s", (_label, value) => {
    const { output } = ralph(["--until", value, "--dry-run"]);
    expect(output).toMatch(/--until (hours|items) must be between/i);
  });

  const accepted = [
    ["a normal hour count", "3 hours"],
    ["the one-week maximum", "168 hours"],
    ["an item count", "5 items"],
  ];

  it.each(accepted)("accepts %s", (_label, value) => {
    const { output } = ralph(["--until", value, "--dry-run"]);
    expect(output).not.toMatch(/must be between/i);
  });
});
