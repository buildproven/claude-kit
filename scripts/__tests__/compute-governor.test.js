import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "./helpers/tmp.js";
import {
  loadPolicy,
  resolve,
  resolveExecution,
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
      policyVersion: "2026-08-12",
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

  it.each([
    ["reset the user's password", "auth"],
    ["repair the sign-in flow", "auth"],
    ["change access control for editors", "authorization"],
  ])(
    "classifies omitted protected surfaces in %s",
    (promptText, expectedSurface) => {
      const target = makeTempDir("governor-protected-prompt-");
      const prompt = path.join(target, "prompt.txt");
      writeFileSync(prompt, `${promptText}\n`);
      execFileSync("git", ["init", "-q"], { cwd: target });
      execFileSync("git", ["config", "user.email", "tests@buildproven.local"], {
        cwd: target,
      });
      execFileSync("git", ["config", "user.name", "BuildProven Tests"], {
        cwd: target,
      });
      execFileSync("git", ["add", "."], { cwd: target });
      execFileSync("git", ["commit", "-qm", "fixture"], { cwd: target });

      const plan = resolveExecution(base, prompt, target);

      expect(plan.route).toBe("critical");
      expect(plan.safetyFloor).toBe("critical");
      expect(plan.executionBinding.classifiedProtectedSurfaces).toContain(
        expectedSurface,
      );
    },
  );

  it("rejects an unknown protected-surface spelling instead of lowering it", () => {
    expect(() =>
      resolve({ ...base, protectedSurfaces: ["authentcation"] }),
    ).toThrow("facts.protectedSurfaces is invalid");
  });

  it("rejects malformed execution protected surfaces before classification", () => {
    for (const protectedSurfaces of ["auth", { surface: "auth" }]) {
      expect(() =>
        resolveExecution(
          { ...base, protectedSurfaces },
          "/nonexistent/prompt",
          "/nonexistent/target",
        ),
      ).toThrow("facts.protectedSurfaces is invalid");
    }
  });

  it("rejects unsupported execution facts instead of silently omitting them", () => {
    expect(() => resolve({ ...base, emergencyOverride: true })).toThrow(
      "unsupported execution fact 'emergencyOverride'",
    );
  });

  it("rejects unsupported or sensitive execution facts", () => {
    expect(() => resolve({ ...base, prompt: "secret task" })).toThrow(
      "unsupported execution fact 'prompt'",
    );
  });

  it("rejects string booleans that could lower a protected floor", () => {
    expect(() => resolve({ ...base, publicContract: "true" })).toThrow(
      "numeric or route facts are invalid",
    );
    expect(() => resolve({ ...base, crossRepository: "false" })).toThrow(
      "numeric or route facts are invalid",
    );
  });

  it("rejects a low-cost plan whose bound facts require a protected floor", () => {
    const economy = resolve(base);
    expect(() =>
      validatePlan({
        ...economy,
        facts: { ...economy.facts, protectedSurfaces: ["auth"] },
      }),
    ).toThrow("not bound to its facts");
  });

  it("rejects a plan whose model/effort is not the configured mapping", () => {
    const plan = resolve(base);
    expect(() => validatePlan({ ...plan, effort: "xhigh" })).toThrow(
      "violates policy",
    );
  });

  it("rejects tampered safety floors and execution caps", () => {
    const plan = resolve(base);
    expect(() => validatePlan({ ...plan, safetyFloor: "critical" })).toThrow(
      "below its safety floor",
    );
    expect(() =>
      validatePlan({
        ...plan,
        caps: { ...plan.caps, maxWallSeconds: plan.caps.maxWallSeconds + 1 },
      }),
    ).toThrow("invalid execution plan contract");
  });

  it("rejects a plan whose declared facts no longer produce it", () => {
    const plan = resolve(base);
    expect(() =>
      validatePlan({
        ...plan,
        facts: { ...plan.facts, protectedSurfaces: ["auth"] },
      }),
    ).toThrow("execution plan is not bound to its facts");
  });

  it("accepts an equivalent plan regardless of JSON object key order", () => {
    const plan = resolve(base);
    const reordered = Object.fromEntries(Object.entries(plan).reverse());
    reordered.facts = Object.fromEntries(Object.entries(plan.facts).reverse());
    reordered.caps = Object.fromEntries(Object.entries(plan.caps).reverse());
    expect(validatePlan(reordered)).toEqual(reordered);
  });

  it("rejects unexpected or sensitive fields in an execution binding", () => {
    const plan = {
      ...resolve(base),
      route: "standard",
      model: "gpt-5.6-terra",
      effort: "medium",
      caps: { maxWallSeconds: 1800, maxWorkers: 1 },
      reasons: [
        ...resolve(base).reasons,
        "economy candidate lacks approved calibration",
      ],
      promotion: "calibration-required-standard-fallback",
      executionBinding: {
        schemaVersion: 1,
        policyVersion: "2026-08-12",
        promptSha256: "a".repeat(64),
        targetIdentitySha256: "b".repeat(64),
        targetHead: "c".repeat(40),
        classifiedProtectedSurfaces: [],
      },
    };
    const invalidPlan = {
      ...plan,
      executionBinding: {
        ...plan.executionBinding,
        password: "must-not-persist",
      },
    };

    expect(() => validatePlan(invalidPlan)).toThrow(
      "execution binding schema mismatch",
    );
    expect(() =>
      validateRunRecord({
        schemaVersion: 1,
        plan: invalidPlan,
        requested: {
          provider: plan.provider,
          model: plan.model,
          effort: plan.effort,
        },
        effective: {
          provider: plan.provider,
          model: plan.model,
          effort: plan.effort,
        },
        outcome: {
          status: "passed",
          exitCode: 0,
          providerFailureCategory: null,
        },
        timing: { startedAtEpochMs: 1, finishedAtEpochMs: 2 },
        attempts: 1,
        usage: null,
      }),
    ).toThrow("execution binding schema mismatch");
  });

  it("accepts full SHA-256 Git object IDs in execution bindings", () => {
    const candidate = resolve(base);
    const plan = {
      ...candidate,
      route: "standard",
      model: "gpt-5.6-terra",
      effort: "medium",
      caps: { maxWallSeconds: 1800, maxWorkers: 1 },
      reasons: [
        ...candidate.reasons,
        "economy candidate lacks approved calibration",
      ],
      promotion: "calibration-required-standard-fallback",
      executionBinding: {
        schemaVersion: 1,
        policyVersion: "2026-08-12",
        promptSha256: "a".repeat(64),
        targetIdentitySha256: "b".repeat(64),
        targetHead: "c".repeat(64),
        classifiedProtectedSurfaces: [],
      },
    };
    expect(validatePlan(plan)).toEqual(plan);
  });

  it("rejects a run record that contains prompt or credential material", () => {
    const plan = resolve(base);
    expect(() =>
      validateRunRecord({
        schemaVersion: 1,
        plan,
        requested: {
          provider: plan.provider,
          model: plan.model,
          effort: plan.effort,
        },
        effective: {
          provider: plan.provider,
          model: plan.model,
          effort: plan.effort,
        },
        outcome: {
          status: "passed",
          exitCode: 0,
          providerFailureCategory: null,
        },
        timing: { startedAtEpochMs: 1, finishedAtEpochMs: 2 },
        attempts: 1,
        usage: null,
        prompt: "do not persist me",
      }),
    ).toThrow("forbidden run-record field 'prompt'");
    expect(() =>
      validateRunRecord({
        schemaVersion: 1,
        plan,
        requested: {
          provider: plan.provider,
          model: plan.model,
          effort: plan.effort,
        },
        effective: {
          provider: plan.provider,
          model: plan.model,
          effort: plan.effort,
        },
        outcome: {
          status: "passed",
          providerFailureCategory: null,
          credentials: "forbidden",
        },
        timing: { startedAtEpochMs: 1, finishedAtEpochMs: 2 },
        attempts: 1,
        usage: null,
      }),
    ).toThrow("forbidden run-record field 'credentials'");
  });

  it("rejects contradictory outcome evidence", () => {
    const plan = resolve(base);
    const record = {
      schemaVersion: 1,
      plan,
      requested: {
        provider: plan.provider,
        model: plan.model,
        effort: plan.effort,
      },
      effective: {
        provider: plan.provider,
        model: plan.model,
        effort: plan.effort,
      },
      attempts: 1,
      timing: { startedAtEpochMs: 1, finishedAtEpochMs: 2 },
      outcome: {
        status: "passed",
        exitCode: 1,
        providerFailureCategory: "provider-error",
      },
      usage: null,
    };
    expect(() => validateRunRecord(record)).toThrow(
      "invalid run record contract",
    );
  });

  it("rejects arbitrary provider usage metadata until its schema is allowlisted", () => {
    const plan = resolve(base);
    const record = {
      schemaVersion: 1,
      plan,
      requested: {
        provider: plan.provider,
        model: plan.model,
        effort: plan.effort,
      },
      effective: {
        provider: plan.provider,
        model: plan.model,
        effort: plan.effort,
      },
      attempts: 1,
      timing: { startedAtEpochMs: 1, finishedAtEpochMs: 2 },
      outcome: {
        status: "passed",
        exitCode: 0,
        providerFailureCategory: null,
      },
      usage: { accessToken: "secret" },
    };
    expect(() => validateRunRecord(record)).toThrow(
      "usage must be null or match the redacted exact-token schema",
    );
  });

  it("accepts only redacted exact provider token usage", () => {
    const plan = resolve(base);
    const record = {
      schemaVersion: 1,
      plan,
      requested: {
        provider: plan.provider,
        model: plan.model,
        effort: plan.effort,
      },
      effective: {
        provider: plan.provider,
        model: plan.model,
        effort: plan.effort,
      },
      attempts: 1,
      timing: { startedAtEpochMs: 1, finishedAtEpochMs: 2 },
      outcome: {
        status: "passed",
        exitCode: 0,
        providerFailureCategory: null,
      },
      usage: {
        schemaVersion: 1,
        source: "codex-cli",
        inputTokens: 100,
        cachedInputTokens: 80,
        cacheWriteInputTokens: 0,
        outputTokens: 20,
        reasoningOutputTokens: 5,
        totalTokens: 120,
      },
    };
    expect(validateRunRecord(record)).toEqual(record);
  });

  it("rejects unknown run-record metadata at every persisted object boundary", () => {
    const plan = resolve(base);
    const record = {
      schemaVersion: 1,
      plan,
      requested: {
        provider: plan.provider,
        model: plan.model,
        effort: plan.effort,
      },
      effective: {
        provider: plan.provider,
        model: plan.model,
        effort: plan.effort,
      },
      attempts: 1,
      timing: { startedAtEpochMs: 1, finishedAtEpochMs: 2 },
      outcome: {
        status: "passed",
        exitCode: 0,
        providerFailureCategory: null,
      },
      usage: null,
    };
    expect(() => validateRunRecord({ ...record, transcript: "raw" })).toThrow(
      "run record schema mismatch",
    );
    expect(() =>
      validateRunRecord({
        ...record,
        outcome: { ...record.outcome, detail: "raw provider response" },
      }),
    ).toThrow("outcome schema mismatch");
  });

  it("loads a complete versioned policy", () => {
    const policy = loadPolicy();
    expect(policy.schemaVersion).toBe(1);
    expect(policy.routes.critical.providers.claude.model).toBe("claude-opus-5");
  });

  it("rejects provider mappings that cannot pin model and effort", () => {
    const policy = loadPolicy();
    for (const mutate of [
      (copy) => {
        copy.routes.standard.providers.codex.model = "";
      },
      (copy) => {
        copy.routes.standard.providers.codex.model = " gpt-5.6-terra ";
      },
      (copy) => {
        copy.routes.standard.providers.codex.effort = null;
      },
      (copy) => {
        copy.routes.standard.providers.claude.effort = "xhigh";
      },
    ]) {
      const copy = structuredClone(policy);
      mutate(copy);
      const file = path.join(makeTempDir("governor-policy-"), "policy.json");
      writeFileSync(file, JSON.stringify(copy));
      expect(() => loadPolicy(file)).toThrow(
        "compute-governor: policy missing route 'standard'",
      );
    }
  });

  it("rejects missing or extra protected classifier policy entries", () => {
    const policy = loadPolicy();
    for (const mutate of [
      (copy) => delete copy.protectedPromptPatterns.auth,
      (copy) => {
        copy.protectedPromptPatterns.unknown = ["unknown"];
      },
    ]) {
      const copy = structuredClone(policy);
      mutate(copy);
      const file = path.join(makeTempDir("governor-policy-"), "policy.json");
      writeFileSync(file, JSON.stringify(copy));
      expect(() => loadPolicy(file)).toThrow(
        "protected prompt policy must exactly cover protected surfaces",
      );
    }
  });

  it("does not promote a cheaper candidate that loses acceptance quality", () => {
    const result = calibrationDecision({
      maxAcceptanceRateDrop: 0.05,
      baseline: [
        { accepted: true, gatesPassed: true, attempts: 1, elapsedMs: 10 },
        { accepted: true, gatesPassed: true, attempts: 1, elapsedMs: 10 },
      ],
      candidate: [
        { accepted: true, gatesPassed: true, attempts: 1, elapsedMs: 5 },
        { accepted: false, gatesPassed: false, attempts: 2, elapsedMs: 5 },
      ],
    });
    expect(result.status).toBe("candidate-only");
  });

  it("promotes only a candidate that meets both acceptance and retry thresholds", () => {
    const result = calibrationDecision({
      baseline: [
        { accepted: true, gatesPassed: true, attempts: 1, elapsedMs: 10 },
        { accepted: true, gatesPassed: true, attempts: 2, elapsedMs: 20 },
      ],
      candidate: [
        { accepted: true, gatesPassed: true, attempts: 1, elapsedMs: 8 },
        { accepted: true, gatesPassed: true, attempts: 1, elapsedMs: 9 },
      ],
    });
    expect(result.status).toBe("eligible-for-default");
  });

  it("rejects incomplete calibration evidence instead of promoting it", () => {
    expect(() =>
      calibrationDecision({
        baseline: [{ accepted: true, gatesPassed: true }],
        candidate: [{ accepted: true, gatesPassed: true }],
      }),
    ).toThrow("calibration run evidence is incomplete");
  });
});
