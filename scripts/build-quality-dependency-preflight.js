#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE = path.join(ROOT, "scripts", "quality-dependency-preflight.js");
const OUTPUT = path.join(
  ROOT,
  "scripts",
  "generated",
  "quality-dependency-preflight",
);

function filesIn(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      return entry.isDirectory()
        ? filesIn(absolute).map((child) => path.join(entry.name, child))
        : [entry.name];
    })
    .sort();
}

function assertSame(expected, actual) {
  const expectedFiles = filesIn(expected);
  const actualFiles = filesIn(actual);
  if (JSON.stringify(expectedFiles) !== JSON.stringify(actualFiles)) {
    throw new Error(
      `generated dependency preflight file set is stale: expected ${actualFiles.join(", ")}; found ${expectedFiles.join(", ")}`,
    );
  }
  for (const relative of actualFiles) {
    const committed = fs.readFileSync(path.join(expected, relative));
    const rebuilt = fs.readFileSync(path.join(actual, relative));
    if (!committed.equals(rebuilt)) {
      throw new Error(
        `generated dependency preflight is stale: ${path.relative(ROOT, path.join(expected, relative))}`,
      );
    }
  }
}

function build(output) {
  const ncc = require.resolve("@vercel/ncc/dist/ncc/cli.js");
  execFileSync(
    process.execPath,
    [ncc, "build", SOURCE, "-o", output, "--minify", "--no-cache"],
    { cwd: ROOT, stdio: "inherit" },
  );
}

function main() {
  const write = process.argv.slice(2).includes("--write");
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "quality-dependency-preflight-build-"),
  );
  const rebuilt = path.join(temporaryRoot, "bundle");
  try {
    build(rebuilt);
    if (write) {
      fs.rmSync(OUTPUT, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
      fs.cpSync(rebuilt, OUTPUT, { recursive: true });
      process.stdout.write("generated dependency preflight updated\n");
      return;
    }
    assertSame(OUTPUT, rebuilt);
    process.stdout.write("generated dependency preflight is current\n");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main();
