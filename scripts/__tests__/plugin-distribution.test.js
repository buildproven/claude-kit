import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(ROOT, relativePath), "utf8"));
}

describe("plugin distribution", () => {
  it("keeps package, plugin, and marketplace versions aligned", () => {
    const packageJson = readJson("package.json");
    const plugin = readJson(".claude-plugin/plugin.json");
    const marketplace = readJson(".claude-plugin/marketplace.json");
    const listing = marketplace.plugins.find(
      (candidate) => candidate.name === plugin.name,
    );

    expect(listing).toBeDefined();
    expect(plugin.version).toBe(packageJson.version);
    expect(listing.version).toBe(packageJson.version);
  });

  it("relies on the standard auto-loaded hooks file exactly once", () => {
    const plugin = readJson(".claude-plugin/plugin.json");

    expect(existsSync(path.join(ROOT, "hooks", "hooks.json"))).toBe(true);
    expect(plugin).not.toHaveProperty("hooks");
  });
});
