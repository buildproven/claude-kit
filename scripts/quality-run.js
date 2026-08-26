#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { spawn } = require("node:child_process");
const quality = require("./quality-invocation");

const ORCHESTRATION_SCHEMA_VERSION = 1;
const ACTION_REQUIRED_EXIT = 3;
const SCRIPT_DIR = __dirname;

function parseArgs(argv) {
  if (argv.length !== 2 || argv[0] !== "--manifest" || !argv[1]) {
    throw new Error("usage: quality-run.js --manifest <exact-path>");
  }
  return path.resolve(argv[1]);
}

function manifestAt(manifestPath) {
  return quality.loadManifest(manifestPath).manifest;
}

function pinRepositoryLease(manifest) {
  if (manifest.options?.merge !== true) return;
  const token = manifest.merge?.repositoryLease?.token;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("merge campaign has no repository lease credential");
  }
  const presented = process.env.BS_QUALITY_REPOSITORY_LEASE_TOKEN;
  if (presented && presented !== token) {
    throw new Error("repository lease credential does not match the manifest");
  }
  process.env.BS_QUALITY_REPOSITORY_LEASE_TOKEN = token;
}

function pinTerminalEpoch(manifest) {
  const epoch = quality.terminalEpoch(manifest);
  process.env.BS_QUALITY_TERMINAL_EPOCH = String(epoch);
}

function updateOrchestration(manifestPath, phase, status, detail = null) {
  quality.withManifestLock(manifestPath, (manifest) => {
    quality.validateIdentity(manifest, manifest.repo.realpath);
    const now = new Date().toISOString();
    const prior = manifest.orchestration;
    if (prior && prior.schemaVersion !== ORCHESTRATION_SCHEMA_VERSION) {
      throw new Error(
        `unsupported quality orchestration schema ${prior.schemaVersion}`,
      );
    }
    if (!prior || prior.head !== manifest.revisions.currentHead) {
      manifest.orchestration = {
        schemaVersion: ORCHESTRATION_SCHEMA_VERSION,
        head: manifest.revisions.currentHead,
        phase: "ready",
        status: "running",
        startedAt: now,
        updatedAt: now,
        steps: {},
      };
    }
    const orchestration = manifest.orchestration;
    orchestration.phase = phase;
    orchestration.status = status;
    orchestration.updatedAt = now;
    orchestration.steps[phase] = {
      status,
      detail,
      updatedAt: now,
      attempts:
        (orchestration.steps[phase]?.attempts || 0) +
        (status === "running" ? 1 : 0),
    };
  });
}

function emit(result) {
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ...result })}\n`);
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"],
    });
    options.onChild?.(child);
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      stdout = `${stdout}${chunk}`.slice(-32768);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      stderr = `${stderr}${chunk}`.slice(-32768);
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      options.onChild?.(null);
      resolve({ code: code ?? 1, signal, stdout, stderr });
    });
  });
}

function script(name) {
  return path.join(SCRIPT_DIR, name);
}

function currentReview(manifest) {
  if (quality.incompleteRetryStatus(manifest).state === "pending") return false;
  try {
    quality.reviewCoverage(manifest);
    return true;
  } catch (error) {
    if (
      [
        "no review coverage",
        "final HEAD has not been covered by review evidence",
      ].includes(error.message)
    ) {
      return false;
    }
    throw error;
  }
}

function reviewSummary(manifest) {
  const byRange = new Map();
  for (const review of manifest.reviews) {
    byRange.set(`${review.from || ""}\0${review.to || ""}`, review);
  }
  const reviews = [...byRange.values()];
  return {
    status: reviews.some((review) => review.status === "incomplete")
      ? "incomplete"
      : reviews.every((review) => review.status === "exempt")
        ? "policy-exempt"
        : "complete",
    leads: manifest.reviews.reduce(
      (sum, review) => sum + (review.leadCount || 0),
      0,
    ),
  };
}

function likelyExternalRequirement(message) {
  return /(?:signed|capability|approval|operator|override|human-required)/i.test(
    message,
  );
}

function actionRequired(manifestPath, phase, message, manifest, review) {
  updateOrchestration(manifestPath, phase, "action-required", message);
  return {
    status: "action-required",
    kind: "external-capability",
    phase,
    message,
    head: manifest.revisions.currentHead,
    review,
  };
}

function invocationRuntime(manifestPath, execute) {
  let activeChild = null;
  let interruptedSignal = null;
  const onChild = (child) => {
    activeChild = child;
  };
  const onSignal = (signal) => {
    interruptedSignal ||= signal;
    if (activeChild && !activeChild.killed) activeChild.kill(signal);
  };
  const assertNotInterrupted = (result) => {
    if (!interruptedSignal && !result.signal) return;
    throw Object.assign(new Error("quality run interrupted"), {
      terminalState: "interrupted",
    });
  };
  const invoke = async (phase, command, args) => {
    assertNotInterrupted({ signal: null });
    updateOrchestration(manifestPath, phase, "running");
    assertNotInterrupted({ signal: null });
    const result = await execute(command, args, {
      cwd: manifestAt(manifestPath).repo.realpath,
      onChild,
    });
    assertNotInterrupted(result);
    if (result.code !== 0) {
      throw Object.assign(
        new Error(`${phase} failed with exit ${result.code}`),
        { phase },
      );
    }
    updateOrchestration(manifestPath, phase, "success");
    return result;
  };
  return { assertNotInterrupted, invoke, onChild, onSignal };
}

async function runDeterministicPhases(manifestPath, invoke) {
  await invoke("risk", "bash", [
    script("quality-risk-resolve.sh"),
    "--manifest",
    manifestPath,
  ]);
  await invoke("panel", "bash", [
    script("quality-select-agents.sh"),
    "--manifest",
    manifestPath,
  ]);
  for (const gate of manifestAt(manifestPath).requiredGates) {
    await invoke(`gate:${gate.name}`, "bash", [
      script("quality-run-gate.sh"),
      "--manifest",
      manifestPath,
      "--name",
      gate.name,
    ]);
  }
  const gated = manifestAt(manifestPath);
  if (
    ["high", "critical"].includes(gated.risk.tier) &&
    !quality.mutationEvidenceValid(gated)
  ) {
    await invoke("mutation", "bash", [
      script("quality-mutation-check.sh"),
      "--manifest",
      manifestPath,
    ]);
  }
}

async function ensureReview(manifestPath, invoke) {
  const manifest = manifestAt(manifestPath);
  if (quality.incompleteRetryStatus(manifest).state === "pending") {
    await invoke("review-retry-reserve", process.execPath, [
      script("quality-invocation.js"),
      "reserve-incomplete-retry",
      manifestPath,
    ]);
  } else if (currentReview(manifest)) {
    return;
  }
  await invoke("review-authorize", "bash", [
    script("quality-authorize-review-round.sh"),
    manifestPath,
  ]);
  await invoke("review", "bash", [
    script("quality-run-review.sh"),
    "--manifest",
    manifestPath,
  ]);
}

async function finishWithoutMerge(manifestPath, invoke, manifest, review) {
  if (review.status === "incomplete") {
    await invoke("terminal", process.execPath, [
      script("quality-invocation.js"),
      "terminal-state",
      manifestPath,
      "--state",
      "provider-incomplete",
      "--detail",
      `review:incomplete;leads:${review.leads}`,
    ]);
    return {
      status: "terminal",
      state: "provider-incomplete",
      head: manifest.revisions.currentHead,
      review,
    };
  }
  await invoke("terminal", process.execPath, [
    script("quality-invocation.js"),
    "terminal-state",
    manifestPath,
    "--state",
    "verified-unmerged",
    "--detail",
    `review:${review.status};leads:${review.leads}`,
  ]);
  return {
    status: "complete",
    state: "verified-unmerged",
    head: manifest.revisions.currentHead,
    review,
  };
}

async function finishWithMerge(context, manifestPath, manifest, review) {
  try {
    quality.reviewAuthorization(manifest);
  } catch (error) {
    if (!likelyExternalRequirement(error.message)) throw error;
    return actionRequired(
      manifestPath,
      "authorization",
      error.message,
      manifest,
      review,
    );
  }
  updateOrchestration(manifestPath, "merge", "running");
  // An admission block describes one merge attempt only. Retaining it would
  // let a later, unrelated failure inherit the prior signed condition.
  quality.clearMergeAdmissionBlock(manifestPath);
  context.runtime.assertNotInterrupted({ signal: null });
  const expectedHead = manifest.revisions.currentHead;
  const merge = await context.execute(
    "bash",
    [script("quality-stamp-and-merge.sh"), "--manifest", manifestPath],
    {
      cwd: manifest.repo.realpath,
      onChild: context.runtime.onChild,
    },
  );
  context.runtime.assertNotInterrupted(merge);
  if (merge.code === 0) {
    const merged = manifestAt(manifestPath);
    if (
      merged.terminalState?.state !== "merged" ||
      merged.terminalState.head !== expectedHead ||
      merged.revisions.currentHead !== expectedHead
    ) {
      throw Object.assign(
        new Error(
          "merge process exited successfully without exact-head merged terminal evidence",
        ),
        { terminalContractFailure: true },
      );
    }
    return {
      status: "complete",
      state: "merged",
      head: merged.revisions.currentHead,
      review,
    };
  }
  const afterMerge = manifestAt(manifestPath);
  if (
    afterMerge.terminalState &&
    afterMerge.terminalState.state !== "recovering"
  ) {
    return {
      status: "terminal",
      state: afterMerge.terminalState.state,
      head: afterMerge.revisions.currentHead,
    };
  }
  if (merge.code === ACTION_REQUIRED_EXIT) {
    const message = `${merge.stderr || ""}\n${merge.stdout || ""}`.trim();
    const terminal = await context.execute(
      process.execPath,
      [
        script("quality-invocation.js"),
        "terminal-state",
        manifestPath,
        "--state",
        "blocked",
        "--detail",
        message || "merge requires an external governance capability",
      ],
      {
        cwd: manifest.repo.realpath,
        onChild: context.runtime.onChild,
      },
    );
    if (terminal.code !== 0) {
      throw new Error(
        "merge capability requirement could not be persisted as a recoverable terminal event",
      );
    }
    return actionRequired(
      manifestPath,
      "merge",
      message || "merge requires an external governance capability",
      manifest,
      review,
    );
  }
  throw new Error(`merge admission failed with exit ${merge.code}`);
}

async function recordFailure(context, manifestPath, error) {
  let manifest;
  try {
    manifest = manifestAt(manifestPath);
  } catch {
    throw error;
  }
  if (error.terminalContractFailure && manifest.terminalState) {
    return {
      status: "contract-failed",
      observedTerminalState: manifest.terminalState.state,
      message: error.message,
      head: manifest.revisions.currentHead,
    };
  }
  if (
    !manifest.terminalState ||
    manifest.terminalState.state === "recovering"
  ) {
    const stale =
      /identity.*(?:changed|mismatch)|(?:HEAD|head).*(?:changed|moved|mismatch)|stale|supersed/i.test(
        error.message,
      );
    const state = error.terminalState || (stale ? "superseded" : "blocked");
    const result = await context.execute(
      process.execPath,
      [
        script("quality-invocation.js"),
        "terminal-state",
        manifestPath,
        "--state",
        state,
        "--detail",
        error.message,
      ],
      {
        cwd: manifest.repo.realpath,
        onChild: context.runtime.onChild,
      },
    );
    if (result.code !== 0) {
      throw new Error(
        `terminal state recording failed after: ${error.message}`,
        { cause: error },
      );
    }
  }
  const terminal = manifestAt(manifestPath).terminalState;
  return {
    status: "terminal",
    state: terminal.state,
    message: error.message,
    head: manifest.revisions.currentHead,
  };
}

async function runOpenCampaign(context, manifestPath, manifest) {
  updateOrchestration(manifestPath, "validate", "success");
  await runDeterministicPhases(manifestPath, context.runtime.invoke);
  await ensureReview(manifestPath, context.runtime.invoke);
  manifest = manifestAt(manifestPath);
  quality.reviewCoverage(manifest);
  const review = reviewSummary(manifest);
  return manifest.options?.merge === true
    ? finishWithMerge(context, manifestPath, manifest, review)
    : finishWithoutMerge(
        manifestPath,
        context.runtime.invoke,
        manifest,
        review,
      );
}

async function runManifest(manifestPath, dependencies = {}) {
  const execute = dependencies.runProcess || runProcess;
  const runtime = invocationRuntime(manifestPath, execute);
  const context = { execute, runtime };
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const signal of signals) process.on(signal, runtime.onSignal);
  try {
    const manifest = manifestAt(manifestPath);
    pinRepositoryLease(manifest);
    pinTerminalEpoch(manifest);
    quality.validateIdentity(manifest, manifest.repo.realpath);
    if (manifest.terminalState) {
      const recovery = quality.resumeRecoverableTerminal(manifestPath);
      if (recovery) {
        const resumed = manifestAt(manifestPath);
        pinTerminalEpoch(resumed);
        return await finishWithMerge(
          context,
          manifestPath,
          resumed,
          reviewSummary(resumed),
        );
      }
      return {
        status: "terminal",
        state: manifest.terminalState.state,
        head: manifest.revisions.currentHead,
      };
    }
    return await runOpenCampaign(context, manifestPath, manifest);
  } catch (error) {
    return await recordFailure(context, manifestPath, error);
  } finally {
    for (const signal of signals) process.off(signal, runtime.onSignal);
  }
}

async function main() {
  try {
    const manifestPath = parseArgs(process.argv.slice(2));
    const result = await runManifest(manifestPath);
    emit(result);
    if (result.status === "action-required") {
      process.exitCode = ACTION_REQUIRED_EXIT;
    } else if (result.status === "complete") {
      process.exitCode = 0;
    } else if (
      result.status !== "terminal" ||
      !["merged", "verified-unmerged"].includes(result.state)
    ) {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`quality-run: ${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = {
  ACTION_REQUIRED_EXIT,
  ORCHESTRATION_SCHEMA_VERSION,
  parseArgs,
  pinRepositoryLease,
  reviewSummary,
  runManifest,
};

if (require.main === module) main();
