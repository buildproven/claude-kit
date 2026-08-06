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
    // BUI-575: --override-quality is now the legacy alias for the standalone
    // `override` verb and requires the same --reason/--accept as that verb —
    // there is exactly one way to mint an operator-quality-override
    // capability, and it always names the exact conditions being accepted.
    const parsed = parseApprovalCommand([
      "approve",
      "--pr",
      "676",
      "--head",
      head,
      "--override-quality",
      "--reason",
      "known transient outage, ops accepted",
      "--accept",
      "gate:lint",
    ]);
    expect(parsed).toMatchObject({
      explicit: true,
      expectedPr: 676,
      expectedHead: head,
      scope: "operator-quality-override",
      reason: "known transient outage, ops accepted",
      acceptedConditions: ["gate:lint"],
    });
    // The scope flag must never leak into the forwarded bootstrap argv —
    // bootstrap has no concept of these flags and would reject them.
    expect(parsed.argv).not.toContain("--override-quality");
    expect(parsed.argv).not.toContain("--reason");
    expect(parsed.argv).not.toContain("--accept");
  });

  it("still requires --reason and --accept for --override-quality", () => {
    expect(() =>
      parseApprovalCommand([
        "approve",
        "--pr",
        "676",
        "--head",
        head,
        "--override-quality",
      ]),
    ).toThrow(/requires --reason/);
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

  it("uses an exact manifest as bootstrap selector without forwarding approval identity", () => {
    const manifest = "/tmp/existing-quality-campaign/invocation.json";
    const parsed = parseApprovalCommand([
      "override",
      "--manifest",
      manifest,
      "--pr",
      "676",
      "--head",
      head,
      "--reason",
      "the exact campaign exhausted mutation capacity",
      "--accept",
      "mutation:missing",
      "--i-understand-security-risk",
    ]);

    expect(parsed).toMatchObject({
      expectedPr: 676,
      expectedHead: head,
      scope: "operator-quality-override",
    });
    expect(parsed.argv).toEqual(["--manifest", manifest]);
  });
});
