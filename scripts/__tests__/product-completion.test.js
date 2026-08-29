import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { validate, verifyClaim, next } from "../product-completion.js";

function files({ phase = "implementation", checked = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "product-completion-"));
  const prd = path.join(dir, "towns-prd.md");
  const tasks = path.join(dir, "towns-tasks.md");
  writeFileSync(
    prd,
    "# PRD\n\n## User stories\n\n- As a buyer, I compare towns.\n",
  );
  writeFileSync(
    tasks,
    `- [${checked ? "x" : " "}] 2.0 Find similar towns\n  - Phase: ${phase}\n  - Delivers: A user receives ten explainable alternatives.\n  - Evidence: browser journey + API behavior test\n`,
  );
  return { prd, tasks };
}

const HEAD = "a".repeat(40);

function receipt(dir, kind, fields) {
  const file = path.join(dir, `${kind}.json`);
  writeFileSync(
    file,
    `${JSON.stringify({ schemaVersion: 1, kind, head: HEAD, observedAt: "2026-08-29T12:00:00Z", ...fields })}\n`,
  );
  return {
    receipt: path.basename(file),
    sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
  };
}

function evidence(dir) {
  const value = {
    behavioralTests: receipt(dir, "behavioralTests", {
      command: "npm test -- towns",
      artifact: "artifacts/towns-tests.json",
    }),
    acceptanceEvidence: receipt(dir, "acceptanceEvidence", {
      artifact: "artifacts/towns-browser.json",
    }),
  };
  const file = path.join(dir, "evidence.json");
  writeFileSync(file, `${JSON.stringify(value)}\n`);
  return { value, file };
}

describe("product completion", () => {
  it("requires a phase and an implementation task for user-facing work", () => {
    const { prd, tasks } = files({ phase: "contract" });
    const local = evidence(path.dirname(prd));
    const result = validate(prd, tasks);
    expect(result.valid).toBe(false);
    expect(
      verifyClaim(result, "local-product", ["src/towns.js"], local.value, {
        head: HEAD,
        evidencePath: local.file,
      }).valid,
    ).toBe(false);
  });

  it("rejects user-facing contract-only task lists", () => {
    const { prd, tasks } = files({ phase: "contract", checked: true });
    expect(next(validate(prd, tasks)).status).toBe("UNVERIFIED");
  });

  it("keeps hosted and real-user validation separate from local proof", () => {
    const { prd, tasks } = files();
    const result = validate(prd, tasks);
    const local = evidence(path.dirname(prd));
    expect(
      verifyClaim(result, "local-product", ["src/towns.js"], local.value, {
        head: HEAD,
        evidencePath: local.file,
      }).valid,
    ).toBe(true);
    expect(
      verifyClaim(result, "hosted", ["src/towns.js"], local.value, {
        head: HEAD,
        evidencePath: local.file,
      }).valid,
    ).toBe(false);
    expect(
      verifyClaim(
        result,
        "validated",
        ["src/towns.js"],
        {
          ...local.value,
        },
        { head: HEAD, evidencePath: local.file },
      ).valid,
    ).toBe(false);
  });

  it("rejects self-attested evidence and test-only source changes", () => {
    const { prd, tasks } = files();
    const result = validate(prd, tasks);
    const local = evidence(path.dirname(prd));
    expect(
      verifyClaim(
        result,
        "local-product",
        ["scripts/__tests__/towns.test.js"],
        local.value,
        { head: HEAD, evidencePath: local.file },
      ).valid,
    ).toBe(false);
  });

  it("requires a receipt digest bound to the candidate head", () => {
    const { prd, tasks } = files();
    const local = evidence(path.dirname(prd));
    local.value.behavioralTests.sha256 = "0".repeat(64);
    expect(
      verifyClaim(
        validate(prd, tasks),
        "local-product",
        ["server/towns.js"],
        local.value,
        {
          head: HEAD,
          evidencePath: local.file,
        },
      ).valid,
    ).toBe(false);
  });

  it("rejects a receipt from another candidate head", () => {
    const { prd, tasks } = files();
    const local = evidence(path.dirname(prd));
    expect(
      verifyClaim(
        validate(prd, tasks),
        "local-product",
        ["server/towns.js"],
        local.value,
        { head: "b".repeat(40), evidencePath: local.file },
      ).valid,
    ).toBe(false);
  });

  it("does not call a product done while a contract task is open", () => {
    const { prd, tasks } = files({ checked: true });
    writeFileSync(
      tasks,
      `- [ ] 1.0 Confirm data source\n  - Phase: contract\n  - Delivers: A confirmed source.\n  - Evidence: source decision\n\n- [x] 2.0 Find similar towns\n  - Phase: implementation\n  - Delivers: A user receives ten explainable alternatives.\n  - Evidence: browser journey + API behavior test\n`,
    );
    expect(next(validate(prd, tasks)).status).toBe("next-contract");
  });
});
