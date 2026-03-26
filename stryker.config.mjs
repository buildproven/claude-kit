/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  testRunner: 'vitest',
  mutate: ['scripts/risk-policy-gate.js'],
  reporters: ['clear-text', 'html'],
  htmlReporter: {
    fileName: 'coverage/mutation/index.html',
  },
  coverageAnalysis: 'all',
  timeoutMS: 10000,
  vitest: {
    configFile: 'vitest.config.mjs',
    related: false,
  },
  ignorePatterns: [
    'mcp-servers',
    'coverage',
    '.stryker-tmp',
    'node_modules',
    '.git',
    '.venv',
  ],
}

export default config
