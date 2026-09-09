# Overnight ownership and live progress

Status: ownership redesign deferred, not approved or implemented. BUI-845 stays
open. The shipped slice only adds sanitized heartbeat and bounded provider
cleanup; it retains both existing lock mechanisms and their migration stops.
The proposal below records the unresolved design, not current runtime behavior.

## Decision

Use one existing autonomous-loop admission record for the launcher and its
active provider supervisor. Add an owner-authorized `attach-child` operation:
the deadline helper attaches its PID, process-start identity, and hostname
before spawning provider work. A record is active while either launcher or
supervisor is live. A replacement cannot run during surviving child cleanup.
Release refuses a live child. A new attachment refuses a live prior child.

Canonicalize target paths with realpath before deriving admission and status
identity. Retain the original spelling solely to check its legacy lock key.
Do not create new legacy overnight locks. Refuse existing legacy locks at both
original and canonical keys; unknown ownership never authorizes deletion.

Replace the runtime's mkdir mutex with a local OS advisory file lock held by a
small Python helper. Python is already required by the launcher. The helper
uses nonblocking flock with a fixed timeout, publishes private readiness only
after acquiring the lock, and monitors its Node parent's lifetime. Kernel
release on helper death and parent-death cleanup eliminate persistent crash
mutexes. The lock file is stable and never unlinked. Concurrent recoverers use
the same kernel lock, not another application recovery lock. Keep all state on
one machine's local filesystem, not a shared network home. A pre-existing old
`.admission.lock` remains a fail-closed migration error.

Run each provider through the existing process-group deadline helper. It
monitors parent death and forwards cancellation through nested deadline helpers.
On cancellation or parent death: terminate provider group, wait bounded grace,
escalate to SIGKILL for survivors, reap its child, then exit. The launcher's
signal handler waits for that cleanup before terminal status and admission
release. A launcher SIGKILL leaves its child attachment until cleanup finishes.

Emit a heartbeat every 30 seconds (positive integer override for operations and
tests). The closed phase vocabulary is starting, provider-running, verifying,
usage-wait, finished. Atomic status adds phase, providerStartedAtEpoch,
lastHeartbeatAtEpoch, elapsedSeconds, remainingSeconds; existing fields remain.
Two missed heartbeat intervals mark progress stale to consumers, never success.
Heartbeat text contains only phase and numeric elapsed/remaining/attempt values.
Write failure cancels and reaps work and yields a nonzero observability failure.
Route provider stdout/stderr only to a 0600 attempt artifact under a 0700 state
directory, never to the console or progress log. Apply a restrictive umask
before creating artifacts. The parent writes all status to avoid racing updates.

## Alternatives and invariants

Adding owner metadata to the second lock duplicates existing ownership policy.
Deleting unknown legacy locks risks concurrent work and is rejected. No usage,
review, deadline, or authority gate changes. Provider output remains private.

## Migration and rollback

New runs create no legacy lock. Upgrade requires old launcher/admission binaries
to be stopped before new launches; mixed-version starts are not supported.
An unknown old lock remains a migration stop until its owning process is proved
inactive. New child-bearing records use schema version 2. Old runtime code does
not understand child lifetimes, so rollback also requires all new runs stopped
and their records released first. No automatic deletion of unknown records.

## Verification

CLI regressions kill a launcher and immediately request admission: deny while
the old supervisor is active, then automatically admit after cleanup. Exclude
live duplicate aliases, retained unknown/foreign/PID-reused records, and legacy
locks. Kill mutex helper during a blocked usage request and restart without
manual cleanup; kernel lock behavior is independent of the record write point.
Observe sleeping-provider heartbeat and inject distinct stdout/stderr secret
canaries absent from console/status/progress logs. Verify descendant death on
TERM/KILL of launcher, terminal status ordering, and status-write failure.

Initial review identified the lifetime, mutex, alias, and schema gaps above;
this revision addresses each explicitly before implementation.

The second review rejected helper-owned flock: killing that helper could unlock
while Node still mutates state. A future revision must make the mutating process
own the kernel lock (for example Python acquires then execs Node with the same
inherited locked file descriptor). No further architecture review was started
in this bounded slice. Original CLI reproduction: SIGKILL after provider start
then immediate restart fails with the preserved ownerless legacy lock. This
remains a known stop, not successful recovery.
