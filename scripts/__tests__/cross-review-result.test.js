import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "cross-review-result.js");

describe("cross-review typed result", () => {
  it.each([
    [0, "complete"],
    [74, "unavailable"],
    [75, "exhausted"],
    [76, "timed-out"],
  ])("records advisory status %s as %s", (exitCode, status) => {
    const output = mkdtempSync(path.join(tmpdir(), "cross-review-result-"));
    const result = spawnSync(
      "node",
      [
        SCRIPT,
        "--output-dir",
        output,
        "--provider",
        "claude",
        "--head",
        "a".repeat(40),
        "--exit-code",
        String(exitCode),
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(
      JSON.parse(readFileSync(path.join(output, "result.json"), "utf8")),
    ).toMatchObject({ authority: "advisory", status, provider: "claude" });
  });
});
