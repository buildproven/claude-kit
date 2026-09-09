# Portable autonomous-loop usage checks

Install/update claude-kit using its normal installer on each computer. The
installer links `scripts/provider-usage-adapter.js` with the other runtime
scripts; no machine-specific absolute path is stored in the repository.

Install the CodexBar CLI on each computer and sign in to the selected coding
provider locally. CodexBar owns provider authentication and usage retrieval.
See <https://github.com/steipete/CodexBar> for installation and platform support.
Credentials and usage snapshots must never be copied between computers or
committed to this repository.

The long-lived loop launcher runs:

```bash
node "$HOME/.claude/scripts/autonomous-loop-runtime.js" admit \
  --kind ralph --id "$LOOP_ID" --provider codex --owner-pid "$$"
```

Use `--provider claude` when Claude will execute the work. Provider selection
is explicit; a Claude loop cannot use Codex capacity as evidence. Provider
fallback must be declared with `--fallback claude` or `--fallback codex`;
admission checks both providers before admitting a loop that can use either.
The overnight launcher resolves its configured provider automatically and uses
the same selection for admission and execution. Its Codex phase currently has
no fallback, so only Codex capacity is checked on that path.

The adapter queries CodexBar automatically, retains only provider and numeric
capacity windows, and rejects observations older than five minutes or more
than thirty seconds in the future. Missing CLI, authentication failures,
ambiguous accounts, and invalid observations stop admission with an actionable
error. No historical session scan or manually maintained JSON is required.
The existing utilization and concurrent-loop limits remain unchanged.

Legacy `--usage-command` integrations remain supported with the original
`fiveHourPercent` and `sevenDayPercent` numeric response contract.

Release the slot in the same live launcher process with `release --id
"$LOOP_ID" --owner-pid "$$"`. Tests use an isolated temporary state directory.

## Overnight progress and cancellation

During provider work, the launcher prints a sanitized heartbeat every 30 seconds
and atomically refreshes its status JSON with phase, elapsed time, and remaining
budget. `OVERNIGHT_LOOP_HEARTBEAT_SECONDS` accepts a positive integer override.
Two missed intervals mean stale progress, not completion. Raw provider output
stays in the private attempt log; it is not copied into the progress log.

Cancellation waits for bounded provider-group cleanup before releasing the
admission slot. If the launcher is killed with SIGKILL, the deadline helper
stops provider work, but the existing legacy lock remains fail-closed. Automatic
stale-lock recovery is not implemented; BUI-845 tracks the remaining design.
