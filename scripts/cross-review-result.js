#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const STATUS_BY_EXIT = new Map([
  [0, "complete"],
  [74, "unavailable"],
  [75, "exhausted"],
  [76, "timed-out"],
]);

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1 || !argv[index + 1]) throw new Error(`${name} is required`);
  return argv[index + 1];
}

function main(argv) {
  const outDir = option(argv, "--output-dir");
  const provider = option(argv, "--provider");
  const head = option(argv, "--head");
  const exitCode = Number(option(argv, "--exit-code"));
  if (!Number.isInteger(exitCode))
    throw new Error("--exit-code must be an integer");
  const result = {
    schemaVersion: 1,
    authority: "advisory",
    status: STATUS_BY_EXIT.get(exitCode) || "unavailable",
    provider,
    head,
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "result.json"),
    `${JSON.stringify(result)}\n`,
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`cross-review-result: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { STATUS_BY_EXIT };
