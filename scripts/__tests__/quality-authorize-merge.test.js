import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const script = readFileSync(
  path.resolve(import.meta.dirname, "..", "quality-authorize-merge.sh"),
  "utf8",
);

describe("quality merge authorization action boundary", () => {
  it("returns the typed action-required exit for missing strict freshness", () => {
    const branch = script.match(
      /\*\)\n(?<body>[\s\S]*?the PR base lacks server-enforced strict freshness[\s\S]*?)\n\s*;;/,
    );
    expect(branch?.groups?.body).toContain("record_merge_admission_block");
    expect(branch?.groups?.body).toContain(
      '"base:protected-nonstrict,pr:non-atomic-state"',
    );
    expect(
      branch?.groups?.body.indexOf("record_merge_admission_block"),
    ).toBeLessThan(branch?.groups?.body.indexOf("exit 3") ?? -1);
    expect(branch?.groups?.body).toContain("exit 3");
  });
});
