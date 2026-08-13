import { describe, expect, it } from "vitest";
import {
  loadPolicy,
  resolve,
  validatePlan,
  validateRunRecord,
  calibrationDecision,
} from "../compute-governor";

const base = {
  provider: "codex",
  phase: "implement",
  localized: true,
  reversible: true,
  targetedProof: true,
  changedFiles: 1,
  protectedSurfaces: [],
  sameFailureStreak: 0,
};

describe("compute governor", () => {
  it("makes an eligible localized code change an economy-builder candidate", () => {
    const plan = resolve(base);
    expect(plan).toMatchObject({
      schemaVersion: 1,
      route: "economy-builder",
      provider: "codex",
      model: "gpt-5.6-luna",
      effort: "high",
      safetyFloor: "economy-micro",
      promotion: "candidate-requires-calibration",
    });
    expect(plan.reasons).toEqual([
      "no protected surface",
      "localized reversible behavior",
      "targeted deterministic proof",
    ]);
  });

  it("uses Haiku without fabricating an effort setting for economy-micro", () => {
    const plan = resolve({
      ...base,
      provider: "claude",
      phase: "scan",
      readOnly: true,
    });
    expect(plan).toMatchObject({
      route: "economy-micro",
      model: "claude-haiku-4-5",
      effort: null,
    });
  });

  it("requires standard work when targeted proof is missing", () => {
    const plan = resolve({ ...base, targetedProof: false });
    expect(plan.route).toBe("standard");
    expect(plan.reasons).toContain("targeted deterministic proof missing");
  });

  it("escalates two matching failures to expert", () => {
    const plan = resolve({ ...base, sameFailureStreak: 2 });
    expect(plan.route).toBe("expert");
    expect(plan.reasons).toContain("two matching failed attempts");
  });

  it("never lowers the protected floor for a tiny test-backed change", () => {
    const plan = resolve({ ...base, protectedSurfaces: ["auth"] });
    expect(plan.route).toBe("critical");
    expect(plan.safetyFloor).toBe("critical");
  });

  it("rejects a plan whose model/effort is not the configured mapping", () => {
    const plan = resolve(base);
    expect(() => validatePlan({ ...plan, effort: "xhigh" })).toThrow(
      "violates policy",
    );
  });

  it("rejects a run record that contains prompt or credential material", () => {
    const plan = resolve(base);
    expect(() =>
      validateRunRecord({
        schemaVersion: 1,
        plan,
        outcome: { status: "passed" },
        usage: null,
        prompt: "do not persist me",
      }),
    ).toThrow("forbidden run-record field 'prompt'");
    expect(() =>
      validateRunRecord({
        schemaVersion: 1,
        plan,
        outcome: { status: "passed", credentials: "forbidden" },
        usage: null,
      }),
    ).toThrow("forbidden run-record field 'credentials'");
  });

  it("loads a complete versioned policy", () => {
    const policy = loadPolicy();
    expect(policy.schemaVersion).toBe(1);
    expect(policy.routes.critical.providers.claude.model).toBe("claude-opus-5");
  });

  it("does not promote a cheaper candidate that loses acceptance quality", () => {
    const result = calibrationDecision({
      maxAcceptanceRateDrop: 0.05,
      baseline: [
        { accepted: true, gatesPassed: true, attempts: 1 },
        { accepted: true, gatesPassed: true, attempts: 1 },
      ],
      candidate: [
        { accepted: true, gatesPassed: true, attempts: 1 },
        { accepted: false, gatesPassed: false, attempts: 2 },
      ],
    });
    expect(result.status).toBe("candidate-only");
  });

  it("promotes only a candidate that meets both acceptance and retry thresholds", () => {
    const result = calibrationDecision({
      baseline: [
        { accepted: true, gatesPassed: true, attempts: 1 },
        { accepted: true, gatesPassed: true, attempts: 2 },
      ],
      candidate: [
        { accepted: true, gatesPassed: true, attempts: 1 },
        { accepted: true, gatesPassed: true, attempts: 1 },
      ],
    });
    expect(result.status).toBe("eligible-for-default");
  });
});
