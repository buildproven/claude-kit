const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCRIPT = path.resolve(
  __dirname,
  "..",
  "steward",
  "discover-active-repos.py",
);

function initCheckout(root, name, remote) {
  const checkout = path.join(root, name);
  fs.mkdirSync(checkout, { recursive: true });
  execFileSync("git", ["init", "--quiet", checkout]);
  execFileSync("git", ["-C", checkout, "remote", "add", "origin", remote]);
  return fs.realpathSync(checkout);
}

describe("steward active-repository discovery", () => {
  it("keeps the first configured primary checkout for a duplicate remote", () => {
    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "steward-roots-"),
    );
    try {
      const preferredRoot = path.join(fixtureRoot, "preferred");
      const fallbackRoot = path.join(fixtureRoot, "fallback");
      fs.mkdirSync(preferredRoot);
      fs.mkdirSync(fallbackRoot);
      const remote = "https://github.com/buildproven/example.git";
      const preferred = initCheckout(preferredRoot, "example", remote);
      initCheckout(fallbackRoot, "example", remote);

      const config = path.join(fixtureRoot, "config.json");
      const fixture = path.join(fixtureRoot, "repos.json");
      const output = path.join(fixtureRoot, "active.json");
      fs.writeFileSync(
        config,
        JSON.stringify({
          windowDays: 14,
          minimumCommits: 1,
          localRoots: [preferredRoot, fallbackRoot],
          include: ["buildproven/example"],
          exclude: [],
        }),
      );
      fs.writeFileSync(
        fixture,
        JSON.stringify([
          {
            nameWithOwner: "buildproven/example",
            name: "example",
            isArchived: false,
            commits: [],
            pullRequests: [],
          },
        ]),
      );

      execFileSync("python3", [
        SCRIPT,
        "--config",
        config,
        "--fixture",
        fixture,
        "--output",
        output,
      ]);
      const result = JSON.parse(fs.readFileSync(output, "utf8"));
      expect(result.repositories).toHaveLength(1);
      expect(result.repositories[0].localPath).toBe(preferred);
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
