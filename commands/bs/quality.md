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

Capture the exact `BS_QUALITY_MANIFEST=` path from bootstrap output. Invoke the
`quality` skill exactly once with only:

```text
--manifest <captured-exact-path>
```

Do not pass the original arguments into the fork, create an args tempfile,
duplicate argument channels, or re-enter this wrapper. Bootstrap preserves the
`BS_QUALITY_HEADLESS=1` recursion guard. PR selection is explicit:
`--pr <number>`; ambiguous positional forms such as `--merge 1` are invalid.

For a safe continuation, pass the exact manifest printed by the earlier run:

```text
/bs:quality --manifest /exact/path/to/invocation.json
```

There is deliberately no "latest invocation" lookup or session-state glob.
`BS_QUALITY_HEADLESS=1` remains the recursion guard for provider children.
