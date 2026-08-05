#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const SCHEMA_VERSION = 1;
const STALE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_WAIT_MS = 30_000;
const SLEEP_BUFFER = new SharedArrayBuffer(4);

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(SLEEP_BUFFER), 0, 0, milliseconds);
}

function accountHome() {
  const user = os.userInfo();
  if (
    !user ||
    user.uid !== process.geteuid?.() ||
    !path.isAbsolute(user.homedir)
  ) {
    throw new Error(
      "repository lease requires a canonical effective-UID account home",
    );
  }
  return fs.realpathSync(user.homedir);
}

function stateRoot() {
  const root = path.join(
    accountHome(),
    ".local",
    "state",
    "claude-kit",
    "repository-leases",
  );
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("repository lease state root must be a real directory");
  }
  if (stat.uid !== process.geteuid?.()) {
    throw new Error("repository lease state root has the wrong owner");
  }
  fs.chmodSync(root, 0o700);
  return fs.realpathSync(root);
}

function repositoryIdentity(manifest) {
  const identity = manifest.repo?.githubRepository;
  if (typeof identity !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(identity)) {
    throw new Error(
      "repository lease requires a protected GitHub repository identity",
    );
  }
  return identity.toLowerCase();
}

function isVitestFixture(manifest) {
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.VITEST !== "true" ||
    !process.env.VITEST_WORKER_ID ||
    !/^vitest\/[a-f0-9]{16,64}$/.test(repositoryIdentity(manifest))
  ) {
    return false;
  }
  const repositoryRoot = fs.realpathSync(manifest.repo.realpath);
  const temporaryRoot = `${fs.realpathSync(os.tmpdir())}${path.sep}`;
  if (!repositoryRoot.startsWith(temporaryRoot)) return false;
  const gitCommonDir = fs.realpathSync(
    path.resolve(
      repositoryRoot,
      execFileSync("git", ["rev-parse", "--git-common-dir"], {
        cwd: repositoryRoot,
        encoding: "utf8",
      }).trim(),
    ),
  );
  const sentinel = path.join(gitCommonDir, ".quality-vitest-fixture");
  try {
    return (
      readRegularFile(sentinel, "quality Vitest fixture sentinel").trim() ===
      manifest.repo.key
    );
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function repositoryKey(identity) {
  return crypto.createHash("sha256").update(identity).digest("hex");
}

function pathsFor(identity, manifest = null) {
  const root =
    manifest && isVitestFixture(manifest)
      ? path.join(
          fs.realpathSync(
            path.resolve(
              manifest.repo.realpath,
              execFileSync("git", ["rev-parse", "--git-common-dir"], {
                cwd: manifest.repo.realpath,
                encoding: "utf8",
              }).trim(),
            ),
          ),
          "quality-test-repository-leases",
        )
      : stateRoot();
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const key = repositoryKey(identity);
  return {
    root,
    key,
    lease: path.join(root, `${key}.lease`),
    metadataGuard: path.join(root, `${key}.metadata-guard`),
    mergeGuard: path.join(root, `${key}.merge-guard`),
  };
}

function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

function readRegularFile(file, label) {
  let descriptor;
  try {
    descriptor = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
  } catch (error) {
    if (error.code === "ELOOP") {
      throw new Error(`${label} must be a non-symlink regular file`, {
        cause: error,
      });
    }
    throw error;
  }
  try {
    if (!fs.fstatSync(descriptor).isFile()) {
      throw new Error(`${label} must be a regular file`);
    }
    return fs.readFileSync(descriptor, "utf8");
  } finally {
    fs.closeSync(descriptor);
  }
}

function readJson(file, label) {
  return parseJson(readRegularFile(file, label), label);
}

function atomicWrite(file, value) {
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
  let renamed = false;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    fs.renameSync(temporary, file);
    renamed = true;
    fs.chmodSync(file, 0o600);
  } finally {
    if (!renamed) removeAtomicTemporary(temporary);
  }
}

function removeAtomicTemporary(file) {
  if (!fs.existsSync(file)) return;
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("repository lease atomic-write temporary changed");
  }
  fs.unlinkSync(file);
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    return null;
  }
}

function processIdentity(pid) {
  if (!Number.isInteger(pid) || pid < 1) return null;
  const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
    encoding: "utf8",
    timeout: 5_000,
  });
  if (result.status !== 0) return null;
  const identity = result.stdout.trim();
  return identity || null;
}

function sameGuardOwner(current, observed) {
  return (
    current.pid === observed.pid &&
    current.uid === observed.uid &&
    current.nonce === observed.nonce &&
    current.acquiredAt === observed.acquiredAt
  );
}

function removeRecoveryLock(file) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("repository lease recovery lock changed");
  }
  fs.unlinkSync(file);
}

function recoverDeadGuard(directory, observed) {
  const recoveryLock = `${directory}.recovery-lock`;
  let descriptor;
  try {
    descriptor = fs.openSync(recoveryLock, "wx", 0o600);
    fs.writeFileSync(
      descriptor,
      `${JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        pid: process.pid,
        uid: process.geteuid?.(),
        nonce: crypto.randomBytes(16).toString("hex"),
      })}\n`,
    );
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (error.code === "EEXIST") return false;
    throw error;
  }
  fs.closeSync(descriptor);
  try {
    if (!fs.existsSync(directory)) return false;
    const current = guardOwner(directory);
    if (!sameGuardOwner(current, observed)) return false;
    const alive = processAlive(current.pid);
    if (alive !== false) {
      if (
        alive === true &&
        current.processIdentity &&
        processIdentity(current.pid) !== current.processIdentity
      ) {
        // The PID was reused by another process; it is not this guard owner.
      } else {
        return false;
      }
    }
    const released = tombstone(directory);
    exactCleanup(released);
    return true;
  } finally {
    removeRecoveryLock(recoveryLock);
  }
}

function exactCleanup(directory, recordName = "owner.json") {
  const record = path.join(directory, recordName);
  if (fs.existsSync(record)) {
    const stat = fs.lstatSync(record);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`refusing unsafe cleanup in ${directory}`);
    }
    fs.unlinkSync(record);
  }
  fs.rmdirSync(directory);
}

function tombstone(directory) {
  const renamed = `${directory}.released.${process.pid}.${crypto.randomBytes(6).toString("hex")}`;
  fs.renameSync(directory, renamed);
  return renamed;
}

function guardOwner(directory) {
  return readJson(
    path.join(directory, "owner.json"),
    "repository lease guard owner",
  );
}

function acquireGuard(directory, timeoutMs = DEFAULT_WAIT_MS, options = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.mkdirSync(directory, { mode: 0o700 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let owner;
      try {
        owner = guardOwner(directory);
      } catch (ownerError) {
        if (ownerError.code === "ENOENT" && Date.now() < deadline) {
          sleep(50);
          continue;
        }
        throw ownerError;
      }
      const alive = processAlive(owner.pid);
      const reused =
        alive === true &&
        owner.processIdentity &&
        processIdentity(owner.pid) !== owner.processIdentity;
      if ((alive === false || reused) && options.recoverDead !== false) {
        if (recoverDeadGuard(directory, owner)) continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `repository lease metadata is busy (pid ${owner.pid})`,
          {
            cause: error,
          },
        );
      }
      sleep(50);
      continue;
    }
    try {
      atomicWrite(path.join(directory, "owner.json"), {
        schemaVersion: SCHEMA_VERSION,
        pid: process.pid,
        uid: process.geteuid?.(),
        nonce: crypto.randomBytes(16).toString("hex"),
        processIdentity: processIdentity(process.pid),
        acquiredAt: new Date().toISOString(),
      });
      return;
    } catch (error) {
      exactCleanup(directory);
      throw error;
    }
  }
}

function releaseGuard(directory) {
  const owner = guardOwner(directory);
  if (owner.pid !== process.pid || owner.uid !== process.geteuid?.()) {
    throw new Error("repository lease guard owner changed");
  }
  const released = tombstone(directory);
  exactCleanup(released);
}

function withMetadataGuard(manifest, operation, timeoutMs) {
  const identity = repositoryIdentity(manifest);
  const paths = pathsFor(identity, manifest);
  acquireGuard(paths.metadataGuard, timeoutMs);
  try {
    return operation(paths, identity);
  } finally {
    releaseGuard(paths.metadataGuard);
  }
}

function loadManifest(manifestPath) {
  return require("./quality-invocation").loadManifest(manifestPath);
}

function ownerTuple(manifest, manifestPath) {
  return {
    repository: repositoryIdentity(manifest),
    invocationId: manifest.invocationId,
    manifestPath: fs.realpathSync(manifestPath),
    gitCommonDir: fs.realpathSync(
      path.resolve(
        manifest.repo.realpath,
        require("child_process")
          .execFileSync("git", ["rev-parse", "--git-common-dir"], {
            cwd: manifest.repo.realpath,
            encoding: "utf8",
          })
          .trim(),
      ),
    ),
    pr: manifest.repo.pr,
    headRef: manifest.repo.headRefName,
  };
}

function tupleMatches(record, tuple) {
  return [
    "repository",
    "invocationId",
    "manifestPath",
    "gitCommonDir",
    "pr",
    "headRef",
  ].every((key) => record[key] === tuple[key]);
}

function leaseRecord(leaseDirectory) {
  const record = readJson(
    path.join(leaseDirectory, "owner.json"),
    "repository lease owner",
  );
  if (record.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `unsupported repository lease schema ${record.schemaVersion}`,
    );
  }
  return record;
}

function setManifestCredentialRaw(manifestPath, credential) {
  const invocation = require("./quality-invocation");
  invocation.withManifestLockRaw(manifestPath, (manifest) => {
    manifest.merge ??= {};
    manifest.merge.repositoryLease = credential;
  });
}

function completePending(paths, identity, loaded, current) {
  const credential = loaded.manifest.merge?.repositoryLease;
  if (
    credential?.token !== current.token ||
    credential?.generation !== current.generation
  ) {
    setManifestCredentialRaw(loaded.manifestPath, {
      repository: identity,
      generation: current.generation,
      token: current.token,
    });
  }
  const active = {
    ...current,
    disposition: "active",
    priorToken: undefined,
  };
  atomicWrite(path.join(paths.lease, "owner.json"), active);
  return {
    token: active.token,
    generation: active.generation,
    identity,
  };
}

function acquireOnce(manifestPath, options = {}) {
  const loaded = loadManifest(manifestPath);
  if (loaded.manifest.options?.merge !== true) return null;
  const tuple = ownerTuple(loaded.manifest, loaded.manifestPath);
  return withMetadataGuard(
    loaded.manifest,
    (paths, identity) => {
      if (fs.existsSync(paths.lease)) {
        const current = leaseRecord(paths.lease);
        const credential = loaded.manifest.merge?.repositoryLease;
        if (
          current.disposition === "rotation-pending" &&
          current.priorToken == null &&
          tupleMatches(current, tuple)
        ) {
          return completePending(paths, identity, loaded, current);
        }
        if (
          current.disposition === "active" &&
          tupleMatches(current, tuple) &&
          credential?.token === current.token &&
          credential?.generation === current.generation
        ) {
          current.renewedAt = new Date().toISOString();
          atomicWrite(path.join(paths.lease, "owner.json"), current);
          return {
            token: current.token,
            generation: current.generation,
            identity,
          };
        }
        const error = new Error(
          `repository merge lease is owned by ${current.repository} PR #${current.pr} ` +
            `(${current.manifestPath}); recover or resume that exact campaign`,
        );
        error.code = "LEASE_OWNED";
        throw error;
      }

      fs.mkdirSync(paths.lease, { mode: 0o700 });
      const token = crypto.randomBytes(32).toString("hex");
      const now = new Date().toISOString();
      const pending = {
        schemaVersion: SCHEMA_VERSION,
        ...tuple,
        disposition: "rotation-pending",
        generation: 1,
        token,
        priorToken: null,
        acquiredAt: now,
        renewedAt: now,
      };
      atomicWrite(path.join(paths.lease, "owner.json"), pending);
      try {
        return completePending(paths, identity, loaded, pending);
      } catch (error) {
        throw new Error(
          `repository lease acquisition is pending repair: ${error.message}`,
          { cause: error },
        );
      }
    },
    options.timeoutMs,
  );
}

function acquire(manifestPath, options = {}) {
  const waitMs = options.waitMs ?? 30 * 60 * 1000;
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      return acquireOnce(manifestPath, options);
    } catch (error) {
      if (error.code !== "LEASE_OWNED" || Date.now() >= deadline) throw error;
      sleep(Math.min(500, Math.max(1, deadline - Date.now())));
    }
  }
}

function verifyUnderMetadata(manifestPath, presentedToken, options = {}) {
  if (!presentedToken)
    throw new Error("repository lease credential is required");
  const loaded = loadManifest(manifestPath);
  if (loaded.manifest.options?.merge !== true) return null;
  const tuple = ownerTuple(loaded.manifest, loaded.manifestPath);
  return withMetadataGuard(
    loaded.manifest,
    (paths) => {
      const record = leaseRecord(paths.lease);
      const credential = loaded.manifest.merge?.repositoryLease;
      if (
        record.disposition !== "active" ||
        !tupleMatches(record, tuple) ||
        record.token !== presentedToken ||
        credential?.token !== presentedToken ||
        credential?.generation !== record.generation
      ) {
        throw new Error(
          "repository merge lease credential is stale or does not own this campaign",
        );
      }
      if (options.renew !== false) {
        record.renewedAt = new Date().toISOString();
        atomicWrite(path.join(paths.lease, "owner.json"), record);
      }
      return record;
    },
    options.timeoutMs,
  );
}

function verify(manifestPath, presentedToken, options = {}) {
  return verifyUnderMetadata(manifestPath, presentedToken, options);
}

function recover(manifestPath, ownerToken) {
  const loaded = loadManifest(manifestPath);
  if (loaded.manifest.options?.merge !== true) {
    throw new Error("repository lease recovery requires a merge campaign");
  }
  const nextTuple = ownerTuple(loaded.manifest, loaded.manifestPath);
  return withMetadataGuard(loaded.manifest, (paths, identity) => {
    if (fs.existsSync(paths.mergeGuard)) {
      throw new Error(
        "ambiguous merge operation is quarantined; reconcile GitHub before recovery",
      );
    }
    const current = leaseRecord(paths.lease);
    if (current.disposition === "rotation-pending") {
      if (
        !tupleMatches(current, nextTuple) ||
        ![current.token, current.priorToken].includes(ownerToken)
      ) {
        throw new Error(
          "explicit recovery token does not match the pending rotation",
        );
      }
      return completePending(paths, identity, loaded, current);
    }
    if (current.token !== ownerToken) {
      throw new Error(
        "explicit recovery token does not match the current owner",
      );
    }
    const renewedAt = Date.parse(current.renewedAt || "");
    if (!Number.isFinite(renewedAt) || Date.now() - renewedAt < STALE_MS) {
      throw new Error("repository lease owner is recent; recovery is refused");
    }
    const token = crypto.randomBytes(32).toString("hex");
    const generation = current.generation + 1;
    const pending = {
      ...current,
      ...nextTuple,
      disposition: "rotation-pending",
      priorToken: current.token,
      token,
      generation,
      renewedAt: new Date().toISOString(),
    };
    atomicWrite(path.join(paths.lease, "owner.json"), pending);
    return completePending(paths, identity, loaded, pending);
  });
}

function withManifestMutation(manifestPath, presentedToken, mutation) {
  const loaded = loadManifest(manifestPath);
  if (loaded.manifest.options?.merge !== true) {
    return require("./quality-invocation").withManifestLockRaw(
      manifestPath,
      mutation,
    );
  }
  if (!presentedToken)
    throw new Error(
      "repository lease credential is required for manifest mutation",
    );
  const tuple = ownerTuple(loaded.manifest, loaded.manifestPath);
  return withMetadataGuard(loaded.manifest, (paths) => {
    const record = leaseRecord(paths.lease);
    if (
      record.disposition !== "active" ||
      !tupleMatches(record, tuple) ||
      record.token !== presentedToken
    ) {
      throw new Error(
        "repository merge lease credential is stale at manifest mutation",
      );
    }
    return require("./quality-invocation").withManifestLockRaw(
      manifestPath,
      (manifest) => {
        const credential = manifest.merge?.repositoryLease;
        if (
          credential?.token !== presentedToken ||
          credential?.generation !== record.generation
        ) {
          throw new Error("repository merge lease manifest credential changed");
        }
        const result = mutation(manifest);
        record.renewedAt = new Date().toISOString();
        atomicWrite(path.join(paths.lease, "owner.json"), record);
        return result;
      },
    );
  });
}

function release(manifestPath, presentedToken, reason = "completed") {
  const loaded = loadManifest(manifestPath);
  if (loaded.manifest.options?.merge !== true) return false;
  const tuple = ownerTuple(loaded.manifest, loaded.manifestPath);
  return withMetadataGuard(loaded.manifest, (paths) => {
    const record = leaseRecord(paths.lease);
    if (
      record.disposition !== "active" ||
      !tupleMatches(record, tuple) ||
      record.token !== presentedToken
    ) {
      throw new Error("only the exact repository lease owner may release it");
    }
    record.disposition = "released";
    record.releaseReason = reason;
    record.releasedAt = new Date().toISOString();
    atomicWrite(path.join(paths.lease, "owner.json"), record);
    const released = tombstone(paths.lease);
    exactCleanup(released);
    return true;
  });
}

function status(manifestPath) {
  const loaded = loadManifest(manifestPath);
  if (loaded.manifest.options?.merge !== true) return { required: false };
  return withMetadataGuard(loaded.manifest, (paths) => {
    if (!fs.existsSync(paths.lease))
      return { required: true, state: "missing" };
    const record = leaseRecord(paths.lease);
    const stale = Date.now() - Date.parse(record.renewedAt || "") >= STALE_MS;
    let mergeGuard = null;
    if (fs.existsSync(paths.mergeGuard)) {
      const guard = guardOwner(paths.mergeGuard);
      mergeGuard = {
        repository: guard.repository,
        pr: guard.pr,
        head: guard.head,
        base: guard.base,
        requestStartedAt: guard.requestStartedAt,
        admin: guard.admin === true,
        adminReason: guard.adminReason ?? null,
      };
    }
    return {
      required: true,
      state: record.disposition,
      repository: record.repository,
      pr: record.pr,
      headRef: record.headRef,
      manifestPath: record.manifestPath,
      renewedAt: record.renewedAt,
      generation: record.generation,
      owned: tupleMatches(
        record,
        ownerTuple(loaded.manifest, loaded.manifestPath),
      ),
      stale,
      mergeGuard,
      recoveryCommand: stale
        ? `node quality-repo-lease.js recover --manifest ${loaded.manifestPath} ` +
          `--confirm-owner-invocation-id ${record.invocationId} --confirm-owner-pr ${record.pr}`
        : null,
    };
  });
}

function liveBase(manifest) {
  const baseRef = manifest.revisions.baseRef;
  const branch = String(baseRef || "")
    .replace(/^refs\/heads\//, "")
    .replace(/^origin\//, "");
  if (!branch || branch.includes("..") || branch.startsWith("-")) {
    throw new Error(
      `repository lease cannot resolve protected base '${baseRef}'`,
    );
  }
  const output = execFileSync(
    "git",
    ["ls-remote", "origin", `refs/heads/${branch}`],
    {
      cwd: manifest.repo.realpath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
  const sha = output.split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/.test(sha || "")) {
    throw new Error(`repository lease could not refresh origin/${branch}`);
  }
  return sha;
}

function assertBase(manifestPath, presentedToken) {
  verify(manifestPath, presentedToken);
  const { manifest } = loadManifest(manifestPath);
  const live = liveBase(manifest);
  const bound =
    manifest.revisions.baseRebaseCarry?.baseSha ??
    manifest.revisions.baseHeadSha ??
    manifest.revisions.baseSha;
  if (live !== bound) {
    throw new Error(
      `protected base moved from ${bound} to ${live}; retain the lease, rebase onto ${live}, ` +
        `push, then resume this exact manifest`,
    );
  }
  return live;
}

function mergeHead(manifest) {
  return manifest.merge?.stampHead ?? manifest.revisions.currentHead;
}

function acquireMergeGuard(manifestPath, presentedToken, options = {}) {
  const loaded = loadManifest(manifestPath);
  const tuple = ownerTuple(loaded.manifest, loaded.manifestPath);
  return withMetadataGuard(loaded.manifest, (paths) => {
    const record = leaseRecord(paths.lease);
    const credential = loaded.manifest.merge?.repositoryLease;
    if (
      record.disposition !== "active" ||
      !tupleMatches(record, tuple) ||
      record.token !== presentedToken ||
      credential?.token !== presentedToken ||
      credential?.generation !== record.generation
    ) {
      throw new Error(
        "repository merge lease credential is stale before merge guard acquisition",
      );
    }
    acquireGuard(paths.mergeGuard, 1, { recoverDead: false });
    const ownerFile = path.join(paths.mergeGuard, "owner.json");
    atomicWrite(ownerFile, {
      ...guardOwner(paths.mergeGuard),
      repository: record.repository,
      pr: record.pr,
      head: mergeHead(loaded.manifest),
      base:
        loaded.manifest.revisions.baseRebaseCarry?.baseSha ??
        loaded.manifest.revisions.baseHeadSha,
      token: presentedToken,
      admin: options.admin === true,
      adminReason: options.admin === true ? "ci-billing-waiver" : null,
      requestStartedAt: null,
    });
    record.renewedAt = new Date().toISOString();
    atomicWrite(path.join(paths.lease, "owner.json"), record);
    return paths.mergeGuard;
  });
}

function releaseMergeGuard(manifestPath, presentedToken, outcome) {
  const loaded = loadManifest(manifestPath);
  return withMetadataGuard(loaded.manifest, (paths) => {
    const owner = guardOwner(paths.mergeGuard);
    if (
      owner.token !== presentedToken ||
      owner.repository !== repositoryIdentity(loaded.manifest) ||
      owner.pr !== loaded.manifest.repo.pr ||
      owner.head !== mergeHead(loaded.manifest)
    ) {
      throw new Error("merge operation guard owner changed");
    }
    if (!["merged", "closed-unmerged", "not-started"].includes(outcome)) {
      throw new Error("ambiguous merge operation remains quarantined");
    }
    const released = tombstone(paths.mergeGuard);
    exactCleanup(released);
  });
}

function remotePullRequest(manifest) {
  const view = spawnSync(
    "gh",
    [
      "pr",
      "view",
      String(manifest.repo.pr),
      "--repo",
      manifest.repo.githubRepository,
      "--json",
      "state,mergedAt,mergeCommit,headRefName,headRefOid",
    ],
    { cwd: manifest.repo.realpath, encoding: "utf8", timeout: 30_000 },
  );
  if (view.status !== 0) {
    throw new Error(
      `GitHub merge state could not be verified: ${view.stderr || "gh pr view failed"}`.trim(),
    );
  }
  try {
    return JSON.parse(view.stdout);
  } catch (error) {
    throw new Error("GitHub merge state was not valid JSON", { cause: error });
  }
}

function exactRemoteOutcome(manifest, remote) {
  if (!remote || typeof remote !== "object") return null;
  const exactHead =
    remote.headRefName === manifest.repo.headRefName &&
    remote.headRefOid === mergeHead(manifest);
  if (
    exactHead &&
    remote.state === "MERGED" &&
    Boolean(remote.mergedAt) &&
    Boolean(remote.mergeCommit?.oid)
  ) {
    return "merged";
  }
  if (
    exactHead &&
    remote.state === "CLOSED" &&
    !remote.mergedAt &&
    !remote.mergeCommit?.oid
  ) {
    return "closed-unmerged";
  }
  return null;
}

function reconcileMergeOutcome(manifestPath, presentedToken, options = {}) {
  verify(manifestPath, presentedToken, { renew: false });
  const { manifest } = loadManifest(manifestPath);
  const remote = remotePullRequest(manifest);
  const outcome = exactRemoteOutcome(manifest, remote);
  if (!outcome || (options.mergedOnly && outcome !== "merged")) {
    return { reconciled: false, outcome: null, remote };
  }
  withMetadataGuard(manifest, (paths) => {
    if (!fs.existsSync(paths.mergeGuard)) return;
    const owner = guardOwner(paths.mergeGuard);
    if (
      owner.token !== presentedToken ||
      owner.repository !== repositoryIdentity(manifest) ||
      owner.pr !== manifest.repo.pr ||
      owner.head !== mergeHead(manifest)
    ) {
      throw new Error(
        "merge operation guard does not match this exact campaign",
      );
    }
    const released = tombstone(paths.mergeGuard);
    exactCleanup(released);
  });
  release(manifestPath, presentedToken, `verified-remote-${outcome}`);
  return { reconciled: true, outcome, remote };
}

function performMerge(manifestPath, presentedToken, options = {}) {
  verify(manifestPath, presentedToken);
  const loaded = loadManifest(manifestPath);
  const { manifest } = loaded;
  const repository = repositoryIdentity(manifest);
  const expectedRepository = manifest.repo.githubRepository;
  const pr = String(manifest.repo.pr);
  const head = mergeHead(manifest);
  acquireMergeGuard(manifestPath, presentedToken, options);
  try {
    assertBase(manifestPath, presentedToken);
  } catch (error) {
    try {
      releaseMergeGuard(manifestPath, presentedToken, "not-started");
    } catch (releaseError) {
      throw new AggregateError(
        [error, releaseError],
        `${error.message}; merge guard cleanup also failed: ${releaseError.message}`,
        { cause: releaseError },
      );
    }
    throw error;
  }
  const paths = pathsFor(repository, manifest);
  const ownerFile = path.join(paths.mergeGuard, "owner.json");
  const guarded = guardOwner(paths.mergeGuard);
  guarded.requestStartedAt = new Date().toISOString();
  atomicWrite(ownerFile, guarded);
  const args = [
    "pr",
    "merge",
    pr,
    "--repo",
    expectedRepository,
    "--squash",
    "--match-head-commit",
    head,
  ];
  if (options.admin) args.push("--admin");
  const merge = spawnSync("gh", args, {
    cwd: manifest.repo.realpath,
    encoding: "utf8",
    timeout: 120_000,
  });
  let remote = null;
  let remoteReadError = null;
  try {
    remote = remotePullRequest(manifest);
  } catch (error) {
    remoteReadError = error;
    // A failed/timeout client can have submitted an accepted request. The
    // operation remains quarantined when authoritative read-back also fails.
  }
  if (exactRemoteOutcome(manifest, remote) === "merged") {
    releaseMergeGuard(manifestPath, presentedToken, "merged");
    return { merged: true, remote };
  }
  // A failed/timeout client can have submitted an accepted request. Preserve
  // the operation guard until GitHub proves merge or the operator closes the PR.
  throw new Error(
    `merge outcome is ambiguous and quarantined (gh status ${merge.status ?? "timeout"}): ` +
      `${merge.stderr || remoteReadError?.message || `GitHub returned ${JSON.stringify(remote)}`}`.trim() +
      `; after verifying GitHub, run BS_QUALITY_REPOSITORY_LEASE_TOKEN=<pinned-token> ` +
      `node quality-repo-lease.js reconcile-merge --manifest ${loaded.manifestPath}`,
  );
}

function releaseIfMerged(manifestPath, presentedToken) {
  const { manifest } = loadManifest(manifestPath);
  if (manifest.options?.merge !== true) return false;
  return reconcileMergeOutcome(manifestPath, presentedToken, {
    mergedOnly: true,
  }).reconciled;
}

function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) options._.push(argv[index]);
    else options[argv[index].slice(2)] = argv[++index];
  }
  return options;
}

function publicCredential(credential) {
  if (!credential) return credential;
  return {
    identity: credential.identity,
    generation: credential.generation,
  };
}

function presentedToken() {
  return process.env.BS_QUALITY_REPOSITORY_LEASE_TOKEN;
}

function recoverFromOptions(manifest, options) {
  const loaded = loadManifest(manifest);
  const paths = pathsFor(repositoryIdentity(loaded.manifest), loaded.manifest);
  const record = leaseRecord(paths.lease);
  if (
    options["confirm-owner-invocation-id"] !== record.invocationId ||
    String(options["confirm-owner-pr"] || "") !== String(record.pr)
  ) {
    throw new Error(
      "recovery requires the exact current owner invocation ID and pull request",
    );
  }
  return recover(manifest, record.token);
}

function commandHandlers(manifest, options) {
  return {
    acquire: () => publicCredential(acquire(manifest)),
    verify() {
      verify(manifest, presentedToken());
    },
    release: () => release(manifest, presentedToken(), options.reason),
    status: () => status(manifest),
    "merge-guard-acquire": () => acquireMergeGuard(manifest, presentedToken()),
    "merge-guard-release": () =>
      releaseMergeGuard(manifest, presentedToken(), options.outcome),
    "assert-base": () => assertBase(manifest, presentedToken()),
    merge: () =>
      performMerge(manifest, presentedToken(), {
        admin: options.admin === "true",
      }),
    "release-if-merged": () => releaseIfMerged(manifest, presentedToken()),
    "reconcile-merge": () => reconcileMergeOutcome(manifest, presentedToken()),
    recover: () => publicCredential(recoverFromOptions(manifest, options)),
  };
}

function main() {
  const [command, ...raw] = process.argv.slice(2);
  const options = parseArgs(raw);
  const manifest = options.manifest || options._[0];
  if (!manifest) throw new Error(`${command || "command"} requires --manifest`);
  const handler = commandHandlers(manifest, options)[command];
  if (!handler)
    throw new Error(`unknown repository lease command '${command}'`);
  const result = handler();
  if (result !== undefined) process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`quality repository lease: ${error.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  STALE_MS,
  accountHome,
  acquire,
  acquireMergeGuard,
  assertBase,
  performMerge,
  reconcileMergeOutcome,
  releaseIfMerged,
  release,
  releaseMergeGuard,
  isVitestFixture,
  repositoryIdentity,
  recover,
  stateRoot,
  status,
  verify,
  withManifestMutation,
  withMetadataGuard,
  _acquireGuard: acquireGuard,
  _recoverDeadGuard: recoverDeadGuard,
  _pathsFor: pathsFor,
};
