const { execFileSync, spawnSync } = require("node:child_process");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const HOOK = path.resolve(
  import.meta.dirname,
  "..",
  "bash-pretooluse-dispatcher.js",
);

let repo;

function runRaw(input, { cwd = repo, env = {} } = {}) {
  const result = spawnSync("node", [HOOK], {
    input,
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    code: result.status,
    output: `${result.stdout || ""}${result.stderr || ""}`,
  };
}

function run(command, options) {
  return runRaw(JSON.stringify({ tool_input: { command } }), options);
}

const git = (args) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8" });

beforeAll(() => {
  repo = mkdtempSync(path.join(tmpdir(), "bash-pretooluse-dispatcher-"));
  git(["init", "--initial-branch=main"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  writeFileSync(path.join(repo, "seed.txt"), "seed\n");
  git(["add", "."]);
  git(["commit", "-m", "seed"]);
});

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

describe("bash-pretooluse-dispatcher.js", () => {
  it("allows an ordinary command without invoking a guard", () => {
    expect(run("printf ok").code).toBe(0);
  });

  it("fails closed for malformed JSON", () => {
    const result = runRaw("{");
    expect(result.code).toBe(2);
    expect(result.output).toMatch(/invalid JSON/i);
  });

  it("fails closed when command is not a string", () => {
    const result = runRaw(JSON.stringify({ tool_input: { command: 42 } }));
    expect(result.code).toBe(2);
    expect(result.output).toMatch(/not a string/i);
  });

  it("preserves the destructive-path guard", () => {
    const result = run("rm -rf ~/Projects");
    expect(result.code).toBe(2);
    expect(result.output).toMatch(/destructive command/i);
  });

  it("preserves protected-push enforcement", () => {
    const result = run("git push origin main");
    expect(result.code).toBe(2);
    expect(result.output).toMatch(/main/i);
  });

  it("preserves primary-checkout commit enforcement", () => {
    const result = run("git commit -m next");
    expect(result.code).toBe(2);
    expect(result.output).toMatch(/primary checkout|git commit on main/i);
  });

  it("preserves the ordinary git command path", () => {
    expect(
      run("git status", { env: { SESSION_ID: "dispatcher-status" } }).code,
    ).toBe(0);
  });
});
