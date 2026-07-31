import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { parseApprovalCommand } = require(
  path.resolve(import.meta.dirname, "..", "quality-wrapper.js"),
);

const head = "a".repeat(40);

describe("quality approve command scope parsing", () => {
  it("defaults to standard scope for a non-approve command", () => {
    expect(parseApprovalCommand(["status", "--manifest", "x"])).toMatchObject({
      explicit: false,
      scope: "standard",
    });
  });

  it("maps --override-quality to operator-quality-override", () => {
    const parsed = parseApprovalCommand([
      "approve",
      "--pr",
      "676",
      "--head",
      head,
      "--override-quality",
    ]);
    expect(parsed).toMatchObject({
      explicit: true,
      expectedPr: 676,
      expectedHead: head,
      scope: "operator-quality-override",
    });
    // The scope flag must never leak into the forwarded bootstrap argv —
    // bootstrap has no concept of these flags and would reject them.
    expect(parsed.argv).not.toContain("--override-quality");
  });

  it("maps --override-ci-billing to operator-ci-billing-override", () => {
    const parsed = parseApprovalCommand([
      "approve",
      "--pr",
      "676",
      "--head",
      head,
      "--override-ci-billing",
    ]);
    expect(parsed.scope).toBe("operator-ci-billing-override");
    expect(parsed.argv).not.toContain("--override-ci-billing");
  });

  it("rejects combining two override flags on one capability", () => {
    expect(() =>
      parseApprovalCommand([
        "approve",
        "--pr",
        "676",
        "--head",
        head,
        "--override-quality",
        "--override-ci-billing",
      ]),
    ).toThrow(/only one override flag/);
  });

  it("still requires --pr and a 40-character --head", () => {
    expect(() =>
      parseApprovalCommand([
        "approve",
        "--head",
        head,
        "--override-ci-billing",
      ]),
    ).toThrow(/requires --pr/);
    expect(() =>
      parseApprovalCommand(["approve", "--pr", "676", "--override-ci-billing"]),
    ).toThrow(/requires --head/);
  });

  it("forwards --pr through to bootstrap argv unchanged", () => {
    const parsed = parseApprovalCommand([
      "approve",
      "--pr",
      "676",
      "--head",
      head,
      "--override-ci-billing",
      "--merge",
    ]);
    expect(parsed.argv).toEqual(["--pr", "676", "--merge"]);
  });
});
