#!/usr/bin/env node
"use strict";

const fs = require("fs");

const SEVERITY = {
  0: "critical",
  1: "high",
  2: "medium",
  3: "low",
};

function parseHeader(line) {
  const prefix = line.match(/^- \[P([0-3])\] /);
  if (!prefix) return null;
  const rest = line.slice(prefix[0].length);
  const separator = rest.lastIndexOf(" — ");
  if (separator < 1) return null;
  const title = rest.slice(0, separator);
  const location = rest.slice(separator + 3);
  const colon = location.lastIndexOf(":");
  if (colon < 1) return null;
  const file = location.slice(0, colon);
  const lineStart = location.slice(colon + 1).split("-")[0];
  if (!/^[1-9][0-9]*$/.test(lineStart)) return null;
  return {
    severity: SEVERITY[prefix[1]],
    title,
    file,
    line_start: Number(lineStart),
  };
}

function normalizeFile(file, root) {
  const prefix = `${root.replace(/\/+$/, "")}/`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}

function parseNativeReview(raw, root = process.cwd()) {
  if (/^\s*[{[]/.test(String(raw))) {
    throw new Error(
      "malformed structured Codex review cannot be treated as native prose",
    );
  }
  const lines = String(raw).split(/\r?\n/);
  const findings = [];
  for (let index = 0; index < lines.length; index += 1) {
    const header = parseHeader(lines[index]);
    if (!header) continue;
    const body = [];
    while (index + 1 < lines.length && /^\s{2,}\S/.test(lines[index + 1])) {
      body.push(lines[++index].trim());
    }
    findings.push({
      ...header,
      file: normalizeFile(header.file, root),
      body: body.join(" "),
      recommendation: "Address the described review finding.",
    });
  }
  if (
    findings.length === 0 &&
    !/^(?:no (?:actionable )?findings|looks good)\.?$/i.test(String(raw).trim())
  ) {
    throw new Error("native Codex review has no recognizable verdict");
  }
  const summary =
    lines
      .find((line) => line.trim() && !line.startsWith("Full review"))
      ?.trim() ||
    (findings.length === 0
      ? "Codex native review reported no actionable findings."
      : "Codex native review reported actionable findings.");
  return {
    verdict: findings.length === 0 ? "approve" : "needs-attention",
    summary,
    findings,
  };
}

function main() {
  const [input, output, root = process.cwd()] = process.argv.slice(2);
  if (!input || !output) {
    process.stderr.write(
      "usage: quality-normalize-codex-native-review.js input output [root]\n",
    );
    process.exit(2);
  }
  const review = parseNativeReview(fs.readFileSync(input, "utf8"), root);
  fs.writeFileSync(output, `${JSON.stringify(review, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { parseHeader, parseNativeReview };
