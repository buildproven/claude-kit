/**
 * eslint-plugin-defensive
 *
 * ESLint plugin for defensive coding patterns - catches issues that
 * standard lint/type checks miss.
 *
 * Based on patterns from exit-number and retire-runway audits where
 * 24 issues slipped through standard quality checks.
 */

"use strict";

const noUnsafeJsonParse = require("./rules/no-unsafe-json-parse");
const noEmptyCatch = require("./rules/no-empty-catch");
const requireAuthMiddleware = require("./rules/require-auth-middleware");
const requireUseCallback = require("./rules/require-useCallback");
const requireGuardClause = require("./rules/require-guard-clause");
const recommended = require("./configs/recommended");

module.exports = {
  meta: {
    name: "eslint-plugin-defensive",
    version: "1.0.0",
  },
  rules: {
    "no-unsafe-json-parse": noUnsafeJsonParse,
    "no-empty-catch": noEmptyCatch,
    "require-auth-middleware": requireAuthMiddleware,
    "require-useCallback": requireUseCallback,
    "require-guard-clause": requireGuardClause,
  },
  configs: {
    recommended,
  },
};
