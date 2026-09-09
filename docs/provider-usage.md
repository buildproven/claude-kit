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
fallback requires a new admission check for the replacement provider.

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
