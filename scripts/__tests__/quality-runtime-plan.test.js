const { planRuntime, workloadUnits } = require("../quality-runtime-plan");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { makeTempDir } = require("./helpers/tmp.js");

const PLANNER = path.join(__dirname, "..", "quality-runtime-plan.js");

describe("quality runtime planning", () => {
  const plan = (riskScore, files, lines, mode = "discovery") =>
    planRuntime({ riskScore, diffStats: { files, lines }, mode });

  it("increases campaign and review budgets with actual change size", () => {
    const micro = plan(10, 1, 5);
    const small = plan(10, 4, 120);
    const medium = plan(10, 12, 700);
    const large = plan(10, 30, 3000);
    const huge = plan(10, 80, 9000);

    expect([
      micro.campaignSeconds,
      small.campaignSeconds,
      medium.campaignSeconds,
      large.campaignSeconds,
      huge.campaignSeconds,
    ]).toEqual([300, 420, 600, 780, 900]);
    expect([
      micro.reviewSeconds,
      small.reviewSeconds,
      medium.reviewSeconds,
      large.reviewSeconds,
      huge.reviewSeconds,
    ]).toEqual([75, 180, 210, 330, 480]);
    expect(small.checkReserveSeconds).toBe(360);
  });

  it("adds per-file overhead so scattered changes cost more than one file", () => {
    expect(workloadUnits({ files: 20, lines: 20 })).toBeGreaterThan(
      workloadUnits({ files: 1, lines: 20 }),
    );
    expect(plan(10, 20, 20).workload).not.toBe(plan(10, 1, 20).workload);
  });

  it("keeps tiny critical changes deep without granting a huge-change clock", () => {
    const low = plan(10, 1, 5);
    const critical = plan(90, 1, 5);

    expect(low.workload).toBe("micro");
    expect(critical.workload).toBe("micro");
    expect(critical.reviewSeconds).toBe(540);
    expect(critical.campaignSeconds).toBe(900);
  });

  it("makes targeted verification cheaper than discovery for the same delta", () => {
    const discovery = plan(70, 8, 350);
    const verification = plan(70, 8, 350, "verification");

    expect(verification.reviewSeconds).toBeLessThan(discovery.reviewSeconds);
    expect(verification.reviewSeconds).toBe(120);
    expect(verification.reviewDepth).toBe("high");
    expect(verification.reviewPasses).toBe(1);
  });

  it("caps every default campaign at 15 minutes", () => {
    expect(plan(100, 500, 100000).campaignSeconds).toBe(900);
  });

  it("reserves every required gate before the mandatory discovery review", () => {
    const plan = planRuntime({
      riskScore: 60,
      diffStats: { files: 2, lines: 12 },
      gateCount: 3,
    });

    expect(plan.gateReserveSeconds).toBe(360);
    expect(plan.campaignSeconds).toBe(600);
    expect(plan.campaignSeconds).toBeGreaterThanOrEqual(
      plan.gateReserveSeconds + plan.reviewSeconds,
    );
  });

  it("lets explicit quality levels raise depth without erasing size scaling", () => {
    const level95 = planRuntime({
      riskScore: 5,
      minimumRisk: 50,
      diffStats: { files: 1, lines: 5 },
    });
    const level98 = planRuntime({
      riskScore: 5,
      minimumRisk: 75,
      diffStats: { files: 1, lines: 5 },
    });

    expect(level95.tier).toBe("high");
    expect(level95.campaignSeconds).toBe(540);
    expect(level98.tier).toBe("critical");
    expect(level98.campaignSeconds).toBe(900);
  });

  it("plans real git diffs at the same public CLI seam", () => {
    const repo = makeTempDir("quality-plan-");
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "test"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: repo,
    });
    fs.writeFileSync(path.join(repo, "README.md"), "base\n");
    execFileSync("git", ["add", "README.md"], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "base"], { cwd: repo });
    execFileSync("git", ["switch", "-q", "-c", "feature"], { cwd: repo });

    fs.appendFileSync(path.join(repo, "README.md"), "tiny docs edit\n");
    execFileSync("git", ["commit", "-qam", "docs"], { cwd: repo });
    const micro = JSON.parse(
      execFileSync("node", [PLANNER, "--base", "main", "--json"], {
        cwd: repo,
        encoding: "utf8",
      }),
    );
    expect(micro.workload).toBe("micro");
    expect(micro.taskType).toBe("docs");
    expect(micro.campaignSeconds).toBe(300);

    // BUI-381: the security floor on .github/workflows/** is content-aware —
    // a file with only a `name:` header would now score `high`, not
    // `critical` (see scripts/__tests__/risk-score.test.js for that case in
    // isolation). Use genuinely risk-bearing content (permissions: + run:)
    // here so this end-to-end CLI-seam test still exercises the critical
    // path it's named for.
    fs.mkdirSync(path.join(repo, ".github", "workflows"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, ".github", "workflows", "quality.yml"),
      "name: quality\npermissions:\n  contents: write\njobs:\n  build:\n    steps:\n      - run: ./deploy.sh\n",
    );
    execFileSync("git", ["add", ".github/workflows/quality.yml"], {
      cwd: repo,
    });
    execFileSync("git", ["commit", "-q", "-m", "ci"], { cwd: repo });
    const critical = JSON.parse(
      execFileSync("node", [PLANNER, "--base", "main", "--json"], {
        cwd: repo,
        encoding: "utf8",
      }),
    );
    expect(critical.tier).toBe("critical");
    expect(critical.taskType).toBe("ci");
    expect(critical.campaignSeconds).toBe(900);

    fs.writeFileSync(path.join(repo, "large.md"), "line\n".repeat(6000));
    execFileSync("git", ["add", "large.md"], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "large docs"], { cwd: repo });
    const huge = JSON.parse(
      execFileSync("node", [PLANNER, "--base", "main", "--json"], {
        cwd: repo,
        encoding: "utf8",
      }),
    );
    expect(huge.workload).toBe("huge");
    expect(huge.campaignSeconds).toBe(900);
  });

  it("includes an initialized submodule's expanded delta in its workload", () => {
    const parent = makeTempDir("quality-submodule-");
    const submodule = path.join(parent, "core");
    const repo = path.join(parent, "consumer");
    fs.mkdirSync(submodule);
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: submodule });
    execFileSync("git", ["config", "user.name", "test"], { cwd: submodule });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: submodule,
    });
    fs.writeFileSync(path.join(submodule, "README.md"), "base\n");
    execFileSync("git", ["add", "README.md"], { cwd: submodule });
    execFileSync("git", ["commit", "-q", "-m", "base"], { cwd: submodule });
    const previous = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: submodule,
      encoding: "utf8",
    }).trim();
    fs.writeFileSync(
      path.join(submodule, "expanded.md"),
      "line\n".repeat(1000),
    );
    execFileSync("git", ["add", "expanded.md"], { cwd: submodule });
    execFileSync("git", ["commit", "-q", "-m", "expanded"], { cwd: submodule });
    const current = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: submodule,
      encoding: "utf8",
    }).trim();

    fs.mkdirSync(repo);
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "test"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: repo,
    });
    fs.cpSync(submodule, path.join(repo, "core"), { recursive: true });
    execFileSync(
      "git",
      ["update-index", "--add", "--cacheinfo", `160000,${previous},core`],
      { cwd: repo },
    );
    execFileSync("git", ["commit", "-q", "-m", "base pointer"], {
      cwd: repo,
    });
    execFileSync("git", ["switch", "-q", "-c", "feature"], { cwd: repo });
    execFileSync(
      "git",
      ["update-index", "--cacheinfo", `160000,${current},core`],
      {
        cwd: repo,
      },
    );
    execFileSync("git", ["commit", "-q", "-m", "bump core"], { cwd: repo });

    const plan = JSON.parse(
      execFileSync("node", [PLANNER, "--base", "main", "--json"], {
        cwd: repo,
        encoding: "utf8",
      }),
    );
    expect(plan.diffStats.files).toBeGreaterThan(1);
    expect(plan.diffStats.lines).toBeGreaterThanOrEqual(1000);
    expect(plan.workload).toBe("medium");
  });
});
