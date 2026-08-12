#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Ajv2020 = require("ajv/dist/2020");

function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

const schema = parseJson(
  fs.readFileSync(
    path.join(__dirname, "schemas", "quality-assurance-envelope.schema.json"),
    "utf8",
  ),
  "quality assurance schema",
);

function validateEnvelope(value) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  return { valid: validate(value), errors: validate.errors || [] };
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: quality-assurance-contract.js <envelope.json>");
    process.exitCode = 2;
  } else {
    try {
      const result = validateEnvelope(
        parseJson(fs.readFileSync(file, "utf8"), "quality assurance envelope"),
      );
      if (!result.valid) {
        console.error(JSON.stringify(result.errors, null, 2));
        process.exitCode = 1;
      } else {
        console.log("quality assurance envelope valid");
      }
    } catch (error) {
      console.error(`quality assurance envelope invalid: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

module.exports = { validateEnvelope };
