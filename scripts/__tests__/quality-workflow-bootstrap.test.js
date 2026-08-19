import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

describe("quality workflow bootstrap", () => {
  it("skips an existing zsh and bounds package installation", () => {
    const workflow = fs.readFileSync(
      path.join(repoRoot, ".github/workflows/quality.yml"),
      "utf8",
    );
    const installStep = workflow.match(
      /- name: Install zsh for shell-isolation regressions\n([\s\S]*?)\n\s+- run: npm ci/,
    )?.[1];

    expect(installStep).toBeDefined();
    expect(installStep).toContain("timeout-minutes: 3");
    expect(installStep).toContain("command -v zsh");
    expect(installStep).toContain("timeout 30s sudo apt-get update");
    expect(installStep).toContain(
      "timeout 150s sudo env DEBIAN_FRONTEND=noninteractive apt-get",
    );
    expect(installStep).toContain("-o Acquire::http::Timeout=15");
    expect(installStep).toContain("-o Acquire::https::Timeout=15");
    expect(installStep).toContain("-o Acquire::Retries=3");
    expect(installStep).toContain("install --yes zsh");
  });
});
