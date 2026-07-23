const fs = require("fs");
const os = require("os");
const path = require("path");
const { validateRecord } = require("../quality-telemetry");
const { writePreflight } = require("../quality-telemetry-preflight");

describe("quality telemetry preflight", () => {
  it("writes one valid attribution record per arm without a campaign verdict", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quality-preflight-"));
    const output = path.join(dir, "preflight.jsonl");
    const records = writePreflight(output, "2026-07-22T00:00:00.000Z");
    expect(records.map((record) => record.reviewArm).sort()).toEqual([
      "bespoke",
      "native",
    ]);
    expect(
      records.map(({ reviewArm, reviewProvider }) => [
        reviewArm,
        reviewProvider,
      ]),
    ).toEqual([
      ["bespoke", "claude"],
      ["native", "codex"],
    ]);
    for (const record of records) {
      expect(validateRecord(record)).toBe(true);
      expect(record).toMatchObject({ preflight: true, verdict: null });
    }
    expect(fs.readFileSync(output, "utf8").trim().split("\n")).toHaveLength(2);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
