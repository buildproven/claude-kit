import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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

describe("product completion", () => {
  it("requires a phase and an implementation task for user-facing work", () => {
    const { prd, tasks } = files({ phase: "contract" });
    const result = validate(prd, tasks);
    expect(result.valid).toBe(false);
    expect(
      verifyClaim(result, "local-product", ["src/towns.js"], {
        behavioralTests: true,
        acceptanceEvidence: true,
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
    const local = { behavioralTests: true, acceptanceEvidence: true };
    expect(
      verifyClaim(result, "local-product", ["src/towns.js"], local).valid,
    ).toBe(true);
    expect(verifyClaim(result, "hosted", ["src/towns.js"], local).valid).toBe(
      false,
    );
    expect(
      verifyClaim(result, "validated", ["src/towns.js"], {
        ...local,
        deploymentReceipt: true,
        hostedJourney: true,
      }).valid,
    ).toBe(false);
  });
});
