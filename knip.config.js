// knip.config.js — Dead code detection
// Docs: https://knip.dev/overview/configuration
module.exports = {
  entry: ["scripts/*.{js,mjs,cjs}", "eslint-plugin-defensive/index.js"],
  project: ["scripts/**/*.{js,mjs,cjs}", "eslint-plugin-defensive/**/*.js"],
  ignoreDependencies: [
    "@typescript-eslint/eslint-plugin",
    "@typescript-eslint/parser",
    // CLI-only tooling invoked from package.json or Husky hooks. Knip does not
    // trace these shell entry points when an explicit project graph is used.
    "@commitlint/cli",
    "husky",
    "license-checker",
    "lint-staged",
    "prettier",
  ],
  ignoreBinaries: [
    "commitlint",
    "eslint",
    "husky",
    "knip",
    "license-checker",
    "prettier",
    "vitest",
  ],
};
