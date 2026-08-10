const fs = require("node:fs");

const STATUSES = new Set(["PASS", "FAIL", "SKIP"]);

function validateEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, error: "result is not an object" };
  }
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "checks,reason,status") {
    return {
      valid: false,
      error: "result must contain exactly status, checks, reason",
    };
  }
  if (!STATUSES.has(value.status)) {
    return { valid: false, error: `unknown status ${String(value.status)}` };
  }
  if (!Number.isInteger(value.checks) || value.checks < 0) {
    return { valid: false, error: "checks must be a non-negative integer" };
  }
  if (typeof value.reason !== "string" || value.reason.trim() === "") {
    return { valid: false, error: "reason must be a non-empty string" };
  }
  if (value.status === "PASS" && value.checks < 1) {
    return { valid: false, error: "PASS requires checks >= 1" };
  }
  return { valid: true };
}

function inspectFile(file) {
  const envelopes = [];
  const invalid = [];
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let value;
    try {
      value = JSON.parse(trimmed);
    } catch {
      if (/"(?:status|checks|reason)"\s*:/.test(trimmed)) {
        invalid.push({ line: index + 1, error: "result is not valid JSON" });
      }
      continue;
    }
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !["status", "checks", "reason"].every((key) =>
        Object.prototype.hasOwnProperty.call(value, key),
      )
    ) {
      continue;
    }
    const result = validateEnvelope(value);
    if (result.valid) envelopes.push({ line: index + 1, value });
    else invalid.push({ line: index + 1, error: result.error });
  }
  return { envelopes, invalid };
}

if (require.main === module) {
  const [command, file, rcText, skipPolicy] = process.argv.slice(2);
  if (command === "inspect" && file) {
    process.stdout.write(`${JSON.stringify(inspectFile(file))}\n`);
    process.exit(0);
  }
  if (command !== "validate" || !file || rcText === undefined) {
    process.stderr.write(
      "usage: gate-result.js inspect <log> | validate <log> <exit-code> <allow-skip>\n",
    );
    process.exit(2);
  }
  const inspection = inspectFile(file);
  if (inspection.invalid.length > 0) {
    process.stderr.write(
      `invalid gate envelope: ${inspection.invalid[0].error}\n`,
    );
    process.exit(1);
  }
  if (inspection.envelopes.length !== 1) {
    process.stderr.write(
      `expected exactly one gate envelope, found ${inspection.envelopes.length}\n`,
    );
    process.exit(1);
  }
  const envelope = inspection.envelopes[0].value;
  const rc = Number(rcText);
  if (!Number.isInteger(rc)) {
    process.stderr.write("gate exit code is not an integer\n");
    process.exit(1);
  }
  if (envelope.status === "PASS" && rc !== 0) {
    process.stderr.write("PASS envelope contradicts non-zero exit\n");
    process.exit(1);
  }
  if (envelope.status === "SKIP" && rc !== 0) {
    process.stderr.write("SKIP envelope contradicts non-zero exit\n");
    process.exit(1);
  }
  if (envelope.status === "FAIL" && rc === 0) {
    process.stderr.write("FAIL envelope contradicts zero exit\n");
    process.exit(1);
  }
  if (envelope.status === "SKIP" && skipPolicy !== "true") {
    process.stderr.write("SKIP is not allowlisted for this gate\n");
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}

module.exports = { inspectFile, validateEnvelope };
