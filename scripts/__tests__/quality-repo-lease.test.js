const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawn } = require("child_process");
const invocation = require("../quality-invocation");
const lease = require("../quality-repo-lease");
const LEASE_CLI = path.resolve(__dirname, "..", "quality-repo-lease.js");
const FIXTURE_REPOSITORY = `vitest/${"a".repeat(16)}`;

let sandbox;
const stateRoots = [];

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

beforeAll(() => {
  sandbox = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "quality-repo-lease-test-")),
  );
});

afterAll(() => {
  for (const stateRoot of stateRoots) {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function fixture(name, overrides = {}) {
  const root = path.join(sandbox, name);
  if (overrides.linkedFrom) {
    git(overrides.linkedFrom.root, ["worktree", "add", "-q", "--detach", root]);
    if (overrides.advanceHead) {
      fs.writeFileSync(path.join(root, "file.txt"), `${name}\n`);
      git(root, ["add", "file.txt"]);
      git(root, ["commit", "-q", "-m", `fixture ${name}`]);
    }
  } else {
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
  }
  const head = git(root, ["rev-parse", "HEAD"]);
  const repoKey = overrides.repoKey || crypto.randomBytes(8).toString("hex");
  const invocationId = overrides.invocationId || crypto.randomUUID();
  const githubRepository = overrides.githubRepository || FIXTURE_REPOSITORY;
  const stateRoot = path.join(
    fs.realpathSync(process.env.TMPDIR || os.tmpdir()),
    "bs-quality",
    repoKey,
    "pr-7",
    head,
    invocationId,
  );
  stateRoots.push(stateRoot);
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
          githubRepository,
          headRepository: githubRepository,
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
  fs.writeFileSync(
    path.join(
      fs.realpathSync(
        path.resolve(root, git(root, ["rev-parse", "--git-common-dir"])),
      ),
      ".quality-vitest-fixture",
    ),
    `${repoKey}\n`,
    { mode: 0o600 },
  );
  return { root, manifestPath, repoKey };
}

describe("repository merge lease", () => {
  it("acquires idempotently for the exact owner and ignores TMPDIR changes", () => {
    const { manifestPath } = fixture("idempotent");
    const first = lease.acquire(manifestPath);
    const firstRoot = lease.stateRoot();
    const priorTmpdir = process.env.TMPDIR;
    process.env.TMPDIR = path.join(sandbox, "different-tmp");
    const secondRoot = lease.stateRoot();
    if (priorTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = priorTmpdir;

    expect(secondRoot).toBe(firstRoot);
    expect(lease.acquire(manifestPath)).toEqual(first);
    expect(lease.status(manifestPath)).toMatchObject({
      state: "active",
      owned: true,
      repository: FIXTURE_REPOSITORY,
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

  it("does not let ambient Vitest variables redirect a real repository", () => {
    const { root, manifestPath } = fixture("ambient-test-namespace", {
      githubRepository: "BuildProven/Fixture",
    });
    const { manifest } = invocation.loadManifest(manifestPath);
    fs.writeFileSync(
      path.join(root, ".quality-vitest-fixture"),
      `${manifest.repo.key}\n`,
    );
    const previousVitest = process.env.VITEST;
    const previousWorker = process.env.VITEST_WORKER_ID;
    process.env.VITEST = "true";
    process.env.VITEST_WORKER_ID = "ambient-test-namespace";
    try {
      expect(lease.isVitestFixture(manifest)).toBe(false);
      expect(lease._pathsFor("buildproven/fixture", manifest).root).toBe(
        lease.stateRoot(),
      );
    } finally {
      if (previousVitest === undefined) delete process.env.VITEST;
      else process.env.VITEST = previousVitest;
      if (previousWorker === undefined) delete process.env.VITEST_WORKER_ID;
      else process.env.VITEST_WORKER_ID = previousWorker;
    }
  });

  it("reads a test-fixture sentinel from one non-symlink descriptor", () => {
    const githubRepository = `vitest/${crypto.randomBytes(12).toString("hex")}`;
    const { root, manifestPath } = fixture("fixture-sentinel", {
      githubRepository,
    });
    const { manifest } = invocation.loadManifest(manifestPath);
    const sentinel = path.join(root, ".git", ".quality-vitest-fixture");
    fs.writeFileSync(sentinel, `${manifest.repo.key}\n`, { mode: 0o600 });
    const previousVitest = process.env.VITEST;
    const previousWorker = process.env.VITEST_WORKER_ID;
    process.env.VITEST = "true";
    process.env.VITEST_WORKER_ID = "fixture-sentinel";
    try {
      expect(lease.isVitestFixture(manifest)).toBe(true);
      const backing = path.join(root, ".git", ".fixture-sentinel-backing");
      fs.renameSync(sentinel, backing);
      fs.symlinkSync(backing, sentinel);
      expect(() => lease.isVitestFixture(manifest)).toThrow(
        /non-symlink regular file/,
      );
      fs.unlinkSync(sentinel);
      fs.renameSync(backing, sentinel);
    } finally {
      if (previousVitest === undefined) delete process.env.VITEST;
      else process.env.VITEST = previousVitest;
      if (previousWorker === undefined) delete process.env.VITEST_WORKER_ID;
      else process.env.VITEST_WORKER_ID = previousWorker;
    }
  });

  it("refuses to release a pending lease generation", () => {
    const { manifestPath } = fixture("pending-release");
    const owner = lease.acquire(manifestPath);
    const { manifest } = invocation.loadManifest(manifestPath);
    const ownerFile = path.join(
      lease._pathsFor(FIXTURE_REPOSITORY, manifest).lease,
      "owner.json",
    );
    const record = JSON.parse(fs.readFileSync(ownerFile, "utf8"));
    record.disposition = "rotation-pending";
    fs.writeFileSync(ownerFile, `${JSON.stringify(record, null, 2)}\n`, {
      mode: 0o600,
    });
    expect(() => lease.release(manifestPath, owner.token)).toThrow(
      /exact.*owner/,
    );
    record.disposition = "active";
    fs.writeFileSync(ownerFile, `${JSON.stringify(record, null, 2)}\n`, {
      mode: 0o600,
    });
    lease.release(manifestPath, owner.token, "test-complete");
  });

  it("serializes dead-guard recovery and never removes a replacement owner", () => {
    const directory = path.join(sandbox, "guard-recovery-race");
    fs.mkdirSync(directory, { mode: 0o700 });
    const observed = {
      schemaVersion: 1,
      pid: 99999999,
      uid: process.geteuid(),
      nonce: crypto.randomBytes(16).toString("hex"),
      processIdentity: null,
      acquiredAt: "2026-08-05T00:00:00.000Z",
    };
    fs.writeFileSync(
      path.join(directory, "owner.json"),
      `${JSON.stringify(observed)}\n`,
      { mode: 0o600 },
    );
    const recoveryLock = `${directory}.recovery-lock`;
    fs.writeFileSync(recoveryLock, "busy\n", { mode: 0o600 });
    expect(lease._recoverDeadGuard(directory, observed)).toBe(false);

    const replacement = {
      ...observed,
      pid: process.pid,
      nonce: crypto.randomBytes(16).toString("hex"),
      acquiredAt: "2026-08-05T00:00:01.000Z",
    };
    fs.writeFileSync(
      path.join(directory, "owner.json"),
      `${JSON.stringify(replacement)}\n`,
      { mode: 0o600 },
    );
    fs.unlinkSync(recoveryLock);
    expect(lease._recoverDeadGuard(directory, observed)).toBe(false);
    expect(
      JSON.parse(fs.readFileSync(path.join(directory, "owner.json"), "utf8")),
    ).toEqual(replacement);
    fs.unlinkSync(path.join(directory, "owner.json"));
    fs.rmdirSync(directory);
  });

  it("distinguishes a recycled PID from the recorded guard process", () => {
    const directory = path.join(sandbox, "guard-reused-pid");
    fs.mkdirSync(directory, { mode: 0o700 });
    const observed = {
      schemaVersion: 1,
      pid: process.pid,
      uid: process.geteuid(),
      nonce: crypto.randomBytes(16).toString("hex"),
      processIdentity: "a different process start time",
      acquiredAt: "2026-08-05T00:00:00.000Z",
    };
    fs.writeFileSync(
      path.join(directory, "owner.json"),
      `${JSON.stringify(observed)}\n`,
      { mode: 0o600 },
    );
    expect(lease._recoverDeadGuard(directory, observed)).toBe(true);
    expect(fs.existsSync(directory)).toBe(false);
  });

  it("cleans a newly created guard when its owner write fails", () => {
    const directory = path.join(sandbox, "guard-owner-write-failure");
    expect(() =>
      lease._acquireGuard(directory, 10, {
        writeOwner() {
          const error = new Error("injected owner write failure");
          error.code = "EIO";
          throw error;
        },
      }),
    ).toThrow(/injected owner write failure/);
    expect(fs.existsSync(directory)).toBe(false);
  });

  it("retries when a contended guard disappears before its owner read", async () => {
    const directory = path.join(sandbox, "guard-release-race");
    fs.mkdirSync(directory, { mode: 0o700 });
    const child = spawn(
      "node",
      [
        "-e",
        `require(${JSON.stringify(path.resolve(__dirname, "..", "quality-repo-lease.js"))})._acquireGuard(${JSON.stringify(directory)}, 1000)`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    fs.rmdirSync(directory);
    const result = await new Promise((resolve) => {
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("close", (code) => resolve({ code, stderr }));
    });
    expect(result.code, result.stderr).toBe(0);
    fs.unlinkSync(path.join(directory, "owner.json"));
    fs.rmdirSync(directory);
  });

  it("rejects a symlink substituted for an opened lease record", () => {
    const { manifestPath } = fixture("symlink-record");
    const owner = lease.acquire(manifestPath);
    const { manifest } = invocation.loadManifest(manifestPath);
    const ownerFile = path.join(
      lease._pathsFor(FIXTURE_REPOSITORY, manifest).lease,
      "owner.json",
    );
    const backingFile = path.join(
      path.dirname(ownerFile),
      "owner.backing.json",
    );
    fs.renameSync(ownerFile, backingFile);
    fs.symlinkSync(backingFile, ownerFile);
    expect(() => lease.verify(manifestPath, owner.token)).toThrow(
      /non-symlink regular file/,
    );
    fs.unlinkSync(ownerFile);
    fs.renameSync(backingFile, ownerFile);
    lease.release(manifestPath, owner.token, "test-complete");
  });

  it("rejects the same invocation id from an independent clone tuple", () => {
    const invocationId = crypto.randomUUID();
    const first = fixture("clone-one", { invocationId });
    const second = fixture("clone-two", {
      invocationId,
      linkedFrom: first,
      repoKey: first.repoKey,
      advanceHead: true,
    });
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
    const second = fixture("recover-two", {
      linkedFrom: first,
      repoKey: first.repoKey,
    });
    const owner = lease.acquire(first.manifestPath);
    expect(() => lease.recover(second.manifestPath, owner.token)).toThrow(
      /recent/,
    );

    const { manifest } = invocation.loadManifest(first.manifestPath);
    const ownerFile = path.join(
      lease._pathsFor(FIXTURE_REPOSITORY, manifest).lease,
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

  it("completes either crash point in the pending rotation write pair", () => {
    for (const crashPoint of ["before-manifest", "after-manifest"]) {
      const { manifestPath } = fixture(`rotation-${crashPoint}`);
      const owner = lease.acquire(manifestPath);
      const { manifest } = invocation.loadManifest(manifestPath);
      const ownerFile = path.join(
        lease._pathsFor(FIXTURE_REPOSITORY, manifest).lease,
        "owner.json",
      );
      const record = JSON.parse(fs.readFileSync(ownerFile, "utf8"));
      const nextToken = crypto.randomBytes(32).toString("hex");
      const pending = {
        ...record,
        disposition: "rotation-pending",
        priorToken: owner.token,
        token: nextToken,
        generation: owner.generation + 1,
      };
      fs.writeFileSync(ownerFile, `${JSON.stringify(pending, null, 2)}\n`, {
        mode: 0o600,
      });
      if (crashPoint === "after-manifest") {
        invocation.withManifestLockRaw(manifestPath, (manifest) => {
          manifest.merge.repositoryLease = {
            repository: FIXTURE_REPOSITORY,
            generation: pending.generation,
            token: nextToken,
          };
        });
      }
      const recovered = lease.recover(manifestPath, owner.token);
      expect(recovered).toMatchObject({
        token: nextToken,
        generation: owner.generation + 1,
      });
      expect(() => lease.verify(manifestPath, owner.token)).toThrow(/stale/);
      expect(lease.verify(manifestPath, nextToken)).toMatchObject({
        disposition: "active",
      });
      lease.release(manifestPath, nextToken, "test-complete");
    }
  });

  it("preserves both the primary atomic-write and cleanup failures", () => {
    const directory = path.join(sandbox, "atomic-write-double-failure");
    fs.mkdirSync(directory, { mode: 0o700 });
    const target = path.join(directory, "owner.json");
    const originalWrite = fs.writeFileSync;
    const originalUnlink = fs.unlinkSync;
    fs.writeFileSync = (file, data, options = {}) => {
      originalWrite(file, data, { ...options, mode: 0o600 });
      throw new Error("primary write failure");
    };
    fs.unlinkSync = () => {
      throw new Error("cleanup unlink failure");
    };
    try {
      expect(() => lease._atomicWrite(target, { value: true })).toThrow(
        /primary write failure.*cleanup.*cleanup unlink failure/,
      );
    } finally {
      fs.writeFileSync = originalWrite;
      fs.unlinkSync = originalUnlink;
      for (const file of fs.readdirSync(directory)) {
        originalUnlink(path.join(directory, file));
      }
      fs.rmdirSync(directory);
    }
  });

  it("reconciles a crashed merge guard without the lost process token", () => {
    const { manifestPath } = fixture("merge-reconcile");
    const owner = lease.acquire(manifestPath);
    lease.acquireMergeGuard(manifestPath, owner.token, { admin: true });
    expect(() =>
      lease.release(manifestPath, owner.token, "provider-incomplete"),
    ).toThrow(/quarantined/);
    expect(lease.status(manifestPath).mergeGuard).toMatchObject({
      admin: true,
      adminReason: "ci-billing-waiver",
    });
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
      expect(() =>
        lease.reconcileMergeOutcome(manifestPath, undefined, {
          confirmOwnerInvocationId: "wrong",
          confirmOwnerPr: manifest.repo.pr,
        }),
      ).toThrow(/exact current owner/);
      const reconcileEnv = { ...process.env };
      delete reconcileEnv.BS_QUALITY_REPOSITORY_LEASE_TOKEN;
      expect(
        JSON.parse(
          execFileSync(
            "node",
            [
              LEASE_CLI,
              "reconcile-merge",
              "--manifest",
              manifestPath,
              "--confirm-owner-invocation-id",
              manifest.invocationId,
              "--confirm-owner-pr",
              String(manifest.repo.pr),
            ],
            { encoding: "utf8", env: reconcileEnv },
          ),
        ),
      ).toMatchObject({ reconciled: true, outcome: "merged" });
      expect(lease.status(manifestPath)).toEqual({
        required: true,
        state: "missing",
      });
      expect(
        invocation.loadManifest(manifestPath).manifest.terminalState,
      ).toMatchObject({
        state: "merged",
        head: manifest.revisions.currentHead,
      });
      expect(
        fs.existsSync(lease._pathsFor(FIXTURE_REPOSITORY, manifest).mergeGuard),
      ).toBe(false);
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("reclaims a durably released lease after a cleanup crash", () => {
    const first = fixture("released-cleanup-crash");
    const owner = lease.acquire(first.manifestPath);
    const { manifest } = invocation.loadManifest(first.manifestPath);
    const paths = lease._pathsFor(FIXTURE_REPOSITORY, manifest);
    lease.acquireMergeGuard(first.manifestPath, owner.token);
    const record = JSON.parse(
      fs.readFileSync(path.join(paths.lease, "owner.json"), "utf8"),
    );
    record.disposition = "released";
    record.releaseReason = "verified-remote-merged";
    fs.writeFileSync(
      path.join(paths.lease, "owner.json"),
      `${JSON.stringify(record, null, 2)}\n`,
      { mode: 0o600 },
    );

    const second = fixture("released-cleanup-successor", {
      linkedFrom: first,
      repoKey: first.repoKey,
      advanceHead: true,
    });
    const successor = lease.acquire(second.manifestPath, { waitMs: 0 });
    expect(successor.generation).toBe(1);
    expect(
      invocation.loadManifest(first.manifestPath).manifest.terminalState,
    ).toMatchObject({ state: "merged", head: manifest.revisions.currentHead });
    lease.release(second.manifestPath, successor.token, "test-complete");
    expect(owner.token).not.toBe(successor.token);
  });

  it("reports a late manifest mutation after release as released", () => {
    const { manifestPath } = fixture("late-mutation");
    const owner = lease.acquire(manifestPath);
    lease.release(manifestPath, owner.token, "test-complete");
    const previous = process.env.BS_QUALITY_REPOSITORY_LEASE_TOKEN;
    process.env.BS_QUALITY_REPOSITORY_LEASE_TOKEN = owner.token;
    try {
      expect(() => invocation.withManifestLock(manifestPath, () => {})).toThrow(
        /missing or has already been released/,
      );
    } finally {
      if (previous === undefined)
        delete process.env.BS_QUALITY_REPOSITORY_LEASE_TOKEN;
      else process.env.BS_QUALITY_REPOSITORY_LEASE_TOKEN = previous;
    }
  });

  it("does not reclaim an unverified released lease with a merge guard", () => {
    const first = fixture("unverified-release-guard");
    const owner = lease.acquire(first.manifestPath);
    lease.acquireMergeGuard(first.manifestPath, owner.token);
    const { manifest } = invocation.loadManifest(first.manifestPath);
    const paths = lease._pathsFor(FIXTURE_REPOSITORY, manifest);
    const record = JSON.parse(
      fs.readFileSync(path.join(paths.lease, "owner.json"), "utf8"),
    );
    record.disposition = "released";
    record.releaseReason = "provider-incomplete";
    fs.writeFileSync(
      path.join(paths.lease, "owner.json"),
      `${JSON.stringify(record, null, 2)}\n`,
      { mode: 0o600 },
    );
    const second = fixture("unverified-release-successor", {
      linkedFrom: first,
      repoKey: first.repoKey,
      advanceHead: true,
    });
    expect(() => lease.acquire(second.manifestPath, { waitMs: 0 })).toThrow(
      /quarantined/,
    );
    record.disposition = "active";
    fs.writeFileSync(
      path.join(paths.lease, "owner.json"),
      `${JSON.stringify(record, null, 2)}\n`,
      { mode: 0o600 },
    );
    lease.releaseMergeGuard(first.manifestPath, owner.token, "not-started");
    lease.release(first.manifestPath, owner.token, "test-complete");
  });
});
