/**
 * Recommended configuration for eslint-plugin-defensive
 */

"use strict";

module.exports = {
  plugins: ["defensive"],
  rules: {
    "defensive/no-unsafe-json-parse": "error",
    "defensive/no-empty-catch": "error",
    "defensive/require-auth-middleware": "warn",
    "defensive/require-useCallback": "warn",
    "defensive/require-guard-clause": "warn",
  },
};
