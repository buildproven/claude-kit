const {
  analyze,
  deriveSlug,
  detectInlineList,
  isItemLine,
  parseInlineList,
  stripItemPrefix,
} = require("../inline-list-parser");

// ─── parseInlineList ──────────────────────────────────────────────────────────

describe("parseInlineList", () => {
  it("returns an empty array for empty input", () => {
    expect(parseInlineList("")).toEqual([]);
    expect(parseInlineList(null)).toEqual([]);
    expect(parseInlineList(undefined)).toEqual([]);
  });

  it("extracts a single bullet (but flagged as not-a-list elsewhere)", () => {
    expect(parseInlineList("- only one thing")).toEqual(["only one thing"]);
  });

  it("extracts dash-bulleted items", () => {
    const input = `- add dark mode\n- fix login redirect\n- refactor auth`;
    expect(parseInlineList(input)).toEqual([
      "add dark mode",
      "fix login redirect",
      "refactor auth",
    ]);
  });

  it("extracts asterisk-bulleted items", () => {
    const input = `* item one\n* item two`;
    expect(parseInlineList(input)).toEqual(["item one", "item two"]);
  });

  it("extracts plus-bulleted items", () => {
    const input = `+ first\n+ second`;
    expect(parseInlineList(input)).toEqual(["first", "second"]);
  });

  it("handles mixed bullet styles", () => {
    const input = `- alpha\n* beta\n+ gamma`;
    expect(parseInlineList(input)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("extracts numbered items with dots", () => {
    const input = `1. first task\n2. second task\n3. third task`;
    expect(parseInlineList(input)).toEqual([
      "first task",
      "second task",
      "third task",
    ]);
  });

  it("extracts numbered items with parentheses", () => {
    const input = `1) one\n2) two`;
    expect(parseInlineList(input)).toEqual(["one", "two"]);
  });

  it("folds nested detail lines into the previous item", () => {
    const input = [
      "- implement caching",
      "  must support Redis and memory",
      "  invalidate on write",
      "- add metrics endpoint",
    ].join("\n");
    expect(parseInlineList(input)).toEqual([
      "implement caching must support Redis and memory invalidate on write",
      "add metrics endpoint",
    ]);
  });

  it("does NOT treat inline dashes as bullets on a single line", () => {
    const input = "fix logging - the timestamps are wrong";
    expect(parseInlineList(input)).toEqual([]);
  });

  it("ignores leading prose before the first bullet", () => {
    const input = `Here are the tasks:\n- task one\n- task two`;
    expect(parseInlineList(input)).toEqual(["task one", "task two"]);
  });

  it("handles trailing whitespace and blank lines between items", () => {
    const input = `- one\n\n- two\n\n\n- three`;
    expect(parseInlineList(input)).toEqual(["one", "two", "three"]);
  });

  it("handles indented bullets", () => {
    const input = `  - one\n  - two`;
    expect(parseInlineList(input)).toEqual(["one", "two"]);
  });
});

// ─── detectInlineList ─────────────────────────────────────────────────────────

describe("detectInlineList", () => {
  it("returns false for empty input", () => {
    expect(detectInlineList("")).toBe(false);
  });

  it("returns false for a single bullet (one item is just a task)", () => {
    expect(detectInlineList("- only one thing")).toBe(false);
    expect(detectInlineList("1. only one thing")).toBe(false);
  });

  it("returns true for 2+ bullets", () => {
    expect(detectInlineList("- a\n- b")).toBe(true);
  });

  it("returns true for 2+ numbered items", () => {
    expect(detectInlineList("1. a\n2. b")).toBe(true);
  });

  it("returns false for a single line with a dash in the middle", () => {
    expect(detectInlineList("fix logging - timestamps wrong")).toBe(false);
  });

  it("returns false for a plain task description", () => {
    expect(
      detectInlineList("add a dark mode toggle to the settings page"),
    ).toBe(false);
  });

  it("returns true even with nested detail on each item", () => {
    const input = [
      "- task one",
      "  with some detail",
      "- task two",
      "  more detail",
    ].join("\n");
    expect(detectInlineList(input)).toBe(true);
  });
});

// ─── stripItemPrefix / isItemLine ─────────────────────────────────────────────

describe("stripItemPrefix", () => {
  it("strips dash bullet", () => {
    expect(stripItemPrefix("- hello")).toBe("hello");
  });

  it("strips asterisk bullet", () => {
    expect(stripItemPrefix("* hello")).toBe("hello");
  });

  it("strips numbered with dot", () => {
    expect(stripItemPrefix("1. hello")).toBe("hello");
  });

  it("strips numbered with paren", () => {
    expect(stripItemPrefix("42) hello")).toBe("hello");
  });

  it("returns null for non-item lines", () => {
    expect(stripItemPrefix("plain text")).toBeNull();
    expect(stripItemPrefix("")).toBeNull();
    expect(stripItemPrefix(null)).toBeNull();
  });
});

describe("isItemLine", () => {
  it("detects item lines", () => {
    expect(isItemLine("- x")).toBe(true);
    expect(isItemLine("1. x")).toBe(true);
    expect(isItemLine("plain")).toBe(false);
  });
});

// ─── deriveSlug ───────────────────────────────────────────────────────────────

describe("deriveSlug", () => {
  it("produces a kebab-case slug", () => {
    expect(deriveSlug("Add Dark Mode Toggle")).toBe("add-dark-mode-toggle");
  });

  it("caps at ~5 words by default", () => {
    expect(deriveSlug("one two three four five six seven eight nine")).toBe(
      "one-two-three-four-five",
    );
  });

  it("strips punctuation", () => {
    expect(deriveSlug("Fix: login redirect (urgent!)")).toBe(
      "fix-login-redirect-urgent",
    );
  });

  it("strips markdown emphasis chars", () => {
    expect(deriveSlug("**bold** _task_")).toBe("bold-task");
  });

  it('falls back to "task" for empty/garbage input', () => {
    expect(deriveSlug("")).toBe("task");
    expect(deriveSlug("!!!")).toBe("task");
    expect(deriveSlug(null)).toBe("task");
  });

  it("respects maxWords param", () => {
    expect(deriveSlug("one two three four", 2)).toBe("one-two");
  });
});

// ─── analyze ──────────────────────────────────────────────────────────────────

describe("analyze", () => {
  it("returns isList=false for a single task", () => {
    const result = analyze("add a search bar");
    expect(result.isList).toBe(false);
    expect(result.items).toEqual([]);
    expect(result.slugs).toEqual([]);
  });

  it("returns isList=true with items and slugs for a 2+ item list", () => {
    const result = analyze("- add dark mode\n- fix login redirect");
    expect(result.isList).toBe(true);
    expect(result.items).toEqual(["add dark mode", "fix login redirect"]);
    expect(result.slugs).toEqual(["add-dark-mode", "fix-login-redirect"]);
  });

  it("disambiguates duplicate slugs with a numeric suffix", () => {
    const result = analyze("- Refactor auth module\n- refactor auth module");
    expect(result.isList).toBe(true);
    expect(result.slugs).toEqual([
      "refactor-auth-module",
      "refactor-auth-module-2",
    ]);
  });

  it("does NOT treat single bullet as list", () => {
    const result = analyze("- only one thing here");
    expect(result.isList).toBe(false);
  });
});
