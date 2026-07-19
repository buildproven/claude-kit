export default {
  test: {
    globals: true,
    environment: "node",
    // Many suites shell out to real bash and do filesystem work (symlinking 14
    // hooks, syncing skill trees, running install scripts). Under Vitest's
    // parallel worker pool on a loaded machine that legitimately exceeds the
    // 5000ms default, producing "Test timed out in 5000ms" flakes that pass in
    // isolation and on CI (BUI-350). Give every test headroom so slow-but-
    // correct work is never mistaken for a hang; a genuine deadlock still trips
    // this bound.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    include: [
      "scripts/__tests__/**/*.test.js",
      "eslint-plugin-defensive/__tests__/**/*.test.js",
      "tests/unit/**/*.test.js",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      thresholds: {
        lines: 30,
        functions: 30,
        branches: 30,
        statements: 30,
      },
      exclude: [
        "node_modules/**",
        "scripts/__tests__/**",
        "scripts/*.sh",
        "commands/**",
        "skills/**",
        "agents/**",
        "docs/**",
        "data/**",
        "hooks/**",
        ".husky/**",
        "coverage/**",
      ],
    },
  },
};
