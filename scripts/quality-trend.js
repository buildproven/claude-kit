#!/usr/bin/env node

/**
 * Quality Regression Alerting
 *
 * Reads .qualityrc.json history, compares latest score to
 * the average of the previous 3 runs. Exits:
 *   0 = stable or improving
 *   1 = dropped >5 pts (warning)
 *   2 = dropped >10 pts (critical)
 */

const fs = require("fs");
const path = require("path");

const QUALITYRC_PATH = path.join(__dirname, "..", ".qualityrc.json");

function loadQualityHistory() {
  try {
    const rc = JSON.parse(fs.readFileSync(QUALITYRC_PATH, "utf8"));
    return rc.history || [];
  } catch {
    return [];
  }
}

function analyzeTrend(history) {
  if (history.length < 2) {
    return {
      status: "insufficient",
      message: "Insufficient history (need at least 2 runs)",
      scores: history.map((h) => h.score),
      drop: 0,
    };
  }

  const latest = history[history.length - 1];
  const previous = history.slice(-4, -1); // up to 3 previous runs
  const avgPrevious =
    previous.reduce((sum, h) => sum + h.score, 0) / previous.length;
  const drop = avgPrevious - latest.score;

  const last5 = history.slice(-5).map((h) => ({
    date: h.date,
    branch: h.branch,
    score: h.score,
  }));

  if (drop > 10) {
    return {
      status: "critical",
      message: `Quality dropped ${drop.toFixed(1)} pts (avg ${avgPrevious.toFixed(1)} → ${latest.score})`,
      scores: last5,
      drop,
    };
  }

  if (drop > 5) {
    return {
      status: "warning",
      message: `Quality dropped ${drop.toFixed(1)} pts (avg ${avgPrevious.toFixed(1)} → ${latest.score})`,
      scores: last5,
      drop,
    };
  }

  return {
    status: "stable",
    message: `Quality stable at ${latest.score} (avg ${avgPrevious.toFixed(1)})`,
    scores: last5,
    drop,
  };
}

function main() {
  const history = loadQualityHistory();
  const trend = analyzeTrend(history);

  console.log(`\n📈 Quality Trend: ${trend.status.toUpperCase()}`);
  console.log(`   ${trend.message}`);

  if (trend.scores.length > 0 && typeof trend.scores[0] === "object") {
    console.log("\n   Recent scores:");
    for (const s of trend.scores) {
      console.log(
        `   - ${s.date?.slice(0, 10) || "?"} ${s.branch || "?"}: ${s.score}`,
      );
    }
  }

  if (trend.status === "critical") process.exit(2);
  if (trend.status === "warning") process.exit(1);
  process.exit(0);
}

module.exports = { analyzeTrend, loadQualityHistory };

if (require.main === module) {
  main();
}
