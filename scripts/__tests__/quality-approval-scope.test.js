import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { assertCiBillingConditions, parseApprovalCommand } = require(
  path.resolve(import.meta.dirname, "..", "quality-wrapper.js"),
);
const { assertApprovalPayloadShape } = require(
  path.resolve(import.meta.dirname, "..", "quality-invocation.js"),
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
      "--reason",
      "known Actions billing outage",
      "--ci-failure",
      "failed",
      "--accept",
      "ci:failed",
      "--i-understand-missing-ci",
    ]);
    expect(parsed).toMatchObject({
      scope: "operator-ci-billing-override",
      reason: "known Actions billing outage",
      ciFailureReason: "failed",
      acceptedConditions: ["ci:failed"],
    });
    expect(parsed.argv).not.toContain("--override-ci-billing");
  });

  it("maps the protected non-strict ref-CAS override to its distinct scope", () => {
    const parsed = parseApprovalCommand([
      "approve",
      "--pr",
      "676",
      "--head",
      head,
      "--override-nonstrict-refcas",
      "--reason",
      "Actions cannot allocate a runner",
      "--ci-failure",
      "failed",
      "--accept",
      "ci:failed,base:protected-nonstrict",
      "--i-understand-missing-ci",
      "--i-understand-admin-ref-mutation",
    ]);
    expect(parsed).toMatchObject({
      scope: "operator-nonstrict-refcas-override",
      acceptedConditions: ["ci:failed", "base:protected-nonstrict"],
    });
    expect(parsed.argv).not.toContain("--override-nonstrict-refcas");
  });

  it("requires the separate administrator ref-mutation acknowledgement", () => {
    expect(() =>
      parseApprovalCommand([
        "approve",
        "--pr",
        "676",
        "--head",
        head,
        "--override-nonstrict-refcas",
        "--reason",
        "Actions cannot allocate a runner",
        "--ci-failure",
        "failed",
        "--accept",
        "ci:failed,base:protected-nonstrict",
        "--i-understand-missing-ci",
      ]),
    ).toThrow(/--i-understand-admin-ref-mutation/);
  });

  it("allows a quality override to compose an exact CI failure", () => {
    const parsed = parseApprovalCommand([
      "approve",
      "--pr",
      "676",
      "--head",
      head,
      "--override-quality",
      "--reason",
      "provider review is exhausted and Actions runners are unavailable",
      "--ci-failure",
      "failed",
      "--accept",
      "review:provider-exhaustion,ci:failed",
      "--i-understand-missing-review",
      "--i-understand-missing-ci",
    ]);
    expect(parsed).toMatchObject({
      scope: "operator-quality-override",
      ciFailureReason: "failed",
      acceptedConditions: ["review:provider-exhaustion", "ci:failed"],
    });
  });

  it("validates the CI condition inside a composed quality override", () => {
    const diagnosed = [
      { id: "review:provider-exhaustion" },
      { id: "ci:failed" },
    ];
    expect(() =>
      assertCiBillingConditions(
        "operator-quality-override",
        "failed",
        diagnosed,
        ["review:provider-exhaustion", "ci:failed"],
      ),
    ).not.toThrow();
    expect(() =>
      assertCiBillingConditions(
        "operator-quality-override",
        "unavailable",
        diagnosed,
        ["review:provider-exhaustion", "ci:failed"],
      ),
    ).toThrow(/ci:unavailable/);
  });

  it("rejects a billing override that omits the CI condition", () => {
    expect(() =>
      assertApprovalPayloadShape(
        {
          stateRoot: "/tmp/quality-test-state",
          repo: { githubRepository: "owner/repo" },
          revisions: { currentHead: head },
        },
        {
          scope: "operator-ci-billing-override",
          reason: "Actions billing outage",
          acceptedConditions: ["review:provider-exhaustion"],
        },
      ),
    ).toThrow(/exactly ci:failed/);
  });

  it("rejects a protected non-strict capability without a protection digest", () => {
    expect(() =>
      assertApprovalPayloadShape(
        {
          stateRoot: "/tmp/quality-test-state",
          repo: { githubRepository: "owner/repo" },
          revisions: { currentHead: head },
        },
        {
          scope: "operator-nonstrict-refcas-override",
          reason: "Actions outage",
          acceptedConditions: ["ci:failed", "base:protected-nonstrict"],
          ciBillingEvidenceSha256: "b".repeat(64),
        },
      ),
    ).toThrow(/missing protection binding/);
  });

  it("requires a classified CI failure for the billing override", () => {
    expect(() =>
      parseApprovalCommand([
        "approve",
        "--pr",
        "676",
        "--head",
        head,
        "--override-ci-billing",
        "--reason",
        "known Actions billing outage",
        "--accept",
        "ci:failed",
        "--i-understand-missing-ci",
      ]),
    ).toThrow(/--ci-failure/);
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
      "--reason",
      "known Actions billing outage",
      "--ci-failure",
      "failed",
      "--accept",
      "ci:failed",
      "--i-understand-missing-ci",
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
