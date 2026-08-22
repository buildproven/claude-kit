#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const USAGE_SCHEMA_VERSION = 1;
const SOURCES = new Set(["codex-cli", "claude-cli"]);

function nonnegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function normalizeUsage(raw, source) {
  if (!raw || typeof raw !== "object" || !SOURCES.has(source)) return null;
  const inputTokens = raw.input_tokens;
  const outputTokens = raw.output_tokens;
  if (!nonnegativeInteger(inputTokens) || !nonnegativeInteger(outputTokens)) {
    return null;
  }
  const optional = (value) => (nonnegativeInteger(value) ? value : 0);
  return {
    schemaVersion: USAGE_SCHEMA_VERSION,
    source,
    inputTokens,
    cachedInputTokens: optional(
      raw.cached_input_tokens ?? raw.cache_read_input_tokens,
    ),
    cacheWriteInputTokens: optional(
      raw.cache_write_input_tokens ?? raw.cache_creation_input_tokens,
    ),
    outputTokens,
    reasoningOutputTokens: optional(raw.reasoning_output_tokens),
    totalTokens: inputTokens + outputTokens,
  };
}

function readRegularFile(file) {
  let descriptor;
  try {
    descriptor = fs.openSync(
      file,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    );
    if (!fs.fstatSync(descriptor).isFile()) return null;
    return fs.readFileSync(descriptor, "utf8");
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function codexUsageFile(file) {
  const raw = readRegularFile(file);
  if (raw === null) return [];
  const samples = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type !== "turn.completed") continue;
      const usage = normalizeUsage(event.usage, "codex-cli");
      if (usage) samples.push(usage);
    } catch {
      // A malformed progress line is not exact usage evidence.
    }
  }
  return samples;
}

function claudeUsageFile(file) {
  const raw = readRegularFile(file);
  if (raw === null) return [];
  try {
    const envelope = JSON.parse(raw);
    const usage = normalizeUsage(envelope.usage, "claude-cli");
    return usage ? [usage] : [];
  } catch {
    return [];
  }
}

function artifactNames(directory) {
  try {
    return fs.readdirSync(directory);
  } catch {
    return [];
  }
}

function samplesFromDirectory(provider, directory) {
  if (typeof directory !== "string" || !directory) return [];
  const names = artifactNames(directory);
  if (provider === "codex") {
    return names
      .filter((name) =>
        /^(?:codex-\d+\.progress|codex\.events\.jsonl)$/.test(name),
      )
      .sort()
      .flatMap((name) => codexUsageFile(path.join(directory, name)));
  }
  if (provider === "claude") {
    return names
      .filter((name) => /\.result\.json$/.test(name))
      .sort()
      .flatMap((name) => claudeUsageFile(path.join(directory, name)));
  }
  return [];
}

function aggregateSamples(samples) {
  if (samples.length === 0) return null;
  const sum = (field) =>
    samples.reduce((total, sample) => total + sample[field], 0);
  return {
    schemaVersion: USAGE_SCHEMA_VERSION,
    source: [...new Set(samples.map((sample) => sample.source))].join("+"),
    inputTokens: sum("inputTokens"),
    cachedInputTokens: sum("cachedInputTokens"),
    cacheWriteInputTokens: sum("cacheWriteInputTokens"),
    outputTokens: sum("outputTokens"),
    reasoningOutputTokens: sum("reasoningOutputTokens"),
    totalTokens: sum("totalTokens"),
    samples: samples.length,
  };
}

function reviewUsage(manifest) {
  const reviews = Array.isArray(manifest.reviews) ? manifest.reviews : [];
  const covered = reviews.filter((review) =>
    ["success", "advisory", "incomplete"].includes(review.status),
  );
  const entries = covered.map((review) => ({
    artifactDir: review.artifactDir,
    samples: samplesFromDirectory(review.provider, review.artifactDir),
  }));
  const samples = entries.flatMap((entry) => entry.samples);
  return {
    usage: aggregateSamples(samples),
    reviewsWithUsage: entries.filter((entry) => entry.samples.length > 0)
      .length,
    reviewCount: covered.length,
  };
}

function validUsageSource(source) {
  const sources = typeof source === "string" ? source.split("+") : [];
  return (
    sources.length > 0 &&
    new Set(sources).size === sources.length &&
    sources.every((item) => SOURCES.has(item))
  );
}

function validUsage(value, { aggregate = false } = {}) {
  if (value === null) return true;
  const expected = [
    "schemaVersion",
    "source",
    "inputTokens",
    "cachedInputTokens",
    "cacheWriteInputTokens",
    "outputTokens",
    "reasoningOutputTokens",
    "totalTokens",
    ...(aggregate ? ["samples"] : []),
  ];
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = [
    "inputTokens",
    "cachedInputTokens",
    "cacheWriteInputTokens",
    "outputTokens",
    "reasoningOutputTokens",
    "totalTokens",
    ...(aggregate ? ["samples"] : []),
  ];
  return Boolean(
    Object.keys(value).sort().join("\0") === expected.sort().join("\0") &&
    value.schemaVersion === USAGE_SCHEMA_VERSION &&
    validUsageSource(value.source) &&
    fields.every((field) => nonnegativeInteger(value[field])) &&
    value.totalTokens === value.inputTokens + value.outputTokens,
  );
}

function main(argv = process.argv.slice(2)) {
  const [command, provider, directory] = argv;
  if (command !== "extract" || !provider || !directory) {
    process.stderr.write(
      "usage: quality-provider-usage.js extract <codex|claude> <artifact-directory>\n",
    );
    return 2;
  }
  const usage = aggregateSamples(samplesFromDirectory(provider, directory));
  process.stdout.write(`${JSON.stringify(usage)}\n`);
  return 0;
}

module.exports = {
  aggregateSamples,
  claudeUsageFile,
  codexUsageFile,
  normalizeUsage,
  reviewUsage,
  samplesFromDirectory,
  validUsage,
};

if (require.main === module) process.exitCode = main();
