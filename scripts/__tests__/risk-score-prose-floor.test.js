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
