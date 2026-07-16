// knip.config.js — Dead code detection
// Docs: https://knip.dev/overview/configuration
module.exports = {
  entry: ["scripts/*.{js,mjs,cjs}", "eslint-plugin-defensive/index.js"],
  project: ["scripts/**/*.{js,mjs,cjs}", "eslint-plugin-defensive/**/*.js"],
  ignoreDependencies: [
    "@typescript-eslint/eslint-plugin",
    "@typescript-eslint/parser",
  ],
  ignoreBinaries: [],
};
