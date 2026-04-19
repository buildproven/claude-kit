const {
  extractVersion,
  extractFocus,
  extractRecentSprintEntries,
  countBacklogItems,
  extractTopBacklogItems,
  extractRecentCompleted,
} = require("../status-index");

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
});
