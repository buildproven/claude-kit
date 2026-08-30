// knip.config.js — Dead code detection
// Docs: https://knip.dev/overview/configuration
module.exports = {
  entry: [
    "scripts/*.{js,mjs,cjs}",
    "scripts/bench/*.{js,mjs,cjs}",
    "scripts/generated/quality-dependency-preflight/index.js",
    // ncc emits cmd-shim's ESM boundary as a deterministic runtime chunk.
    "scripts/generated/quality-dependency-preflight/674.index.js",
    "eslint-plugin-defensive/index.js",
  ],
  project: ["scripts/**/*.{js,mjs,cjs}", "eslint-plugin-defensive/**/*.js"],
  ignoreDependencies: [
    "@typescript-eslint/eslint-plugin",
    "@typescript-eslint/parser",
    // CLI-only tooling invoked from package.json or Husky hooks. Knip does not
    // trace these shell entry points when an explicit project graph is used.
    "@commitlint/cli",
    "husky",
    "license-checker-rseidelsohn",
    "lint-staged",
    "pnpm",
    "prettier",
  ],
  ignoreBinaries: [
    "commitlint",
    "eslint",
    "husky",
    "knip",
    "license-checker-rseidelsohn",
    "prettier",
    "vitest",
    // A shell fixture invokes awk directly while testing mutation manifests.
    "awk",
    // Shell-boundary regression fixtures exercise both parent shells and
    // resolve the real Git binary through `which`.
    "which",
    "zsh",
  ],
};
