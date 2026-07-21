#!/usr/bin/env node
"use strict";

const fs = require("fs");
const {
  normalizeStructuredReview,
} = require("./quality-normalize-structured-review");

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  process.stderr.write(
    "usage: quality-normalize-structured-review-cli.js input.json output.json\n",
  );
  process.exit(2);
}

try {
  const value = JSON.parse(fs.readFileSync(input, "utf8"));
  const review = normalizeStructuredReview(value);
  fs.writeFileSync(output, `${JSON.stringify(review, null, 2)}\n`);
} catch (error) {
  process.stderr.write(
    `structured review normalization failed: ${error.message}\n`,
  );
  process.exit(1);
}
