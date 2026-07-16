#!/usr/bin/env node
"use strict";

const fs = require("fs");

const EXHAUSTED_CODES = new Set([
  "429",
  "rate_limit",
  "rate_limit_exceeded",
  "resource_exhausted",
  "quota_exhausted",
]);

function values(value) {
  if (!value || typeof value !== "object") return [];
  return [
    value.status,
    value.statusCode,
    value.code,
    value.type,
    ...values(value.error),
  ].filter((item) => item !== undefined && item !== null);
}

function isErrorEvent(event) {
  return (
    event &&
    typeof event === "object" &&
    ["error", "turn.failed"].includes(event.type)
  );
}

function isExhaustionEvent(event) {
  if (!isErrorEvent(event)) return false;
  return values(event).some((value) =>
    EXHAUSTED_CODES.has(String(value).toLowerCase()),
  );
}

function parseJsonLines(raw) {
  return String(raw)
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function hasStructuredExhaustion(raw) {
  return parseJsonLines(raw).some(isExhaustionEvent);
}

function main() {
  const file = process.argv[2];
  if (!file) {
    process.stderr.write("usage: quality-provider-error.js <events.jsonl>\n");
    process.exit(2);
  }
  process.exit(hasStructuredExhaustion(fs.readFileSync(file, "utf8")) ? 0 : 1);
}

if (require.main === module) main();

module.exports = {
  hasStructuredExhaustion,
  isExhaustionEvent,
  parseJsonLines,
};
