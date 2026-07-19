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
const BILLING_CODES = new Set([
  "402",
  "billing_error",
  "payment_required",
  "insufficient_credits",
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
    (["error", "turn.failed"].includes(event.type) || event.is_error === true)
  );
}

function isExhaustionEvent(event) {
  if (!isErrorEvent(event)) return false;
  return values(event).some((value) =>
    EXHAUSTED_CODES.has(String(value).toLowerCase()),
  );
}

function parseJsonLines(raw) {
  const text = String(raw);
  try {
    return [JSON.parse(text)];
  } catch {
    // Provider event streams use JSONL; fall through to line-by-line parsing.
  }
  return text
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

function normalizedResetAt(event) {
  const error = event?.error;
  if (!error || typeof error !== "object") return null;
  const raw =
    error.reset_at ??
    error.resetAt ??
    error.resets_at ??
    error.resetsAt ??
    null;
  if (raw === null) return null;
  const epoch =
    typeof raw === "number" && raw < 10_000_000_000 ? raw * 1000 : raw;
  const parsed = new Date(epoch);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function classifyStructuredFailure(raw) {
  const event = parseJsonLines(raw).find(isErrorEvent);
  if (!event) return null;
  const codes = values(event).map((value) => String(value).toLowerCase());
  if (codes.some((code) => BILLING_CODES.has(code))) {
    return { category: "provider-billing", resetAt: null };
  }
  if (!codes.some((code) => EXHAUSTED_CODES.has(code))) return null;
  return {
    category: "provider-exhaustion",
    resetAt: normalizedResetAt(event),
  };
}

function main() {
  const describe = process.argv[2] === "describe";
  const file = process.argv[describe ? 3 : 2];
  if (!file) {
    process.stderr.write(
      "usage: quality-provider-error.js [describe] <events.jsonl>\n",
    );
    process.exit(2);
  }
  const raw = fs.readFileSync(file, "utf8");
  if (describe) {
    const failure = classifyStructuredFailure(raw);
    if (!failure) process.exit(1);
    process.stdout.write(`${JSON.stringify(failure)}\n`);
    return;
  }
  process.exit(hasStructuredExhaustion(raw) ? 0 : 1);
}

if (require.main === module) main();

module.exports = {
  hasStructuredExhaustion,
  classifyStructuredFailure,
  isExhaustionEvent,
  parseJsonLines,
};
