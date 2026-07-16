#!/usr/bin/env node
"use strict";

const fs = require("fs");
const { spawnSync } = require("child_process");

function parseRequest(raw) {
  let request;
  try {
    request = JSON.parse(raw);
  } catch (error) {
    throw new Error(`request is not valid JSON: ${error.message}`, {
      cause: error,
    });
  }
  if (
    !request ||
    !Array.isArray(request.argv) ||
    request.argv.some((value) => typeof value !== "string")
  ) {
    throw new Error("request must contain a string argv array");
  }
  return request.argv;
}

function main() {
  const bootstrap = process.argv[2];
  if (!bootstrap) throw new Error("bootstrap path is required");
  const argv = parseRequest(fs.readFileSync(0, "utf8"));
  const result = spawnSync("bash", [bootstrap, ...argv], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  process.exit(result.status ?? 1);
}

module.exports = { parseRequest };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`quality-wrapper: ${error.message}\n`);
    process.exit(1);
  }
}
