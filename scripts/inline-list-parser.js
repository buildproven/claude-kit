#!/usr/bin/env node
/**
 * Inline list parser for /bs:dev and /bs:ralph.
 *
 * Both skills accept a single task description OR an inline markdown list
 * (bulleted or numbered) as their $ARGUMENTS. This module detects whether
 * the input is a list and, if so, extracts the individual items.
 *
 * Detection rules (intentionally tolerant):
 *   - A list requires 2+ items.
 *   - An item line starts (after optional whitespace) with one of:
 *       `- ` `* ` `+ `   (bullet styles)
 *       `1.` `1)`        (numbered styles; any digits, optional dot or paren)
 *   - Lines that don't match an item pattern are treated as nested detail
 *     for the most recent item (folded back in with whitespace collapsed).
 *   - A single line starting with `- ` is NOT a list (one item is just a task).
 *   - Inline dashes inside a single-line task (e.g. "fix logging - the timestamps
 *     are wrong") are NOT treated as bullets.
 *
 * Usage (Node):
 *   const { detectInlineList, parseInlineList, deriveSlug } = require('./inline-list-parser')
 *
 * Usage (CLI, for shell integration in SKILL.md):
 *   node scripts/inline-list-parser.js <<<"$ARGUMENTS"
 *   prints JSON: { "isList": true, "items": [...], "slugs": [...] }
 */

"use strict";

const BULLET_RE = /^[\t ]*([-*+])\s+(.*\S.*)$/;
const NUMBERED_RE = /^[\t ]*(\d+)[.)]\s+(.*\S.*)$/;

function stripItemPrefix(line) {
  if (typeof line !== "string") return null;
  const bullet = BULLET_RE.exec(line);
  if (bullet) return bullet[2].trim();
  const numbered = NUMBERED_RE.exec(line);
  if (numbered) return numbered[2].trim();
  return null;
}

function isItemLine(line) {
  return stripItemPrefix(line) !== null;
}

function parseInlineList(input) {
  if (!input || typeof input !== "string") return [];
  const lines = input.split(/\r?\n/);
  const items = [];
  let current = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (line.trim() === "") {
      if (current !== null) {
        items.push(current);
        current = null;
      }
      continue;
    }
    const stripped = stripItemPrefix(line);
    if (stripped !== null) {
      if (current !== null) items.push(current);
      current = stripped;
    } else if (current !== null) {
      current = `${current} ${line.trim()}`.replace(/\s+/g, " ").trim();
    }
  }
  if (current !== null) items.push(current);
  return items;
}

function detectInlineList(input) {
  return parseInlineList(input).length >= 2;
}

function deriveSlug(text, maxWords = 5) {
  if (!text || typeof text !== "string") return "task";
  const cleaned = text
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^a-z0-9\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "task";
  const words = cleaned.split(" ").filter(Boolean).slice(0, maxWords);
  const slug = words.join("-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return slug || "task";
}

function analyze(input) {
  const items = parseInlineList(input);
  const isList = items.length >= 2;
  const slugCounts = new Map();
  const slugs = items.map((item) => {
    const base = deriveSlug(item);
    const count = slugCounts.get(base) || 0;
    slugCounts.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  });
  return { isList, items, slugs };
}

module.exports = {
  analyze,
  detectInlineList,
  deriveSlug,
  isItemLine,
  parseInlineList,
  stripItemPrefix,
};

if (require.main === module) {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buf += chunk;
  });
  process.stdin.on("end", () => {
    const result = analyze(buf);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  });
  if (process.stdin.isTTY) {
    const input = process.argv.slice(2).join("\n");
    const result = analyze(input);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exit(0);
  }
}
