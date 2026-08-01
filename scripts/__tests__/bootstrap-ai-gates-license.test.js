// Regression coverage for bootstrap-ai-gates.sh Gate 8 (license compliance).
//
// See BUI-473 for the underlying vulnerable-dependency fix this test guards.
// Before this test, the script's license-checker-rseidelsohn references had
// zero test coverage, so a revert of the BUI-473 package-rename fix could not
// produce red-capable mutation evidence. Runs the real script against a
// scratch target dir in --dry-run mode (no installs, no network) and asserts
// the emitted plan references the maintained package name, not the abandoned
// `license-checker` (whose dependency chain carries an unfixable transitive
// brace-expansion advisory).

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { makeTempDir } = require("./helpers/tmp.js");

const SCRIPT = path.resolve(__dirname, "..", "bootstrap-ai-gates.sh");

describe("bootstrap-ai-gates.sh license gate", () => {
  it("dry-run plan installs license-checker-rseidelsohn, not the abandoned package", () => {
    const target = makeTempDir("bootstrap-ai-gates-license-");
    fs.writeFileSync(
      path.join(target, "package.json"),
      JSON.stringify({ name: "scratch", scripts: {} }, null, 2),
    );

    const output = execFileSync("bash", [SCRIPT, "--dry-run"], {
      cwd: target,
      encoding: "utf8",
    });

    expect(output).toMatch(/Would install license-checker-rseidelsohn/);
    expect(output).not.toMatch(/Would install license-checker(?!-rseidelsohn)/);
  });
});
