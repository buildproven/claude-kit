# ADR: Repository-scoped quality merge lease

## Status

Accepted for BUI-572 after an independent high-reasoning architecture review
found no unresolved correctness defect.

## Context

BuildProven protects `main` with strict required status checks. That is the
correct safety boundary: a pull request may merge only after its exact head is
tested against the current protected base. GitHub's native merge queue is not
available for this private repository on its current organization plan, and
dropping strict freshness would restore stale-base merge risk.

The quality runtime currently owns only a branch worktree lock. Two campaigns
for different branches in the same repository can therefore run concurrently,
both pass against one base, and race to merge. The first merge advances `main`;
the loser becomes behind and must rebase and repeat CI. A fast fleet can make
the same campaign lose repeatedly.

The scarce resource is not repository-wide testing. Independent branches may
run local checks and review concurrently. The scarce resource is a stable
protected base from the moment a merge campaign binds its evidence until that
campaign merges or terminates.

## Decision

Add a repository-scoped merge lease to the public quality runtime.

1. Every fresh `--merge` campaign creates its immutable invocation manifest,
   then acquires the lease before any deterministic gate or provider call.
   Review-only campaigns do not acquire it.
2. The lease is keyed by normalized protected GitHub repository identity, not a
   checkout path. Independent clones and linked worktrees on the same operator
   host therefore serialize, while unrelated remote repositories remain
   parallel. The Git common directory remains owner-validation metadata only.
3. Acquisition is atomic and bounded. A contender waits for the current owner
   to merge or reach an explicit terminal state. Timeout reports the exact
   owner, pull request, branch, manifest, and recovery command; it never steals
   a live lease or weakens freshness.
4. Immediately after acquisition, fresh bootstrap refreshes the protected base. If
   it differs from the manifest's bound base, bootstrap stops before running
   tests and retains the lease. The owner rebases onto that exact base, pushes,
   and resumes the same manifest. Resume first captures the live protected base
   while the lease is held, then runs the existing `advance` transition so its
   exact replay proof can persist `baseRebaseCarry` and update `baseHeadSha`, and
   only then compares that updated anchor with the captured base. A mismatch at
   that point stops again. This ordering binds the new head/base without granting
   a fresh provider or gate budget. Because the campaign still owns the lease,
   no other quality merge can move the base during revalidation.
5. Manifest resume reacquires idempotently only when the complete owner tuple
   matches: normalized repository identity, invocation ID, canonical manifest
   path, canonical Git common directory, and manifest fencing token. An equal
   deterministic invocation ID from another clone is a collision, not the
   owner. Resume renews the lease and follows the ordered transition above.
6. Acquisition creates a random fencing token and persists the same token in
   the lease record and invocation manifest. Bootstrap/resume, every long gate,
   mutation check, provider review, CI wait, stamp publication, and final merge
   authorization receive that token as an immutable per-process credential and
   validate the presented value before and after their phase. A phase never
   reloads its credential from the mutable manifest; a suspended old process
   therefore continues presenting the old value after recovery rotates shared
   state and is fenced. Every manifest mutation for a merge campaign—including
   governor accounting, evidence publication, terminal-state recording, and
   lease resumability/disposition—first acquires the repository metadata guard,
   then the manifest mutation lock, and validates that pinned credential while
   holding both immediately before its atomic write.
   Phase entry/exit checks supplement this mutation boundary; they do not
   replace it. The remote
   merge is additionally enclosed by a repository-scoped operation guard. The
   owner acquires that guard atomically with its final token validation, then
   revalidates the live base while holding it, performs the synchronous GitHub
   merge, and releases the guard only after authoritative read-back. Recovery
   checks for the same guard while holding the metadata guard, so token rotation
   and entry into the merge critical section have one linearized order. No local
   token check is mistaken for server fencing.
7. Lease lifecycle is explicit and separate from the manifest's write-once
   `terminalState`. The lease record has `active`, `rotation-pending`, and
   `released` dispositions. An observed and verified remote PR merge releases
   an exact active lease even if an earlier diagnostic terminal state remains
   `blocked`; that historical outcome is never relabelled. Explicitly
   non-reenterable outcomes and `verified-unmerged` also release. A blocked,
   interrupted, or budget-exhausted campaign retains the lease only when the
   runtime's existing resume preflight proves the manifest can still execute;
   otherwise it is marked non-resumable and released. Release decisions never
   infer success merely from a terminal label.
8. Crash recovery is conservative. Lease state lives outside versioned files
   in one fixed per-operator namespace derived from the operating-system account
   record for the effective UID (Node `os.userInfo()`, not `HOME`,
   `XDG_STATE_HOME`, or another caller environment variable), plus
   `.local/state/claude-kit/repository-leases`. `TMPDIR`, checkout location, and
   caller environment cannot select another production namespace; canonical account home,
   owner UID, and directory modes are validated before use. A different invocation may
   reclaim automatically only from a final owner manifest. A six-hour-old
   resumable owner is reported as stale but requires an explicit recovery
   command explicitly confirming the current owner; credentials are never
   printed in status or command output. The lease record is authoritative
   and token acquisition/rotation uses a recoverable state machine: create the
   record as `rotation-pending` with old/new token metadata, persist the new
   token and generation to the exact manifest under its lock, then atomically
   publish the record as `active`. Verification denies all work while a record
   is pending. The exact owner may reconcile a pending initial acquisition;
   explicit recovery may reconcile a pending rotation after proving the
   manifest contains either its recorded old or new generation. Automated tests
   may use a repository-local namespace only when the manifest has a reserved
   `vitest/<hash>` repository identity, the checkout is below the temporary
   directory, and a non-symlink sentinel binds that checkout to the manifest's
   repository key. Ambient test variables alone cannot redirect a real
   repository lease. Any other
   combination fails closed with a repair command. Recovery checks and rotates
   under the metadata guard, which fences any suspended old process that has
   not entered the merge critical section. An unsafe, malformed,
   symlinked, cross-repository, or recent owner fails closed.

## Lease record

The atomic lock directory contains one non-symlink JSON owner record:

- schema version;
- invocation ID and exact manifest path;
- normalized protected GitHub repository identity and canonical Git common
  directory;
- repository, pull request, and head branch;
- acquisition timestamp, authenticated `renewedAt`, monotonically increasing
  token generation, random fencing token, lifecycle disposition, and pending
  rotation metadata when applicable.

Every successful owner verification renews `renewedAt` with an atomic rewrite
of the authoritative lease record. Staleness is measured from `renewedAt`, not
initial acquisition, so a live campaign older than six hours is not reclaimable.
The manifest copy is a fenced credential, not the source of ownership truth.

Acquisition, renewal, rotation, reconciliation, and release all execute under
one short repository-scoped metadata guard. That guard is the linearization
point for reading and replacing lease generations; no code may write a lease
record outside it. Its crash recovery may reclaim only a guard whose recorded
process identity is provably absent, because metadata critical sections perform
no external side effect. This prevents a stale renewal from overwriting a newer
recovery generation. The mandatory global order for any path needing both
locks is metadata guard first, manifest lock second; no manifest-locked path may
attempt to acquire the metadata guard.

Release compares all identity fields, then atomically renames the validated
lease directory to a unique tombstone outside the acquisition namespace. A
new owner may acquire immediately after that rename. Cleanup unlinks the exact
non-symlink owner record and removes the exact empty tombstone directory. A
crash before the rename leaves the original recoverable lease intact; a crash
after it can leave only an inert tombstone that cannot block acquisition. It
never recursively deletes a path or follows a symlink.

The merge operation guard uses the same defensive record rules and atomic
directory acquisition. Its record includes the holding process, exact PR, head,
base, and request start. A contender or recovery command never steals the guard.
Parent death alone is insufficient: ambiguous recovery reconciles the exact
PR/head and protected-base state. A deadline, safety margin, or stable negative
observation is never treated as proof that an accepted request cannot complete. The
guard is released only after GitHub exposes an authoritative terminal fact:
either the exact head is merged, or the PR is closed without merge by the
operator recovery flow, which server-side prevents that request from later
merging. Any open-PR ambiguity, inconsistent, changing, or unavailable remote
state remains quarantined and blocks repository merges for operator resolution.
Status names the quarantined exact head and whether the remote request began;
the merge failure prints the explicit authoritative-reconciliation command.
Missing, malformed, symlinked, or unverifiable identity
also fails closed. This conservative recovery applies only to the short merge
critical section, not to the campaign lease or its six-hour policy.

## Invariants

- Strict branch protection, required CI, exact-head review, mutation evidence,
  signed trailers, and live-base authorization remain unchanged.
- At most one active merge campaign on the operator host owns a lease for a
  protected GitHub repository. A local lease cannot coordinate another host;
  cross-host enforcement still requires GitHub native merge queue.
- Different repositories and review-only campaigns remain parallel.
- Waiting does not create a new quality invocation or replenish execution
  budgets.
- A base change is detected before expensive gates and becomes a visible
  rebase-and-resume requirement, never an implicit merge or silent retry.
- A failed or crashed owner cannot be guessed dead while its manifest is recent,
  and an explicitly reclaimed owner cannot pass the next fencing check.
- Direct or break-glass merges outside quality remain visible policy violations;
  the lease does not pretend it can serialize actors that bypass the workflow.

## Verification

- Concurrent acquisition tests prove exactly one owner and bounded waiting.
- Same-invocation acquisition is idempotent; a different invocation cannot
  release it.
- An independent clone with the same deterministic invocation ID but a
  different manifest/common-directory tuple is rejected as a collision.
- Six-hour-stale resumable owners require explicit confirmation of the recorded
  invocation ID and pull request before recovery reads and rotates its internal
  credential;
  recent, malformed, symlinked, missing, and cross-repository owners fail
  closed.
- Fresh bootstrap and manifest resume both acquire the lease for `--merge` and
  skip it for review-only work.
- A base movement after manifest creation stops before gates, retains ownership,
  and prints the exact rebase/resume recovery path. The integration test then
  rebases, resumes, persists rebase carry before comparing the captured base,
  and proceeds without a second deadlock.
- Final terminal-state and successful-merge paths release the exact lease even
  when ordinary worktree cleanup cannot complete because the primary checkout
  is dirty; resumable terminal states retain it.
- Reclamation changes the fencing token, and stale owners fail validation after
  gates, review, CI, stamp publication, and immediately before merge.
- Phase tests suspend a process, rotate the shared token, and prove its pinned
  old credential fails even though the manifest now contains the new token.
- Recovery and merge-guard acquisition share the metadata linearization point;
  tests prove a rotated token cannot enter the remote merge.
- Release disappears from the acquisition namespace in one rename. Fault
  injection before and after that rename proves neither state creates an
  ownerless blocking lease.
- Pending initial acquisition and recovery rotation reconcile only for the
  exact owner tuple; contenders remain fenced and no pending generation is
  accepted by verification.
- A campaign older than six hours that continues successful fenced phase checks
  renews `renewedAt` and remains unrecoverable. Exhausted-timeout and
  blocked-resume-then-merge paths verify explicit lease disposition without
  rewriting the first terminal cause.
- Concurrent renewal/rotation tests prove the metadata guard prevents an old
  generation from being republished. Different `TMPDIR` values still contend
  in the same fixed operator namespace.
- Opposing manifest-mutation and recovery processes acquire metadata then
  manifest locks and complete without deadlock; a lock-order tripwire rejects
  any reverse-order caller.
- Merge-guard crash tests leave the guard quarantined until the entire process
  group is absent and GitHub proves the exact head merged or the operator closes
  the PR without merge. Time and negative observations alone never admit
  another campaign.
- Full repository verification, mutation evidence, protected CI, and
  exact-head review pass before release.

## Consequences

A repository with many merge-ready pull requests intentionally trades some
parallel campaign latency for bounded progress and eliminates repeated full-CI
losses. A campaign that becomes stale while holding the lease pauses that
repository's quality merges until the six-hour threshold and explicit fenced
recovery; status output names the owner and recovery path, and unrelated
repositories continue normally.

If GitHub native merge queue becomes available, it should replace this lease.
The queue can serialize speculative merge commits server-side and also covers
actors that do not share one local quality runtime.
