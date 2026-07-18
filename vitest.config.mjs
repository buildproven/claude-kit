export default {
  test: {
    globals: true,
    environment: "node",
    include: [
      "scripts/__tests__/**/*.test.js",
      "eslint-plugin-defensive/__tests__/**/*.test.js",
      "tests/unit/**/*.test.js",
    ],
    // Several manifest/bootstrap tests spawn real git/bash/zsh subprocesses that
    // self-clone (`git remote add origin <self>`) and fetch. On slower, heavily
    // contended CI runners these intermittently lose a subprocess race and
    // assert `expected false to be true`, though they pass deterministically
    // locally (599/599, including full cross-file parallelism). Retry twice so a
    // transient subprocess-timing loss doesn't red a green change; a real
    // failure still fails all three attempts. Retries are CI-visible, so a test
    // that only ever passes on retry can still be found and hardened.
    retry: 2,
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
