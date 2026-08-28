import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const script = readFileSync(
  path.resolve(import.meta.dirname, "..", "quality-authorize-merge.sh"),
  "utf8",
);

describe("quality merge authorization action boundary", () => {
  it("requires direct green-CI evidence for autonomous ref-CAS", () => {
    expect(script).toMatch(
      /CI_GREEN_VERIFIED=false[\s\S]*quality-required-checks\.js" assert[\s\S]*CI_GREEN_VERIFIED=true/,
    );
    expect(script).toMatch(
      /MERGE_MODE" = protected-nonstrict-ref-cas[\s\S]*NONSTRICT_REFCAS_CAPABILITY" != true[\s\S]*CI_GREEN_VERIFIED" != true[\s\S]*record_merge_admission_blocked_terminal[\s\S]*"ci:failed"/,
    );
  });

  it("keeps autonomous ref-CAS unavailable to human-required campaigns", () => {
    expect(script).toMatch(
      /MERGE_MODE" = protected-nonstrict-ref-cas[\s\S]*NONSTRICT_REFCAS_CAPABILITY" != true[\s\S]*MERGE_AUTHORITY" != autonomous[\s\S]*human-required protected non-strict ref-CAS needs exact signed authority/,
    );
  });

  it("fails on protected non-strict inspection errors other than an unprotected 404", () => {
    expect(script).toMatch(
      /PROTECTED_NONSTRICT_RC[\s\S]*3:\*[\s\S]*Branch not protected[\s\S]*Not Found \(HTTP 404\)[\s\S]*protected non-strict ref-CAS classification failed[\s\S]*exit 1/,
    );
  });

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
