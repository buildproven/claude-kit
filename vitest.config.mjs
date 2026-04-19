export default {
  test: {
    globals: true,
    environment: "node",
    include: ["scripts/__tests__/**/*.test.js", "tests/unit/**/*.test.js"],
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
