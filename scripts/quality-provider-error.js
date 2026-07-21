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
    value.api_error_status,
    value.code,
    value.type,
    ...values(value.error),
  ].filter((item) => item !== undefined && item !== null);
}

function isErrorEvent(event) {
  return (
    event &&
    typeof event === "object" &&
    (["error", "turn.failed"].includes(event.type) ||
      event.is_error === true ||
      (event.error &&
        typeof event.error === "object" &&
        (event.error.code !== undefined ||
          event.error.status !== undefined ||
          event.error.statusCode !== undefined)))
  );
}

function errorMessage(event) {
  if (!isErrorEvent(event)) return "";
  if (typeof event.message === "string") return event.message;
  if (typeof event.error?.message === "string") return event.error.message;
  return "";
}

function hasExhaustionMessage(event) {
  return /\b(?:hit|reached) (?:your )?(?:usage|rate|quota) limit\b/i.test(
    errorMessage(event),
  );
}

function isExhaustionEvent(event) {
  if (!isErrorEvent(event)) return false;
  return (
    values(event).some((value) =>
      EXHAUSTED_CODES.has(String(value).toLowerCase()),
    ) || hasExhaustionMessage(event)
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
  const raw =
    (error && typeof error === "object"
      ? (error.reset_at ?? error.resetAt ?? error.resets_at ?? error.resetsAt)
      : null) ?? resetAtFromMessage(errorMessage(event));
  if (raw === null) return null;
  const epoch =
    typeof raw === "number" && raw < 10_000_000_000 ? raw * 1000 : raw;
  const parsed = new Date(epoch);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function resetAtFromMessage(message) {
  const marker = "try again at ";
  const start = String(message).toLowerCase().indexOf(marker);
  if (start === -1) return null;
  return String(message)
    .slice(start + marker.length)
    .replace(/(\d)(?:st|nd|rd|th)\b/gi, "$1")
    .trim();
}

function classifyStructuredFailure(raw) {
  for (const event of parseJsonLines(raw).filter(isErrorEvent)) {
    const codes = values(event).map((value) => String(value).toLowerCase());
    if (codes.some((code) => BILLING_CODES.has(code))) {
      return { category: "provider-billing", resetAt: null };
    }
    if (
      codes.some((code) => EXHAUSTED_CODES.has(code)) ||
      hasExhaustionMessage(event)
    ) {
      return {
        category: "provider-exhaustion",
        resetAt: normalizedResetAt(event),
      };
    }
  }
  return null;
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
