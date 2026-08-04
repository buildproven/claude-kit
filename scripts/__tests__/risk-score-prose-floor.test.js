const {
  matchesSecurityFloor,
  computeScore,
  CRITICAL_RISK_SCORE,
  DEFAULTS,
} = require("../risk-score");

// ---------------------------------------------------------------------------
// Ordinary changes must not receive critical treatment.
//
// The security-floor patterns are deliberately token-broad so real credential
// material (id_rsa, .p12, oauth config) cannot evade them. Applied to prose,
// that breadth misfired: `docs/monkey.md` matched `**/*key*.*` and scored 85,
// forcing a full mutation + xhigh-Codex campaign onto a documentation edit.
//
// These tests pin BOTH directions: prose escapes the floor on name alone, and
// every genuinely sensitive surface keeps it.
// ---------------------------------------------------------------------------

describe("prose files do not reach the security floor by filename alone", () => {
  const falsePositives = [
    ["docs/monkey.md", "'monkey' contains the substring 'key'"],
    ["docs/api-keyboard.md", "'api-keyboard' is not an api key"],
    ["docs/keyboard-shortcuts.md", "'keyboard' contains 'key'"],
    ["docs/token-budget.md", "'token-budget' is a cost doc, not a credential"],
    ["docs/auth-guide.md", "an auth *guide* is prose about auth"],
    ["docs/deploy-notes.md", "deploy notes are prose, not a deploy script"],
    ["notes/passwords-ux.txt", "prose discussing password UX"],
    ["docs/licensing-faq.mdx", "licensing FAQ prose"],
    ["CHANGELOG.md", "ordinary changelog"],
  ];

  it.each(falsePositives)("%s is not on the floor (%s)", (file) => {
    expect(matchesSecurityFloor(file)).toBe(false);
  });
});

describe("security-relevant prose keeps the floor", () => {
  // Prose living inside a sensitive directory documents the very surface the
  // floor protects. Escaping by extension would be a real weakening.
  const stillSensitive = [
    // Regressions caught by independent review of this PR — each was on the
    // floor before the prose carve-out and silently fell off it. Kept as
    // explicit cases because the original suite tested only paths the
    // implementation already handled, so it was not red-capable against the
    // actual weakening.
    [".github/workflows/README.md", "CI dir is top-tier supply-chain surface"],
    [".github/workflows/notes.txt", "same, .txt"],
    [".husky/README.md", "git hooks directory"],
    ["my-secret-key.txt", "qualifier-prefixed credential name"],
    ["prod-api-key.txt", "qualifier-prefixed api key"],
    ["license-key.md", "license key"],
    ["key-prod.md", "trailing-token credential name"],
    ["session-key-notes.md", "credential stem mid-name"],
    [".env.md", "prose suffix must not launder .env"],
    [".env.production.md", "multi-extension .env"],
    ["prod.env.md", ".env as inner extension"],
    ["docs/id_rsa.md", "ssh private key under a prose suffix"],
    ["id_rsa.txt", "same, .txt"],
    ["docs/id_ed25519.txt", "ed25519 private key"],
    ["passwd/README.md", "prose inside a passwd directory"],
    ["src/api-key.txt", "a .txt named api-key may BE the credential"],
    ["src/api_key.txt", "underscore variant"],
    ["src/apikey.txt", "unseparated variant"],
    ["config/access-key.txt", "access-key .txt"],
    ["src/key.txt", "bare 'key' stem"],
    ["src/keys.txt", "bare 'keys' stem"],
    ["secrets/rotation.md", "runbook inside secrets/"],
    ["auth/README.md", "README inside auth/"],
    ["keys/README.txt", "README inside keys/"],
    ["deploy/runbook.md", "runbook inside deploy/"],
    ["licensing/terms.md", "prose inside licensing/"],
    ["docs/credentials/handling.md", "nested credentials dir"],
    ["README-secrets-policy.md", "named as a secrets policy document"],
  ];

  it.each(stillSensitive)("%s stays on the floor (%s)", (file) => {
    expect(matchesSecurityFloor(file)).toBe(true);
  });
});

describe("non-prose security surfaces are untouched", () => {
  // The narrowing applies ONLY to prose extensions. Nothing executable or
  // credential-bearing may change behavior.
  const sensitive = [
    ".env",
    ".env.example",
    "certs/server.pem",
    "certs/tls.key",
    "config/auth/session.js",
    "scripts/deploy.sh",
    "test/license.test.js",
    ".github/workflows/ci.yml",
    "src/keystore.ts",
    "id_rsa",
    "secrets.json",
  ];

  it.each(sensitive)("%s stays on the floor", (file) => {
    expect(matchesSecurityFloor(file)).toBe(true);
  });
});

describe("no credential-shaped path escapes the floor", () => {
  // The hand-written lists above only cover cases someone thought of, which is
  // how three regression classes shipped past the first draft. This derives its
  // candidates FROM the floor patterns themselves, so a newly-added floor
  // pattern is swept automatically rather than needing a matching test.
  //
  // It asserts the narrow, non-negotiable property: a path whose basename
  // denotes credential MATERIAL keeps the floor under every prose extension.
  // Security-topic prose (docs/auth.md) is deliberately excluded — see the
  // trade-off note in risk-score.js.
  const CREDENTIAL_MATERIAL = [
    ".env",
    "id_rsa",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    "api-key",
    "api_key",
    "apikey",
    "access-key",
    "private-key",
    "secret-key",
    "signing-key",
    "key",
    "keys",
    "keystore",
    "keyring",
    "keychain",
    "credentials",
    "secrets",
    // Credential NOUNS, singular and plural. The first repair generalized over
    // key-material extensions only, so `token.json.md` and `password.txt` still
    // dropped — the same "fixed the instances, not the class" miss. Listing the
    // nouns here makes the derived sweep cover them automatically.
    "credential",
    "secret",
    "password",
    "passwd",
    "token",
    "tokens",
    "access_token",
    "refresh-token",
  ];
  // Multi-extension forms: a prose suffix must not launder any of the above.
  const LAUNDERED_SUFFIXES = [".json", ".yaml", ".yml", ".conf"];
  const PROSE_EXTS = [".md", ".mdx", ".markdown", ".txt", ".rst", ".adoc"];
  const SENSITIVE_DIRS = [
    ".github/workflows",
    ".husky",
    "secrets",
    "auth",
    "keys",
    "deploy",
    "passwd",
    "passwords",
  ];

  const materialCases = CREDENTIAL_MATERIAL.flatMap((stem) =>
    PROSE_EXTS.flatMap((ext) => [
      `${stem}${ext}`,
      `docs/${stem}${ext}`,
      `src/prod-${stem}${ext}`,
      // Laundered through a config extension: token.json.md, password.yaml.txt
      ...LAUNDERED_SUFFIXES.map((inner) => `${stem}${inner}${ext}`),
    ]),
  );

  // Separator variants must tokenize like the hyphen form.
  const separatorCases = [
    "api key.md",
    "api+key.md",
    "api~key.txt",
    "api key.txt",
  ];

  it.each(separatorCases)("%s keeps the security floor", (file) => {
    expect(matchesSecurityFloor(file)).toBe(true);
  });

  it.each(materialCases)("%s keeps the security floor", (file) => {
    expect(matchesSecurityFloor(file)).toBe(true);
  });

  const dirCases = SENSITIVE_DIRS.flatMap((dir) =>
    PROSE_EXTS.map((ext) => `${dir}/README${ext}`),
  );

  it.each(dirCases)("%s keeps the security floor", (file) => {
    expect(matchesSecurityFloor(file)).toBe(true);
  });
});

describe("scored tier for ordinary documentation work", () => {
  // End-to-end: a docs-only change must land far below the critical band, not
  // merely below the floor.
  function scoreFor(files) {
    return computeScore(
      files.map((file) => ({ status: "M", file })),
      { files: files.length, lines: 12 },
      DEFAULTS,
    );
  }

  it("keeps a docs-only change out of the critical band", () => {
    const result = scoreFor([
      "docs/monkey.md",
      "docs/token-budget.md",
      "docs/auth-guide.md",
    ]);
    expect(result.riskScore).toBeLessThan(CRITICAL_RISK_SCORE);
  });

  it("still escalates when real security surface is touched", () => {
    const result = scoreFor(["docs/monkey.md", "config/auth/session.js"]);
    expect(result.riskScore).toBeGreaterThanOrEqual(
      DEFAULTS.base.securityFloor,
    );
  });
});
