#!/usr/bin/env node
"use strict";

const path = require("node:path");

const FULL_SUITE_PATHS =
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|uv\.lock|poetry\.lock|requirements[^/]*\.txt|pyproject\.toml|package\.json|\.github\/workflows\/|scripts\/.*(?:gate|verify|test)|.*\.sh$)/;
const JS_SOURCE = /\.(?:[cm]?js|jsx|ts|tsx)$/;
const PYTHON = /\.py$/;
const PYTHON_TEST = /(^|\/)(?:tests?|test)\/.*\.py$|(^|\/)test_[^/]+\.py$/;
const DOC_ONLY = /\.(?:md|txt)$/;

function plan(changed) {
  const files = [...new Set(changed.filter(Boolean))].sort();
  if (files.length === 0)
    return { mode: "full", reason: "unknown-change-set", files: [] };
  if (files.some((file) => FULL_SUITE_PATHS.test(file)))
    return {
      mode: "full",
      reason: "control-plane-or-dependency-change",
      files,
    };
  const js = files.filter((file) => JS_SOURCE.test(file));
  const python = files.filter((file) => PYTHON.test(file));
  const unknown = files.filter(
    (file) =>
      !JS_SOURCE.test(file) && !PYTHON.test(file) && !DOC_ONLY.test(file),
  );
  if (unknown.length > 0)
    return { mode: "full", reason: "unknown-project-type", files };
  if (python.length > 0 && !python.every((file) => PYTHON_TEST.test(file)))
    return {
      mode: "full",
      reason: "python-source-needs-complete-graph",
      files,
    };
  const commands = [];
  if (js.length > 0)
    commands.push({
      executable: "npx",
      args: ["vitest", "related", "--run", ...js],
    });
  if (python.length > 0) commands.push({ executable: "pytest", args: python });
  return commands.length > 0
    ? { mode: "focused", reason: "sound-language-selector", files, commands }
    : { mode: "none", reason: "documentation-only", files, commands: [] };
}

if (require.main === module) {
  const files = process.argv.slice(2).map((file) => path.normalize(file));
  console.log(JSON.stringify(plan(files), null, 2));
}

module.exports = { plan };
