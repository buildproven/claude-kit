const { touchesHumanFloor, DEFAULTS } = require("../risk-score");

// ---------------------------------------------------------------------------
// Always-human security subset — enforced even on unprotectable repos where
// critical tier otherwise auto-approves on clean review.
// ---------------------------------------------------------------------------
describe("touchesHumanFloor", () => {
  const humanFloorCases = [
    ["src/auth/login.js", "auth dir"],
    ["packages/auth/session.ts", "nested auth dir"],
    ["config/app.secret.json", "secret file"],
    ["lib/credentials.js", "credential file"],
    ["deploy/prod.sh", "deploy dir"],
    ["scripts/deploy-app.sh", "deploy- prefix"],
    ["deployment.yaml", "deploy*.* file"],
    ["src/licensing.ts", "licensing"],
    ["license-check.js", "license*"],
    ["infra/webhook-handler.js", "webhook"],
    ["keys/server.pem", "pem key"],
    ["certs/tls.key", "key file"],
    [".env.production", "env secrets"],
  ];
  for (const [file, why] of humanFloorCases) {
    it(`flags ${file} (${why})`, () => {
      expect(touchesHumanFloor([file], DEFAULTS)).toBe(true);
    });
  }

  const clearCases = [
    [
      ".github/workflows/gate.yml",
      "workflow — your own config, NOT human floor",
    ],
    ["config/settings.json", "settings.json"],
    ["scripts/quality-run.sh", "ordinary script"],
    ["src/api/users.js", "ordinary source"],
    ["README.md", "docs"],
    ["install.sh", "install — in securityFloor but NOT humanFloor"],
  ];
  for (const [file, why] of clearCases) {
    it(`allows ${file} (${why})`, () => {
      expect(touchesHumanFloor([file], DEFAULTS)).toBe(false);
    });
  }

  it("flags the whole set if ANY file is human-floor", () => {
    expect(touchesHumanFloor(["README.md", "keys/server.pem"], DEFAULTS)).toBe(
      true,
    );
  });

  it("treats a scorePolicy.humanFloor override as additive only", () => {
    const cfg = { humanFloor: ["**/only-this.js"] };
    expect(touchesHumanFloor(["keys/server.pem"], cfg)).toBe(true);
    expect(touchesHumanFloor(["a/only-this.js"], cfg)).toBe(true);
  });

  it("cannot be disabled with an empty scorePolicy.humanFloor", () => {
    expect(touchesHumanFloor(["keys/server.pem"], { humanFloor: [] })).toBe(
      true,
    );
  });

  it("empty file list never touches the human floor", () => {
    expect(touchesHumanFloor([], DEFAULTS)).toBe(false);
  });

  // Adversarial evasions proven by Codex + security-auditor review — each MUST
  // be caught (return true) now.
  const evasions = [
    ["AUTH/keys.ts", "uppercase auth dir"],
    [".ENV", "uppercase env"],
    ["server.PEM", "uppercase pem ext"],
    ["DEPLOY/ship.sh", "uppercase deploy dir"],
    ["Keys/Server.Key", "mixed-case key"],
    ["./auth/x.js", "leading ./"],
    ["src\\auth\\x.js", "backslash separators"],
    ["src/oauth.ts", "oauth token"],
    ["src/password-reset.ts", "password token"],
    ["lib/refreshToken.js", "token"],
    ["keys/id_rsa", "id_rsa no extension"],
    ["certs/client.p12", "p12 keystore"],
    ["certs/store.pfx", "pfx keystore"],
    ["config/app.jks", "java keystore"],
    ["secrets/aws.json", "secrets directory"],
    ["credentials/cloud.json", "credentials directory"],
    ["passwords/admin.txt", "passwords directory"],
    ["tokens/api.json", "tokens directory"],
    ["webhooks/receive.js", "webhooks directory"],
    ["license/policy.js", "license directory"],
    ["licensing/policy.js", "licensing directory"],
    ["deployments/ship.sh", "deployments directory"],
    ["keystore/config.json", "keystore directory"],
    ["keystores/config.json", "keystores directory"],
    ["keyring/config.json", "keyring directory"],
    ["keychain/config.json", "keychain directory"],
    ["harness-config.json", "self-authored risk policy"],
    ["src/api-key.txt", "compound API key filename"],
    ["config/key.yaml", "standalone key filename"],
    ["src/keystore.yaml", "keystore filename"],
    ["src/keyring.ts", "keyring filename"],
    ["src/keychain.json", "keychain filename"],
    ["src/server.ppk", "PuTTY private key"],
    ["src/server.pk8", "PKCS#8 private key"],
    ["key-material/config.json", "compound key directory"],
    ["key_store/config.json", "underscored key directory"],
  ];
  for (const [file, why] of evasions) {
    it(`catches evasion: ${file} (${why})`, () => {
      expect(touchesHumanFloor([file], DEFAULTS)).toBe(true);
    });
  }

  it("still lets ordinary files through after hardening", () => {
    for (const f of [
      "scripts/util.sh",
      ".github/workflows/gate.yml",
      "config/settings.json",
      "src/components/Button.tsx",
      "README.md",
    ]) {
      expect(touchesHumanFloor([f], DEFAULTS)).toBe(false);
    }
  });
});
