#!/usr/bin/env node

const { performance } = require("node:perf_hooks");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const iterations = Number.parseInt(process.argv[2] || "20", 10);
if (!Number.isInteger(iterations) || iterations < 5) {
  throw new Error("iterations must be an integer >= 5");
}

const scripts = path.resolve(__dirname, "..");
const legacy = [
  "block-destructive-paths.sh",
  "block-push-main.sh",
  "block-commit-main.sh",
  "branch-drift-guard.sh",
].map((name) => path.join(scripts, name));
const dispatcher = path.join(scripts, "bash-pretooluse-dispatcher.js");
const payload = JSON.stringify({
  tool_name: "Bash",
  tool_input: { command: "printf ok" },
});

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.floor(sorted.length * fraction),
  );
  return Number(sorted[index].toFixed(2));
}

function measure(run) {
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    const result = run(index);
    if (result.status !== 0) {
      throw new Error(`benchmark command failed with status ${result.status}`);
    }
    samples.push(performance.now() - started);
  }
  return {
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    meanMs: Number(
      (samples.reduce((sum, value) => sum + value, 0) / samples.length).toFixed(
        2,
      ),
    ),
  };
}

const legacyResult = measure((index) => {
  for (const script of legacy) {
    const result = spawnSync("bash", [script], {
      input: payload,
      encoding: "utf8",
      env: { ...process.env, SESSION_ID: `bench-${process.pid}-${index}` },
    });
    if (result.status !== 0) return result;
  }
  return { status: 0 };
});

const dispatcherResult = measure((index) =>
  spawnSync("node", [dispatcher], {
    input: payload,
    encoding: "utf8",
    env: { ...process.env, SESSION_ID: `bench-${process.pid}-${index}` },
  }),
);

console.log(
  JSON.stringify({
    iterations,
    legacy: legacyResult,
    dispatcher: dispatcherResult,
  }),
);
