#!/usr/bin/env node
"use strict";

const fs = require("fs");
const {
  normalizeStructuredReview,
} = require("./quality-normalize-structured-review");

function normalizeGeminiReview(value) {
  if (typeof value?.response !== "string") {
    throw new Error("Gemini review envelope is missing response text");
  }
  return normalizeStructuredReview(value);
}

function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    process.stderr.write(
      "usage: quality-normalize-gemini-review.js input.json output.json\n",
    );
    process.exit(2);
  }
  try {
    const envelope = JSON.parse(fs.readFileSync(input, "utf8"));
    const review = normalizeGeminiReview(envelope);
    fs.writeFileSync(output, `${JSON.stringify(review, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `Gemini review normalization failed: ${error.message}\n`,
    );
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { normalizeGeminiReview };
