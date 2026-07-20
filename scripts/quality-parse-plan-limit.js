#!/usr/bin/env node
"use strict";

/**
 * Decide whether a response body is EXACTLY GitHub's branch-protection
 * plan-limit error, with no ambiguity anywhere in the document.
 *
 * Reads the body from the file given as argv[2]. Exits 0 when the body is
 * unambiguously the plan-limit error, non-zero otherwise, printing the reason
 * to stderr. Never throws for malformed input — bad input is simply not a
 * plan limit.
 *
 * Why a real tokenizer rather than jq or grep, after several failed attempts:
 *
 *   - Substring searches over the raw text are defeated by JSON escapes:
 *     `"message"` is a `message` key that no `grep "message"` can see.
 *   - Every JSON parser (jq, JSON.parse, and JSON.parse with a reviver) keeps
 *     only the LAST duplicate key, so `{"message":"rate limited","message":
 *     "<plan limit>"}` parses as a clean plan limit.
 *   - `jq --stream` emits paths for LEAVES, so a duplicate whose first value is
 *     a non-empty object or array (`{"message":{"x":1},"message":"<plan
 *     limit>"}`) never yields a depth-1 `message` path and slips through.
 *
 * The only reliable way to reject duplicate keys is to walk the tokens and
 * count member names as they appear, before any structure collapses them.
 */

const fs = require("node:fs");

const PLAN_LIMIT_MESSAGE =
  "Upgrade to GitHub Pro or make this repository public to enable this feature.";

function fail(reason) {
  process.stderr.write(`unobserved: ${reason}\n`);
  process.exit(1);
}

/**
 * Return the top-level member names of a JSON object document, including
 * duplicates, or null if the text is not exactly one JSON object.
 */
function topLevelKeys(text) {
  let i = 0;
  const n = text.length;

  // Bound nesting so adversarial input fails as a normal rejection instead of
  // an uncaught RangeError from stack exhaustion. GitHub error bodies are flat;
  // anything approaching this depth is not one.
  const MAX_DEPTH = 100;
  let depth = 0;

  const skipWhitespace = () => {
    while (i < n && /[\s]/.test(text[i])) i += 1;
  };

  // Consume one JSON value, returning false if the text is malformed. Only the
  // depth matters here, so values are skipped rather than materialized.
  const skipValue = () => {
    skipWhitespace();
    if (i >= n) return false;
    const ch = text[i];
    if (ch === '"') return skipString();
    if (ch === "{" || ch === "[") return skipContainer();
    for (const word of ["true", "false", "null"]) {
      if (text.startsWith(word, i)) {
        i += word.length;
        return true;
      }
    }
    // Scan the number by hand. A regex with nested quantifiers here is a ReDoS
    // hazard on adversarial input, and this parser exists to handle exactly
    // that. Precise numeric grammar does not matter: the value is skipped, and
    // JSON.parse validates the document afterwards.
    const start = i;
    while (i < n && "+-.eE0123456789".includes(text[i])) i += 1;
    return i > start;
  };

  const skipString = () => {
    if (text[i] !== '"') return false;
    i += 1;
    while (i < n) {
      const ch = text[i];
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === '"') {
        i += 1;
        return true;
      }
      i += 1;
    }
    return false;
  };

  const skipContainer = () => {
    depth += 1;
    if (depth > MAX_DEPTH) return false;
    try {
      return skipContainerBody();
    } finally {
      depth -= 1;
    }
  };

  const skipContainerBody = () => {
    const open = text[i];
    const close = open === "{" ? "}" : "]";
    i += 1;
    skipWhitespace();
    if (text[i] === close) {
      i += 1;
      return true;
    }
    // Each object gets its own name set, so duplicates are rejected at EVERY
    // depth — not just the top level. A nested duplicate does not change how
    // message/status resolve, but "exactly one unambiguous JSON object" has to
    // mean the whole document or the guarantee is not what the comment claims.
    const names = open === "{" ? new Set() : null;
    for (;;) {
      skipWhitespace();
      if (open === "{") {
        const nameStart = i;
        if (!skipString()) return false;
        let name;
        try {
          // Decode before comparing: "reason" and "reason" are one key.
          name = JSON.parse(text.slice(nameStart, i));
        } catch {
          return false;
        }
        if (names.has(name)) return false;
        names.add(name);
        skipWhitespace();
        if (text[i] !== ":") return false;
        i += 1;
      }
      if (!skipValue()) return false;
      skipWhitespace();
      if (text[i] === ",") {
        i += 1;
        continue;
      }
      if (text[i] === close) {
        i += 1;
        return true;
      }
      return false;
    }
  };

  skipWhitespace();
  if (text[i] !== "{") return null;
  i += 1;

  const keys = [];
  skipWhitespace();
  if (text[i] === "}") {
    i += 1;
    skipWhitespace();
    return i === n ? keys : null;
  }

  for (;;) {
    skipWhitespace();
    const keyStart = i;
    if (!skipString()) return null;
    // JSON.parse resolves escapes in the name, so `"message"` and
    // `"message"` are correctly seen as the same key.
    let key;
    try {
      key = JSON.parse(text.slice(keyStart, i));
    } catch {
      return null;
    }
    keys.push(key);
    skipWhitespace();
    if (text[i] !== ":") return null;
    i += 1;
    if (!skipValue()) return null;
    skipWhitespace();
    if (text[i] === ",") {
      i += 1;
      continue;
    }
    if (text[i] === "}") {
      i += 1;
      break;
    }
    return null;
  }

  skipWhitespace();
  // Trailing content means this is not exactly one JSON object.
  return i === n ? keys : null;
}

const file = process.argv[2];
if (!file) {
  process.stderr.write("usage: quality-parse-plan-limit.js <body-file>\n");
  process.exit(2);
}

let raw;
try {
  raw = fs.readFileSync(file);
} catch {
  fail("response body file is unreadable");
}

// A raw NUL means this is not the JSON body GitHub sends. Checked on bytes,
// because passing the body through a shell variable would strip NULs and
// normalize a malformed response into a well-formed one.
if (raw.includes(0)) fail("response body contains NUL bytes");

// Decode STRICTLY. `Buffer.toString("utf8")` silently rewrites invalid byte
// sequences to U+FFFD, which would launder a body that is not valid UTF-8 JSON
// into one that parses cleanly.
let text;
try {
  text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
} catch {
  fail("response body is not valid UTF-8");
}

const keys = topLevelKeys(text);
if (keys === null) fail("body is not exactly one JSON object");

// Linear duplicate detection; `indexOf` per key is quadratic and this input is
// attacker-influenced.
const seen = new Set();
for (const key of keys) {
  if (seen.has(key)) fail(`response body repeats the "${key}" key`);
  seen.add(key);
}

let parsed;
try {
  parsed = JSON.parse(text);
} catch {
  fail("body is not valid JSON");
}

// Compare the VALUE, not its string coercion: `String([403])` is "403", so a
// coercing check accepts {"status":[403]}.
if (parsed.status !== 403 && parsed.status !== "403") {
  // Serialize with JSON.stringify, not interpolation: a crafted value such as
  // {"toString":null,"valueOf":null} throws TypeError on coercion, which would
  // escape fail() as an uncaught error instead of a clean rejection.
  let shown;
  try {
    shown = JSON.stringify(parsed.status) ?? "none";
  } catch {
    shown = "unserializable";
  }
  fail(`response status is not 403 (status=${shown})`);
}
if (parsed.message !== PLAN_LIMIT_MESSAGE) {
  fail("response is not the plan-limit message");
}

process.stdout.write("plan-limit\n");
