export default {
  test: {
    globals: true,
    environment: "node",
    // Many suites shell out to real bash and do filesystem work (symlinking 14
    // hooks, syncing skill trees, running install scripts). Under Vitest's
    // parallel worker pool on a loaded machine can legitimately exceed the
    // 5000ms default. The repository's integration-style tests invoke real
    // Git, npm, and filesystem operations and have reached ~34s under load;
    // give them sufficient headroom so slow-but-correct work is not mistaken
    // for a hang. A genuine deadlock still trips this bounded timeout.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // These integration suites create Git repositories, worktrees, and npm
    // subprocesses. Eight workers keep the complete suite inside the quality
    // gate's bounded execution allowance without changing test scope.
    maxWorkers: 8,
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
