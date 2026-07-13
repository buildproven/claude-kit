#!/usr/bin/env node

/**
 * Track test results across runs and detect flaky tests.
 *
 * Reads vitest JSON output from data/test-results.json,
 * appends to data/test-history.json, and flags tests that
 * flip pass/fail across the last 10 runs.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const RESULTS_PATH = path.join(__dirname, "..", "data", "test-results.json");
const HISTORY_PATH = path.join(__dirname, "..", "data", "test-history.json");
const MAX_RUNS = 50;
const FLAKY_WINDOW = 10;

function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
  } catch {
    return { version: 1, runs: [], flaky: [] };
  }
}

function loadResults() {
  if (!fs.existsSync(RESULTS_PATH)) {
    console.warn("⚠️  No test results found at", RESULTS_PATH);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(RESULTS_PATH, "utf8"));
  } catch {
    console.warn("⚠️  Failed to parse test results");
    return null;
  }
}

function extractTestOutcomes(results) {
  const outcomes = {};
  if (!results || !results.testResults) return outcomes;

  for (const suite of results.testResults) {
    const file = suite.name || suite.file || "unknown";
    for (const test of suite.assertionResults || []) {
      const key = `${file}::${test.fullName || test.title}`;

      // A skipped test is NOT a failure. Treating every non-"passed" status as
      // "fail" made any conditionally-skipped test (gated on an env var, a
      // platform, a missing binary) flip pass<->fail between runs — so the flaky
      // detector flagged it and failed the run with exit 1. Skips are simply not
      // evidence either way, so they are recorded as neither.
      if (test.status === "passed") {
        outcomes[key] = "pass";
      } else if (test.status === "failed") {
        outcomes[key] = "fail";
      }
      // pending / skipped / todo: no signal, no entry.
    }
  }
  return outcomes;
}

function getGitInfo() {
  try {
    const branch = execFileSync("git", ["branch", "--show-current"], {
      encoding: "utf8",
    }).trim();
    const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim();
    return { branch, commit };
  } catch {
    return { branch: "unknown", commit: "unknown" };
  }
}

function detectFlaky(runs) {
  const recentRuns = runs.slice(-FLAKY_WINDOW);
  if (recentRuns.length < 2) return [];

  const testNames = new Set();
  for (const run of recentRuns) {
    for (const name of Object.keys(run.outcomes)) {
      testNames.add(name);
    }
  }

  const flaky = [];
  for (const name of testNames) {
    const statuses = recentRuns
      .map((r) => r.outcomes[name])
      .filter((s) => s !== undefined);
    if (statuses.length < 2) continue;

    const hasPass = statuses.includes("pass");
    const hasFail = statuses.includes("fail");
    if (hasPass && hasFail) {
      // Count actual pass<->fail transitions. This used to be statuses.length —
      // the number of runs the test appeared in, not the number of times it
      // changed its mind. A test seen 3 times with one transition reported
      // "flips: 3", which is what anyone reading test-history.json would take
      // as three flips.
      let flips = 0;
      for (let i = 1; i < statuses.length; i++) {
        if (statuses[i] !== statuses[i - 1]) flips++;
      }
      flaky.push({
        test: name,
        flips,
        runs: statuses.length,
        lastStatus: statuses[statuses.length - 1],
      });
    }
  }
  return flaky;
}

function main() {
  const results = loadResults();
  if (!results) {
    process.exit(0);
  }

  const history = loadHistory();
  const outcomes = extractTestOutcomes(results);
  const { branch, commit } = getGitInfo();

  const run = {
    date: new Date().toISOString(),
    branch,
    commit,
    outcomes,
  };

  history.runs.push(run);

  // Prune to MAX_RUNS
  if (history.runs.length > MAX_RUNS) {
    history.runs = history.runs.slice(-MAX_RUNS);
  }

  // Detect flaky tests
  const flaky = detectFlaky(history.runs);
  history.flaky = flaky;

  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + "\n");

  console.log(`📊 Test run recorded: ${Object.keys(outcomes).length} tests`);

  if (flaky.length > 0) {
    console.warn(`⚠️  ${flaky.length} flaky test(s) detected:`);
    for (const f of flaky) {
      console.warn(`   - ${f.test} (last: ${f.lastStatus})`);
    }
    process.exit(1);
  } else {
    console.log("✅ No flaky tests detected");
  }
}

// Export internals for testing
module.exports = { detectFlaky, extractTestOutcomes, loadHistory };

if (require.main === module) {
  main();
}
