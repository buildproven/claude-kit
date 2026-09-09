# Recover dead manifest locks under the repository guard

Root cause: a killed manifest writer leaves its exclusive lock file behind.
The outer repository guard can recover, but the inner lock always requests
operator cleanup. This stops an otherwise recoverable merge campaign.

Decision: permit dead inner-lock recovery only while this process holds the
existing repository metadata guard for the exact manifest repository. Expose
guard ownership as an internal predicate and keep the existing exclusive-file
lock for compatibility with older writers. Non-merge writers without that
guard continue to refuse recovery; extending serialization is separate work.

Invariants:

- Require a regular lock file owned by the current user, an exact local
  hostname, a positive PID, and a valid acquisition timestamp.
- Reclaim only after the OS positively reports that PID does not exist.
  A live or reused PID is conservatively retained. Store process start
  identity for future evidence, but never interpret an unavailable lookup as
  a different process.
- Recheck the lock device, inode, and exact contents while holding the
  repository guard. Use exclusive create after unlink; a legacy writer that
  wins that create remains the owner.
- Retain all manifest evidence and budgets. Never reclaim by age.
- Active, malformed, foreign-host, or uncertain owners remain visible errors.

Alternatives: unconditional compare/unlink is unsafe with concurrent recovery;
replacing the locking protocol creates an unnecessary migration boundary;
manual cleanup retains the recurring interruption.

Migration and rollback: the on-disk lock format remains backward compatible.
The new optional owner metadata is additive. Reverting restores refusal to
recover, without changing manifest state or lease credentials.

Verification: kill a fixture child inside a manifest mutation and resume under
the repository guard; verify retained evidence. Cover active owner, remote
hostname, malformed owner, no guard, and concurrent recovery. Run the affected
quality invocation and lease suites.

Review: Codex power/high ADR review completed with no findings on 2026-09-09,
session `01a083a1-b5bc-7d01-9c65-6ad8ca7796b2`. Final revision-bound quality
review remains required before delivery.
