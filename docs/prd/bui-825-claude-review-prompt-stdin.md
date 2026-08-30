# BUI-825: Stream Claude review prompts through stdin

## Problem

The Claude review companion expands the complete review prompt into one command
argument. Large exact diffs exceed the host argument-list limit before Claude
starts, so the configured fallback returns parser-inconclusive twice.

## Requirements

- Preserve the complete exact review envelope.
- Send the user prompt through standard input, not argv or environment data.
- Keep the existing process-group timeout and cancellation behavior.
- Keep system prompts, model routing, tool restrictions, schema output, and
  signed incomplete handling unchanged.

## Acceptance

- A regression proves the prompt reaches Claude through standard input and is
  absent from its arguments.
- The companion suite, command sync, lint, and security audit pass.
- PR 458 completes a real oversized fallback review without `Argument list too
long`.
