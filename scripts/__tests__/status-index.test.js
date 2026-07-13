const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const {
  extractVersion,
  extractFocus,
  extractRecentSprintEntries,
  countBacklogItems,
  extractTopBacklogItems,
  extractRecentCompleted,
  generateIndex,
  writeIndex,
  readIndex,
} = require("../status-index");

// The CLI block runs only under `require.main === module`. Re-compiling the
// source with require.main set drives it in-process so v8 coverage sees it.
const SRC = path.join(__dirname, "..", "status-index.js");
const SOURCE = fs.readFileSync(SRC, "utf8");

class ExitSignal extends Error {
  constructor(code) {
    super(`exit:${code}`);
    this.code = code;
  }
}

/** Run status-index.js as a CLI with the given argv, in-process. */
function runCli(...args) {
  const m = new Module(SRC, null);
  m.filename = SRC;
  m.paths = Module._nodeModulePaths(path.dirname(SRC));

  const prevMain = process.mainModule;
  const prevArgv = process.argv;
  process.mainModule = m;
  process.argv = ["node", SRC, ...args];

  try {
    m._compile(SOURCE, SRC);
    return { code: 0 };
  } catch (e) {
    if (e instanceof ExitSignal) return { code: e.code };
    throw e;
  } finally {
    process.mainModule = prevMain;
    process.argv = prevArgv;
  }
}

// ─── temp-project sandbox ─────────────────────────────────────────────────────

const sandboxes = [];

/** Create an isolated project dir; `files` maps relative path → contents. */
function makeProject(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "status-index-"));
  sandboxes.push(dir);
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents, "utf8");
  }
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  // Only ever removes the literal paths mkdtempSync handed back.
  while (sandboxes.length) {
    fs.rmSync(sandboxes.pop(), { recursive: true, force: true });
  }
});

// ─── extractVersion ───────────────────────────────────────────────────────────

describe("extractVersion", () => {
  it("extracts v-prefixed semver", () => {
    expect(extractVersion("# My Project v1.2.3")).toBe("1.2.3");
  });

  it("extracts version: key-value format", () => {
    expect(extractVersion("version: 2.0.1")).toBe("2.0.1");
  });

  it("extracts version from middle of content", () => {
    expect(extractVersion("Some text\nRelease v3.14.0\nMore text")).toBe(
      "3.14.0",
    );
  });

  it("returns unknown when no version found", () => {
    expect(extractVersion("No version information here")).toBe("unknown");
  });

  it("returns unknown for empty string", () => {
    expect(extractVersion("")).toBe("unknown");
  });

  it("picks first version when multiple exist", () => {
    expect(extractVersion("v1.0.0 and also v2.0.0")).toBe("1.0.0");
  });

  it("is case-insensitive for v prefix", () => {
    expect(extractVersion("Released V1.2.3 today")).toBe("1.2.3");
  });
});

// ─── extractFocus ─────────────────────────────────────────────────────────────

describe("extractFocus", () => {
  it("extracts text from Current Status section", () => {
    const content = "## Current Status\n- Working on authentication";
    expect(extractFocus(content)).toBe("Working on authentication");
  });

  it("extracts text from Focus section", () => {
    const content = "## Focus\n- Performance optimization";
    expect(extractFocus(content)).toBe("Performance optimization");
  });

  it("trims leading/trailing whitespace", () => {
    const content = "## Focus\n-   Spaces around this   ";
    expect(extractFocus(content)).toBe("Spaces around this");
  });

  it("returns default when section not found", () => {
    expect(extractFocus("## Something Else\n- Unrelated")).toBe(
      "See README.md",
    );
  });

  it("returns default for empty content", () => {
    expect(extractFocus("")).toBe("See README.md");
  });
});

// ─── extractRecentSprintEntries ───────────────────────────────────────────────

describe("extractRecentSprintEntries", () => {
  const sprint = [
    "# Sprint Log",
    "",
    "### 2026-03-04 (Tuesday)",
    "Shipped CS-158 and CS-159",
    "All tests passing",
    "",
    "### 2026-03-03 (Monday)",
    "Reviewed backlog",
    "",
    "### 2026-03-02 (Sunday)",
    "Rest day",
  ].join("\n");

  it("returns up to N entries", () => {
    const entries = extractRecentSprintEntries(sprint, 2);
    expect(entries).toHaveLength(2);
  });

  it("returns all entries when fewer than N available", () => {
    const entries = extractRecentSprintEntries(sprint, 10);
    expect(entries).toHaveLength(3);
  });

  it("entry includes correct date", () => {
    const entries = extractRecentSprintEntries(sprint, 1);
    expect(entries[0].date).toBe("2026-03-04");
  });

  it("entry includes correct day name", () => {
    const entries = extractRecentSprintEntries(sprint, 1);
    expect(entries[0].day).toBe("Tuesday");
  });

  it("entry summary contains first content line", () => {
    const entries = extractRecentSprintEntries(sprint, 1);
    expect(entries[0].summary).toContain("Shipped CS-158 and CS-159");
  });

  it("returns empty array when no date headers found", () => {
    expect(
      extractRecentSprintEntries("# No entries here\n- Just text", 3),
    ).toEqual([]);
  });

  it("returns empty array for empty content", () => {
    expect(extractRecentSprintEntries("", 3)).toEqual([]);
  });

  it("stops collecting at next section header", () => {
    const content = [
      "### 2026-03-01 (Saturday)",
      "Line one",
      "## New Top Section",
      "This should not be in the entry",
    ].join("\n");
    const entries = extractRecentSprintEntries(content, 1);
    expect(entries[0].summary).not.toContain("This should not");
  });
});

// ─── countBacklogItems ────────────────────────────────────────────────────────

describe("countBacklogItems", () => {
  const backlog = [
    "## 🚨 P0 - Critical",
    "- **CS-001** | Fix auth bug | High",
    "- **CS-002** | Fix login crash | High",
    "",
    "## ⚠️ P1 - Important",
    "- **CS-010** | Improve performance | Medium",
    "",
    "## 📋 P2 - Recommended",
    "",
    "## Other Section",
  ].join("\n");

  it("counts P0 items correctly", () => {
    expect(countBacklogItems(backlog).p0).toBe(2);
  });

  it("counts P1 items correctly", () => {
    expect(countBacklogItems(backlog).p1).toBe(1);
  });

  it("counts P2 as zero when section is empty", () => {
    expect(countBacklogItems(backlog).p2).toBe(0);
  });

  it("returns zeros for all sections when none present", () => {
    expect(countBacklogItems("# No backlog sections")).toEqual({
      p0: 0,
      p1: 0,
      p2: 0,
    });
  });

  it("returns zeros for empty content", () => {
    expect(countBacklogItems("")).toEqual({ p0: 0, p1: 0, p2: 0 });
  });

  it("counts multiple P0 items", () => {
    const content = [
      "## 🚨 P0 - Critical",
      "- **CS-001** | A | H",
      "- **CS-002** | B | H",
      "- **CS-003** | C | H",
      "",
      "## Next Section",
    ].join("\n");
    expect(countBacklogItems(content).p0).toBe(3);
  });
});

// ─── extractTopBacklogItems ───────────────────────────────────────────────────

describe("extractTopBacklogItems", () => {
  const backlog = [
    "- **CS-001** | Fix authentication | High",
    "- **CS-002** | Improve performance | Medium",
    "- **CS-003** | Add dark mode | Low",
    "- **CS-004** | Refactor auth | Low",
  ].join("\n");

  it("extracts item IDs correctly", () => {
    const items = extractTopBacklogItems(backlog, 3);
    expect(items.map((i) => i.id)).toEqual(["CS-001", "CS-002", "CS-003"]);
  });

  it("extracts item titles correctly", () => {
    const items = extractTopBacklogItems(backlog, 1);
    expect(items[0].title).toBe("Fix authentication");
  });

  it("limits to N items", () => {
    expect(extractTopBacklogItems(backlog, 2)).toHaveLength(2);
  });

  it("returns all items when fewer than N exist", () => {
    expect(extractTopBacklogItems(backlog, 10)).toHaveLength(4);
  });

  it("returns empty array for no matching lines", () => {
    expect(extractTopBacklogItems("No items here", 5)).toEqual([]);
  });

  it("returns empty array for empty content", () => {
    expect(extractTopBacklogItems("", 5)).toEqual([]);
  });

  it("ignores lines that do not match the item pattern", () => {
    const mixed =
      "## Section\n- **CS-001** | Valid item | High\n- Not an item\n## Another";
    const items = extractTopBacklogItems(mixed, 5);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("CS-001");
  });
});

// ─── extractRecentCompleted ───────────────────────────────────────────────────

describe("extractRecentCompleted", () => {
  it("returns empty when Completed section is absent", () => {
    expect(extractRecentCompleted("## Active\n- **CS-001** item", 5)).toEqual(
      [],
    );
  });

  it("returns empty for empty content", () => {
    expect(extractRecentCompleted("", 5)).toEqual([]);
  });

  it("limits results to N items", () => {
    const content = [
      "## Completed ✅",
      "- **CS-001** | Item one | 2026-01-01 |",
      "- **CS-002** | Item two | 2026-01-02 |",
      "- **CS-003** | Item three | 2026-01-03 |",
    ].join("\n");
    expect(extractRecentCompleted(content, 2)).toHaveLength(2);
  });

  it("extracts id, title, and date from dash-style entries", () => {
    const content = [
      "## Completed ✅",
      "- **CS-001** | Fix login | 2026-03-01 |",
    ].join("\n");
    const items = extractRecentCompleted(content, 5);
    expect(items[0]).toEqual({
      id: "CS-001",
      title: "Fix login",
      date: "2026-03-01",
    });
  });

  it("stops at the next section header", () => {
    const content = [
      "## Completed ✅",
      "- **CS-001** | Done thing | 2026-03-01 |",
      "",
      "## Backlog",
      "- **CS-999** | Not done | 2026-03-02 |",
    ].join("\n");
    const items = extractRecentCompleted(content, 5);
    expect(items.map((i) => i.id)).toEqual(["CS-001"]);
  });
});

// ─── generateIndex ────────────────────────────────────────────────────────────

const README = [
  "# demo-project v2.5.1",
  "",
  "## Current Status",
  "- Shipping the status index",
].join("\n");

const SPRINT = [
  "# Sprint 12",
  "",
  "**Goal**: Ship the status index",
  "**Status**: In progress",
  "**Duration**: 2 weeks",
  "",
  "## Daily Log",
  "",
  "### 2026-03-04 (Wednesday)",
  "Wired up generateIndex",
  "",
  "### 2026-03-03 (Tuesday)",
  "Reviewed the backlog",
].join("\n");

const BACKLOG = [
  "# Backlog",
  "",
  "## 🚨 P0 - Critical",
  "- **DX-001** | Fix the crash | High",
  "",
  "## ⚠️ P1 - Important",
  "- **DX-002** | Speed up boot | Medium",
  "- **DX-003** | Add dark mode | Low",
  "",
  "## 📋 P2 - Recommended",
  "- **DX-004** | Polish docs | Low",
  "",
  "## Completed ✅",
  "- **DX-000** | Bootstrap repo | 2026-02-01 |",
].join("\n");

describe("generateIndex", () => {
  it("builds a full index from README, backlog, and sprint files", () => {
    const dir = makeProject({
      "README.md": README,
      "backlog.md": BACKLOG,
      "planning/current-sprint.md": SPRINT,
    });

    const index = generateIndex(dir);

    expect(index.project).toBe(path.basename(dir));
    expect(index.version).toBe("2.5.1");
    expect(index.focus).toBe("Shipping the status index");
    expect(index.last_updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect(index.sprint.goal).toBe("Ship the status index");
    expect(index.sprint.status).toBe("In progress");
    expect(index.sprint.duration).toBe("2 weeks");
    expect(index.sprint.recent_entries.map((e) => e.date)).toEqual([
      "2026-03-04",
      "2026-03-03",
    ]);

    expect(index.backlog.counts).toEqual({ p0: 1, p1: 2, p2: 1 });
    // top_items scans the whole file, so it picks up items across all sections.
    expect(index.backlog.top_items.map((i) => i.id)).toEqual([
      "DX-001",
      "DX-002",
      "DX-003",
      "DX-004",
      "DX-000",
    ]);
    expect(index.backlog.recent_completed).toEqual([
      { id: "DX-000", title: "Bootstrap repo", date: "2026-02-01" },
    ]);
  });

  it("degrades gracefully when every source file is missing", () => {
    const dir = makeProject();

    const index = generateIndex(dir);

    expect(index.version).toBe("unknown");
    expect(index.focus).toBe("See README.md");
    expect(index.sprint).toEqual({
      goal: "Not specified",
      status: "Unknown",
      duration: "Unknown",
      recent_entries: [],
    });
    expect(index.backlog).toEqual({
      counts: { p0: 0, p1: 0, p2: 0 },
      top_items: [],
      recent_completed: [],
    });
  });

  it("reads the sprint file from planning/current-sprint.md specifically", () => {
    // A sprint file at the project root must be ignored.
    const dir = makeProject({
      "README.md": README,
      "current-sprint.md": SPRINT,
    });
    expect(generateIndex(dir).sprint.goal).toBe("Not specified");
  });

  it("caps recent sprint entries at 3", () => {
    const many = Array.from(
      { length: 6 },
      (_, i) => `### 2026-03-0${i + 1} (Monday)\nEntry ${i}\n`,
    ).join("\n");
    const dir = makeProject({ "planning/current-sprint.md": many });
    expect(generateIndex(dir).sprint.recent_entries).toHaveLength(3);
  });

  it("caps top backlog items at 5", () => {
    const items = Array.from(
      { length: 9 },
      (_, i) => `- **DX-0${i + 1}** | Item ${i} | Low`,
    ).join("\n");
    const dir = makeProject({ "backlog.md": items });
    expect(generateIndex(dir).backlog.top_items).toHaveLength(5);
  });
});

// ─── writeIndex / readIndex round-trip ────────────────────────────────────────

describe("writeIndex", () => {
  it("writes .status-index.json into the project dir and returns its path", () => {
    const dir = makeProject();
    const index = { project: "demo", version: "1.0.0" };

    const indexPath = writeIndex(dir, index);

    expect(indexPath).toBe(path.join(dir, ".status-index.json"));
    expect(JSON.parse(fs.readFileSync(indexPath, "utf8"))).toEqual(index);
  });

  it("overwrites an existing index", () => {
    const dir = makeProject({ ".status-index.json": '{"version":"0.0.1"}' });
    writeIndex(dir, { version: "9.9.9" });
    expect(readIndex(dir).version).toBe("9.9.9");
  });
});

describe("readIndex", () => {
  it("round-trips an index written by writeIndex", () => {
    const dir = makeProject({
      "README.md": README,
      "backlog.md": BACKLOG,
      "planning/current-sprint.md": SPRINT,
    });
    const generated = generateIndex(dir);
    writeIndex(dir, generated);
    expect(readIndex(dir)).toEqual(generated);
  });

  it("returns null when no index file exists", () => {
    expect(readIndex(makeProject())).toBeNull();
  });

  it("returns null and logs when the index is malformed JSON", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = makeProject({ ".status-index.json": "{ truncated" });

    expect(readIndex(dir)).toBeNull();
    expect(err.mock.calls.flat().join(" ")).toContain("Failed to parse");
  });
});

// ─── CLI ──────────────────────────────────────────────────────────────────────

describe("CLI", () => {
  let log;
  let err;

  beforeEach(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => {});
    err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ExitSignal(code);
    });
  });

  it("`generate <dir>` writes the index and prints the path", () => {
    const dir = makeProject({ "README.md": README, "backlog.md": BACKLOG });

    expect(runCli("generate", dir).code).toBe(0);

    const written = readIndex(dir);
    expect(written.version).toBe("2.5.1");
    expect(log.mock.calls.flat().join("\n")).toContain(
      path.join(dir, ".status-index.json"),
    );
  });

  it("`read <dir>` prints the existing index", () => {
    const dir = makeProject();
    writeIndex(dir, { project: "demo", version: "3.2.1" });

    expect(runCli("read", dir).code).toBe(0);
    expect(log.mock.calls.flat().join("\n")).toContain('"version": "3.2.1"');
  });

  it("`read` exits 1 when no index exists", () => {
    expect(runCli("read", makeProject()).code).toBe(1);
    expect(err.mock.calls.flat().join(" ")).toContain("No status index found");
  });

  it("exits 1 with usage on an unknown command", () => {
    expect(runCli("frobnicate", makeProject()).code).toBe(1);
    expect(err.mock.calls.flat().join(" ")).toContain("Usage:");
  });

  it("exits 1 with usage when no command is given", () => {
    expect(runCli().code).toBe(1);
    expect(err.mock.calls.flat().join(" ")).toContain("Usage:");
  });

  it("defaults the project dir to cwd when omitted", () => {
    const dir = makeProject({ "README.md": README });
    vi.spyOn(process, "cwd").mockReturnValue(dir);

    expect(runCli("generate").code).toBe(0);
    expect(readIndex(dir).version).toBe("2.5.1");
  });
});
