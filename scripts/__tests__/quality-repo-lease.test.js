const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const invocation = require("../quality-invocation");
const lease = require("../quality-repo-lease");
const LEASE_CLI = path.resolve(__dirname, "..", "quality-repo-lease.js");

let sandbox;
let account;
let priorTmpdir;
let priorUserInfo;
let priorVitest;

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

beforeAll(() => {
  priorTmpdir = process.env.TMPDIR;
  priorVitest = process.env.VITEST;
  priorUserInfo = os.userInfo;
  sandbox = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "quality-repo-lease-test-")),
  );
  account = path.join(sandbox, "account");
  fs.mkdirSync(account, { mode: 0o700 });
  process.env.TMPDIR = sandbox;
  delete process.env.VITEST;
  os.userInfo = () => ({
    uid: process.geteuid(),
    gid: process.getegid(),
    username: "quality-test",
    homedir: account,
    shell: "/bin/zsh",
  });
});

afterAll(() => {
  os.userInfo = priorUserInfo;
  if (priorTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = priorTmpdir;
  if (priorVitest === undefined) delete process.env.VITEST;
  else process.env.VITEST = priorVitest;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function fixture(name, overrides = {}) {
  const root = path.join(sandbox, name);
  fs.mkdirSync(root, { recursive: true });
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "quality@example.test"]);
  git(root, ["config", "user.name", "Quality Test"]);
  fs.writeFileSync(path.join(root, "file.txt"), `${name}\n`);
  git(root, ["add", "file.txt"]);
  git(root, ["commit", "-q", "-m", "fixture"]);
  git(root, [
    "remote",
    "add",
    "origin",
    "git@github.com:buildproven/fixture.git",
  ]);
  const head = git(root, ["rev-parse", "HEAD"]);
  const repoKey = crypto.randomBytes(8).toString("hex");
  const invocationId = overrides.invocationId || crypto.randomUUID();
  const stateRoot = path.join(
    sandbox,
    "bs-quality",
    repoKey,
    "pr-7",
    head,
    invocationId,
  );
  fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const manifestPath = path.join(stateRoot, "invocation.json");
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        schemaVersion: invocation.SCHEMA_VERSION,
        manifestRevision: 1,
        invocationId,
        stateRoot,
        options: { merge: true },
        repo: {
          realpath: root,
          key: repoKey,
          pr: 7,
          origin: "git@github.com:buildproven/fixture.git",
          githubRepository: "BuildProven/Fixture",
          headRepository: "BuildProven/Fixture",
          headRefName: `fix/${name}`,
          isCrossRepository: false,
        },
        revisions: {
          baseRef: "origin/main",
          baseSha: head,
          baseHeadSha: head,
          initialHead: head,
          currentHead: head,
        },
        merge: { invalidatedStamps: [] },
        governor: {},
        reviews: [],
        gates: [],
        requiredGates: [],
        risk: { tier: "medium" },
      },
      null,
      2,
    )}\n`,
  );
  return { root, manifestPath };
}

describe("repository merge lease", () => {
  it("acquires idempotently for the exact owner and ignores TMPDIR changes", () => {
    const { manifestPath } = fixture("idempotent");
    const first = lease.acquire(manifestPath);
    const firstRoot = lease.stateRoot();
    process.env.TMPDIR = path.join(sandbox, "different-tmp");
    const secondRoot = lease.stateRoot();
    process.env.TMPDIR = sandbox;

    expect(secondRoot).toBe(firstRoot);
    expect(lease.acquire(manifestPath)).toEqual(first);
    expect(lease.status(manifestPath)).toMatchObject({
      state: "active",
      owned: true,
      repository: "buildproven/fixture",
    });
    lease.release(manifestPath, first.token, "test-complete");
  });

  it("keeps the fencing credential out of CLI verification output", () => {
    const { manifestPath } = fixture("silent-verification");
    const childEnv = {
      ...process.env,
      NODE_ENV: "test",
      VITEST: "true",
      VITEST_WORKER_ID: "credential-output",
    };
    execFileSync("node", [LEASE_CLI, "acquire", "--manifest", manifestPath], {
      env: childEnv,
    });
    const ownerToken =
      invocation.loadManifest(manifestPath).manifest.merge.repositoryLease
        .token;
    const output = execFileSync(
      "node",
      [LEASE_CLI, "verify", "--manifest", manifestPath],
      {
        encoding: "utf8",
        env: {
          ...childEnv,
          BS_QUALITY_REPOSITORY_LEASE_TOKEN: ownerToken,
        },
      },
    );
    expect(output).toBe("");
    expect(output).not.toContain(ownerToken);
    execFileSync("node", [LEASE_CLI, "release", "--manifest", manifestPath], {
      env: {
        ...childEnv,
        BS_QUALITY_REPOSITORY_LEASE_TOKEN: ownerToken,
      },
    });
  });

  it("rejects stale credentials at verification, mutation, and release", () => {
    const { manifestPath } = fixture("stale-token");
    const owner = lease.acquire(manifestPath);
    expect(() => lease.verify(manifestPath, "0".repeat(64))).toThrow(
      /stale|does not own/,
    );
    expect(() =>
      lease.withManifestMutation(manifestPath, "0".repeat(64), () => {}),
    ).toThrow(/stale/);
    expect(() => lease.release(manifestPath, "0".repeat(64))).toThrow(
      /exact.*owner/,
    );
    lease.release(manifestPath, owner.token, "test-complete");
  });

  it("rejects the same invocation id from an independent clone tuple", () => {
    const invocationId = crypto.randomUUID();
    const first = fixture("clone-one", { invocationId });
    const second = fixture("clone-two", { invocationId });
    const owner = lease.acquire(first.manifestPath);
    expect(() => lease.acquire(second.manifestPath, { waitMs: 0 })).toThrow(
      /owned by/,
    );
    lease.release(first.manifestPath, owner.token, "test-complete");
  });

  it("fences every public manifest mutation through the pinned process token", () => {
    const { manifestPath } = fixture("mutation-fence");
    const owner = lease.acquire(manifestPath);
    const previous = process.env.BS_QUALITY_REPOSITORY_LEASE_TOKEN;
    process.env.BS_QUALITY_REPOSITORY_LEASE_TOKEN = owner.token;
    invocation.withManifestLock(manifestPath, (manifest) => {
      manifest.risk.score = 42;
    });
    process.env.BS_QUALITY_REPOSITORY_LEASE_TOKEN = "f".repeat(64);
    expect(() =>
      invocation.withManifestLock(manifestPath, (manifest) => {
        manifest.risk.score = 99;
      }),
    ).toThrow(/stale/);
    expect(invocation.loadManifest(manifestPath).manifest.risk.score).toBe(42);
    if (previous === undefined)
      delete process.env.BS_QUALITY_REPOSITORY_LEASE_TOKEN;
    else process.env.BS_QUALITY_REPOSITORY_LEASE_TOKEN = previous;
    lease.release(manifestPath, owner.token, "test-complete");
  });

  it("uses crash-atomic namespace removal on release", () => {
    const { manifestPath } = fixture("atomic-release");
    const owner = lease.acquire(manifestPath);
    expect(lease.release(manifestPath, owner.token, "test-complete")).toBe(
      true,
    );
    expect(lease.status(manifestPath)).toEqual({
      required: true,
      state: "missing",
    });
  });

  it("requires the exact token and six-hour staleness before fenced recovery", () => {
    const first = fixture("recover-one");
    const second = fixture("recover-two");
    const owner = lease.acquire(first.manifestPath);
    expect(() => lease.recover(second.manifestPath, owner.token)).toThrow(
      /recent/,
    );

    const ownerFile = path.join(
      lease._pathsFor("buildproven/fixture").lease,
      "owner.json",
    );
    const record = JSON.parse(fs.readFileSync(ownerFile, "utf8"));
    record.renewedAt = new Date(
      Date.now() - lease.STALE_MS - 1000,
    ).toISOString();
    fs.writeFileSync(ownerFile, `${JSON.stringify(record, null, 2)}\n`, {
      mode: 0o600,
    });

    expect(() => lease.recover(second.manifestPath, "0".repeat(64))).toThrow(
      /does not match/,
    );
    const recovered = lease.recover(second.manifestPath, owner.token);
    expect(() => lease.verify(first.manifestPath, owner.token)).toThrow(
      /stale|does not own/,
    );
    expect(lease.verify(second.manifestPath, recovered.token)).toMatchObject({
      generation: 2,
    });
    lease.release(second.manifestPath, recovered.token, "test-complete");
  });

  it("reconciles a crashed merge guard from exact authoritative GitHub state", () => {
    const { manifestPath } = fixture("merge-reconcile");
    const owner = lease.acquire(manifestPath);
    lease.acquireMergeGuard(manifestPath, owner.token);
    const { manifest } = invocation.loadManifest(manifestPath);
    const bin = path.join(sandbox, "merge-reconcile-bin");
    fs.mkdirSync(bin);
    const gh = path.join(bin, "gh");
    fs.writeFileSync(
      gh,
      `#!/bin/sh
printf '%s\\n' '${JSON.stringify({
        state: "MERGED",
        mergedAt: "2026-08-05T12:00:00Z",
        mergeCommit: { oid: "a".repeat(40) },
        headRefName: manifest.repo.headRefName,
        headRefOid: manifest.revisions.currentHead,
      })}'
`,
      { mode: 0o700 },
    );
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}:${previousPath}`;
    try {
      expect(lease.releaseIfMerged(manifestPath, owner.token)).toBe(true);
      expect(lease.status(manifestPath)).toEqual({
        required: true,
        state: "missing",
      });
      expect(
        fs.existsSync(
          lease._pathsFor("buildproven/fixture", manifest).mergeGuard,
        ),
      ).toBe(false);
    } finally {
      process.env.PATH = previousPath;
    }
  });
});
