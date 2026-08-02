---
name: bs:quality
description: Autonomous quality loop with configurable thoroughness. Runs checks, revision-bound review, remediation, CI, and optional merge.
argument-hint: "[status --manifest <path>] [--level auto|95|98] [--scope branch] [--review-arm native|bespoke] [--verify-app] [--merge] [--pr <number>] [--manifest <path>] [--target-dir <path>]"
tags: [quality, ci, review]
category: quality
---

For on-demand status of an in-flight or stalled campaign, the supported
command is:

```text
/bs:quality status --manifest <exact-manifest-path>
```

This does NOT fork the quality skill or start/resume a campaign — it is a
direct, read-only diagnosis print. Resolve and run it exactly like this:

```bash
STATUS_SCRIPT=""
for candidate in \
  "${CLAUDE_PLUGIN_ROOT:-}/scripts/quality-status.sh" \
  "${CLAUDE_KIT_ROOT:-}/scripts/quality-status.sh" \
  "$HOME/.claude/scripts/quality-status.sh" \
  "./scripts/quality-status.sh"; do
  [ -n "$candidate" ] && [ -f "$candidate" ] && { STATUS_SCRIPT="$candidate"; break; }
done
[ -n "$STATUS_SCRIPT" ] || { echo "quality-status.sh not found" >&2; exit 1; }
bash "$STATUS_SCRIPT" --manifest "<exact-manifest-path-from-the-command-arguments>"
```

There is deliberately no PR-number or session lookup for `status` — the
caller must supply the exact manifest path, same as every other resume path
in this skill (printed as `BS_QUALITY_MANIFEST=` by an earlier
bootstrap/resume). If `--manifest` is missing from the command arguments,
report that to the user rather than guessing.

For every other invocation, run bootstrap in this wrapper before forking:

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

`--review-arm native|bespoke` is the bounded Wave 3 experiment control.
`native` assigns Codex's provider-native structured review with Claude fallback;
`bespoke` assigns the Claude companion panel with Codex fallback. The assigned
arm and actual reviewer are recorded separately, so a fallback stays visible
without relabeling the experiment treatment. Without this flag, ordinary
provider policy remains unchanged and telemetry infers the received arm from
the actual reviewer.

`--verify-app` (BUI-306) is opt-in only — never enabled by default. Every
other gate (lint/type/build/test/security) proves the code compiles and its
unit tests pass; none of them boot the app. This flag adds a `verify-app`
required gate that actually boots it: it detects the project's runtime shape
(web / server / CLI / library) from `package.json`, boots the dev server or
binary within a bounded timeout, and for a web project drives a real headless
browser (`agent-browser`) to load the root page and assert zero JavaScript
errors and zero `console.error` output. A library with no runnable
entrypoint records a clean pass with a "not applicable" note rather than
failing or being silently skipped. Boot cost and environmental flakiness are
real (cold caches, port contention, a slow-starting dev server), which is why
this stays opt-in rather than a default gate — use it on PRs that touch
runtime-affecting code (bootstrap, routing, top-level providers) where
"compiles and unit-tests pass" is not enough evidence that the app still
starts. A repo can declare 1-2 richer critical flows in
`.quality-app-flows.json` (see `scripts/quality-verify-app.sh`); the
zero-config baseline requires no repo opt-in beyond this flag.

Repositories that explicitly set `scorePolicy.mergeAuthority` to
`"human-required"` retain the legacy signed break-glass capability. The
ordinary exact-identity approval command is:

```text
/bs:quality approve --pr <number> --head <exact-40-character-sha>
```

The wrapper removes only the `approve` and `--head` control tokens before
bootstrap, verifies bootstrap resolved that exact PR and HEAD, then creates the
same signed, expiring capability used by the legacy outer
`BREAK_GLASS_APPROVED=true` channel. Nested/headless children cannot mint this
capability. The wrapper prints repository key, PR, HEAD, invocation, approver,
and expiry before the quality skill continues with the returned manifest.

When the operator explicitly accepts unresolved provider-review or mutation
evidence, use the separately-scoped override command:

```text
/bs:quality approve --override-quality --pr <number> --head <exact-40-character-sha>
```

This is never automatic. It creates a signed, expiring capability bound to the
repository, PR, HEAD, invocation, and approver, and leaves deterministic local
gates, exact-HEAD CI, protected-base freshness, and the merge audit trail
mandatory. The resulting stamp carries `Quality-Override: operator-quality-override`;
it does not fabricate an AI approval or hide that the operator accepted the
remaining review risk.

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
