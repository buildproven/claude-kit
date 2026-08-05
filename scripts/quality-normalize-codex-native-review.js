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
      failure_scenario: body.join(" "),
      proof: {
        kind: "static-analysis",
        evidence: `${normalizeFile(header.file, root)}:${header.line_start} — ${body.join(" ")}`,
      },
      recommendation: "Address the described review finding.",
    });
  }
  // Zero structured findings can mean either "clean review" or "the review
  // never completed". Codex's native output for a clean review is prose, e.g.
  // "No actionable correctness issue was found in the changed configuration." —
  // not the literal string "no findings". Anchoring `^...$` against the WHOLE
  // transcript (the old test) rejected every prose approval as INCONCLUSIVE and
  // falsely blocked merges (BUI-359).
  //
  // Decide clean-vs-inconclusive per sentence with only simple, linear-time
  // regexes (variable-gap patterns like `\bno\b.*noun` backtrack and trip
  // security/detect-unsafe-regex). A sentence is an affirmative clean verdict
  // when it contains BOTH a negation and a finding-noun ("no issues", "no
  // actionable correctness issue found") or an explicit "looks good"/"lgtm", and
  // is NOT itself a completeness qualifier ("could not be reviewed", "ended
  // unexpectedly", "another path") — a qualified/partial "no findings" stays
  // inconclusive, not an approval.
  const NEGATION = /\b(?:no|not|n[o']?t|without)\b/i;
  const NOUN =
    /\b(?:findings?|issues?|concerns?|problems?|bugs?|regressions?|(?:correctness|security)\s+(?:issue|problem|concern)s?)\b/i;
  const CLEAN_PHRASE =
    /\b(?:looks good|lgtm|no changes? (?:needed|required))\b/i;
  const POSITIVE_VERDICT =
    /\b(?:preserves?|retains?) (?:behaviors?|checks?|semantics|compatibility|invariants?|guarantees?|required-only checks|existing behavior|their existing behavior|the existing behavior|all checks|required checks)\b/i;
  const ADVERSE_FINDING =
    /\b(?:incorrect(?:ly)?|unsafe(?:ly)?|fails?|broken|vulnerable|regressions?|issues?|concerns?|problems?|bugs?)\b/i;
  const NEGATIVE_PREFIX =
    /\b(?:not|never|cannot|can't|fails? to|does not|doesn't|no longer)\b/i;
  const CONTRAST = /\b(?:but|however)\b|;/i;
  const INCOMPLETE =
    /\b(?:could ?n[o']?t be reviewed|ended unexpectedly|was (?:truncated|interrupted|incomplete)|(?:review|analysis) was (?:not )?completed|another (?:path|file))\b/i;
  const sentences = String(raw).split(/[.\n!?]+/);
  const incompleteVerdict = sentences.some((sentence) =>
    INCOMPLETE.test(sentence),
  );
  // Evaluate adverse language per clause. A global `not`/`however` check made
  // unrelated clean prose ("not risky. No concerns found.") poison the entire
  // review. Clause boundaries still ensure that "No issues, but a bug remains"
  // cannot borrow the negation from the clean clause.
  const clauses = sentences.flatMap((sentence) => sentence.split(CONTRAST));
  const adverseVerdict = clauses.some((clause) => {
    if (NEGATIVE_PREFIX.test(clause) && POSITIVE_VERDICT.test(clause)) {
      return true;
    }
    if (!ADVERSE_FINDING.test(clause)) return false;
    return !(NEGATION.test(clause) && NOUN.test(clause));
  });
  const cleanVerdict = sentences.some((sentence) => {
    if (incompleteVerdict || adverseVerdict) return false;
    if (CLEAN_PHRASE.test(sentence)) return true;
    if (POSITIVE_VERDICT.test(sentence)) {
      return !CONTRAST.test(sentence) && !NEGATIVE_PREFIX.test(sentence);
    }
    return NEGATION.test(sentence) && NOUN.test(sentence);
  });
  if (findings.length === 0 && !cleanVerdict) {
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
