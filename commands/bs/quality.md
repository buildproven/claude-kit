---
name: bs:quality
description: Autonomous quality loop with configurable thoroughness. Runs checks, revision-bound review, remediation, CI, and optional merge.
argument-hint: "[--level auto|95|98] [--scope branch] [--merge] [--pr <number>] [--manifest <path>] [--target-dir <path>]"
tags: [quality, ci, review]
category: quality
---

Run bootstrap in this wrapper before forking:

```bash
BOOTSTRAP=""
for candidate in \
  "${CLAUDE_PLUGIN_ROOT:-}/scripts/quality-bootstrap.sh" \
  "${CLAUDE_KIT_ROOT:-}/scripts/quality-bootstrap.sh" \
  "$HOME/.claude/scripts/quality-bootstrap.sh" \
  "./scripts/quality-bootstrap.sh"; do
  [ -n "$candidate" ] && [ -f "$candidate" ] && {
    BOOTSTRAP="$candidate"
    break
  }
done
[ -n "$BOOTSTRAP" ] || {
  echo "quality-bootstrap.sh not found" >&2
  exit 1
}
WRAPPER="$(dirname "$BOOTSTRAP")/quality-wrapper.js"
[ -f "$WRAPPER" ] || {
  echo "quality-wrapper.js not found" >&2
  exit 1
}
node "$WRAPPER" "$BOOTSTRAP" <<'BS_QUALITY_REQUEST'
{"argv": ["<each invocation argument as one JSON string token>"]}
BS_QUALITY_REQUEST
```

Construct the JSON array directly from the parsed slash-command arguments; do
not interpolate the raw argument string into shell. JSON escaping preserves
spaces, quotes, and metacharacters as inert argument data.

Quality merges are autonomous by default, including critical-tier changes. Risk
changes the depth of review; it never creates a routine human approval step.
The run stops instead when its revision-bound evidence is unresolved: blocking
findings, malformed or inconclusive review output, stale identity, or failed
CI all remain hard merge blocks.

Repositories that explicitly set `scorePolicy.mergeAuthority` to
`"human-required"` retain the legacy signed break-glass capability. Only in
that opt-in mode is the supported outer command:

```text
/bs:quality approve --pr <number> --head <exact-40-character-sha>
```

The wrapper removes only the `approve` and `--head` control tokens before
bootstrap, verifies bootstrap resolved that exact PR and HEAD, then creates the
same signed, expiring capability used by the legacy outer
`BREAK_GLASS_APPROVED=true` channel. Nested/headless children cannot mint this
capability. The wrapper prints repository key, PR, HEAD, invocation, approver,
and expiry before the quality skill continues with the returned manifest.

Capture the exact `BS_QUALITY_MANIFEST=` path from bootstrap output. Invoke the
`quality` skill exactly once with only:

```text
--manifest <captured-exact-path>
```

Do not pass the original arguments into the fork, create an args tempfile,
duplicate argument channels, or re-enter this wrapper. Bootstrap enforces two
recursion guards: it refuses when `BS_QUALITY_HEADLESS=1` (a read-only review
child) and, once a campaign starts, exports `BS_QUALITY_ACTIVE=1` so any
descendant that tries to launch a _fresh_ campaign (no `--manifest`) is refused
— only a `--manifest` resume of the same campaign is allowed through. PR
selection is explicit: `--pr <number>`; ambiguous positional forms such as
`--merge 1` are invalid.

For a safe continuation, pass the exact manifest printed by the earlier run:

```text
/bs:quality --manifest /exact/path/to/invocation.json
```

There is deliberately no "latest invocation" lookup or session-state glob.
`BS_QUALITY_HEADLESS=1` remains the recursion guard for provider children.
