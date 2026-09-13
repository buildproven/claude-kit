import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolve } from "../compute-governor";

const cli = path.resolve("scripts/compute-governor.js");
const request = {
  interface: "native-advisory",
  schemaVersion: 1,
  work: "delegation",
  facts: {
    provider: "codex",
    phase: "scan",
    readOnly: true,
    localized: true,
  },
  parent: { model: "gpt-6-astra", effort: "high" },
  override: null,
  fork: "bounded",
  capabilities: {
    delegation: true,
    overrides: true,
    models: [
      { model: "gpt-5.6-terra", efforts: ["medium", "high"] },
      { model: "gpt-5.6-sol", efforts: ["high"] },
      { model: "gpt-5.6-luna", efforts: ["medium"] },
    ],
  },
};

describe("native advisory via compute-governor resolve/explain", () => {
  it("returns deterministic calibrated advice without replacing the parent or claiming execution", () => {
    const results = ["resolve", "explain"].map((command) =>
      JSON.parse(
        execFileSync(process.execPath, [cli, command, "-"], {
          input: JSON.stringify(request),
          encoding: "utf8",
        }),
      ),
    );
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({
      interface: "native-advisory",
      schemaVersion: 1,
      status: "ready",
      parent: { model: "gpt-6-astra", effort: "high" },
      route: "standard",
      promotion: "calibration-required-standard-fallback",
      configured: { model: "gpt-5.6-terra", effort: "medium" },
      requested: { model: "gpt-5.6-terra", effort: "medium" },
      observed: null,
      usage: null,
      constraints: {
        launches: 0,
        apiFallback: false,
        globalQuotaEnforced: false,
      },
    });
  });

  it.each(["tools", "local"])(
    "%s work needs no extra model even without native capabilities",
    (work) => {
      expect(
        resolve({
          ...request,
          work,
          capabilities: {
            delegation: null,
            overrides: null,
            models: null,
          },
        }),
      ).toMatchObject({
        status: "ready",
        route: null,
        configured: null,
        requested: null,
        observed: null,
        modelArguments: null,
      });
    },
  );

  it("preserves explicit supported model/effort choices", () => {
    expect(
      resolve({
        ...request,
        override: { model: "gpt-5.6-sol", effort: "high" },
      }),
    ).toMatchObject({
      status: "ready",
      parent: request.parent,
      configured: { model: "gpt-5.6-terra", effort: "medium" },
      requested: { model: "gpt-5.6-sol", effort: "high" },
      modelArguments: { model: "gpt-5.6-sol", effort: "high" },
    });
  });

  it.each([
    { delegation: null },
    { delegation: false },
    { overrides: null },
    { overrides: false },
    { models: null },
    { models: [] },
    { models: [{ model: "gpt-5.6-terra", efforts: ["low"] }] },
  ])("blocks unsupported or unknown native capabilities %j", (capabilities) => {
    expect(
      resolve({
        ...request,
        capabilities: { ...request.capabilities, ...capabilities },
      }),
    ).toMatchObject({
      status: "blocked",
      modelArguments: null,
      observed: null,
    });
  });

  it("retains a full-history parent's identity and omits override arguments", () => {
    expect(
      resolve({
        ...request,
        fork: "all",
        parent: { model: "gpt-5.6-sol", effort: "high" },
        capabilities: { ...request.capabilities, overrides: false },
      }),
    ).toMatchObject({
      status: "ready",
      requested: { model: "gpt-5.6-sol", effort: "high" },
      modelArguments: null,
      context: "all",
    });
  });

  it("blocks every full-history explicit override, even one equal to its parent", () => {
    expect(
      resolve({
        ...request,
        fork: "all",
        parent: { model: "gpt-5.6-sol", effort: "high" },
        override: { model: "gpt-5.6-sol", effort: "high" },
      }),
    ).toMatchObject({ status: "blocked", modelArguments: null });
  });

  it.each(["all", "bounded", "none"])(
    "keeps protected work at its floor for %s context",
    (fork) => {
      const protectedRequest = {
        ...request,
        fork,
        facts: {
          ...request.facts,
          phase: "review",
          protectedSurfaces: ["security"],
        },
        parent: { model: "gpt-5.6-terra", effort: "medium" },
      };
      const result = resolve(protectedRequest);
      expect(result.route).toBe("critical");
      expect(result.status).toBe(fork === "all" ? "blocked" : "ready");
      expect(
        resolve({
          ...protectedRequest,
          override: { model: "gpt-5.6-terra", effort: "medium" },
        }),
      ).toMatchObject({ status: "blocked", modelArguments: null });
    },
  );

  it("blocks economy and uncatalogued overrides without silently changing them", () => {
    for (const model of ["gpt-5.6-luna", "custom-model"]) {
      const override = { model, effort: "medium" };
      const result = resolve({
        ...request,
        override,
        capabilities: {
          ...request.capabilities,
          models: [{ model, efforts: ["medium"] }],
        },
      });
      expect(result).toMatchObject({
        status: "blocked",
        requested: override,
        modelArguments: null,
      });
      expect(result.reasons).toContain(
        "requested identity does not meet the approved calibrated route floor",
      );
    }
  });

  it("uses approved Claude mappings without another provider catalog", () => {
    expect(
      resolve({
        ...request,
        facts: { ...request.facts, provider: "claude" },
        capabilities: {
          ...request.capabilities,
          models: [{ model: "claude-sonnet-5", efforts: ["medium"] }],
        },
      }),
    ).toMatchObject({
      status: "ready",
      requested: { model: "claude-sonnet-5", effort: "medium" },
    });
  });

  it.each([
    { schemaVersion: 2 },
    { work: "launch" },
    { fork: "partial" },
    { parent: { model: "", effort: "high" } },
    { surprise: true },
    { facts: { ...request.facts, interface: "native-advisory" } },
  ])(
    "rejects malformed native requests visibly through the CLI %j",
    (change) => {
      const result = spawnSync(process.execPath, [cli, "resolve", "-"], {
        input: JSON.stringify({ ...request, ...change }),
        encoding: "utf8",
      });
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("compute-governor:");
    },
  );
});
