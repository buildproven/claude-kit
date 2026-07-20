const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  clearProviderFailure,
  providerAvailability,
  readState,
  recordProviderFailure,
} = require("../quality-provider-health");

describe("quality provider health circuit", () => {
  const stateFile = () =>
    path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "provider-health-")),
      "state.json",
    );

  it("skips a provider until its typed exhaustion reset", () => {
    const file = stateFile();
    recordProviderFailure(
      file,
      "claude",
      {
        category: "provider-exhaustion",
        resetAt: "2099-01-01T00:00:00.000Z",
      },
      Date.parse("2026-07-20"),
    );

    expect(
      providerAvailability(file, "claude", Date.parse("2026-07-20")),
    ).toMatchObject({
      available: false,
      category: "provider-exhaustion",
    });
    expect(
      providerAvailability(file, "claude", Date.parse("2100-01-01")),
    ).toMatchObject({
      available: true,
      probe: true,
      priorFailure: "provider-exhaustion",
    });
  });

  it("opens billing circuits, then permits a bounded recovery probe", () => {
    const file = stateFile();
    const now = Date.parse("2026-07-20T00:00:00Z");
    recordProviderFailure(
      file,
      "codex",
      {
        category: "provider-billing",
        resetAt: null,
      },
      now,
    );
    expect(providerAvailability(file, "codex", now)).toMatchObject({
      available: false,
      category: "provider-billing",
    });
    expect(
      providerAvailability(file, "codex", now + 6 * 60 * 60 * 1000),
    ).toMatchObject({
      available: true,
      probe: true,
      priorFailure: "provider-billing",
    });

    clearProviderFailure(file, "codex");
    expect(providerAvailability(file, "codex")).toEqual({ available: true });
  });

  it("reads legacy aggregate files and tombstones cleared legacy circuits", () => {
    const file = stateFile();
    fs.writeFileSync(
      file,
      JSON.stringify({
        schemaVersion: 1,
        providers: {
          codex: {
            category: "provider-billing",
            resetAt: null,
            probeAt: "2099-01-01T00:00:00.000Z",
          },
        },
      }),
    );
    expect(providerAvailability(file, "codex")).toMatchObject({
      available: false,
      category: "provider-billing",
    });
    clearProviderFailure(file, "codex");
    expect(providerAvailability(file, "codex")).toEqual({ available: true });
  });

  it("persists provider circuits independently without lost updates", () => {
    const file = stateFile();
    recordProviderFailure(file, "claude", {
      category: "provider-exhaustion",
      resetAt: "2099-01-01T00:00:00.000Z",
    });
    recordProviderFailure(file, "codex", {
      category: "provider-billing",
      resetAt: null,
    });
    expect(readState(file).providers).toMatchObject({
      claude: { category: "provider-exhaustion" },
      codex: { category: "provider-billing" },
    });
  });
});
