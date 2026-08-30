# BUI-824: Provider input-limit fallback

## Problem

The review runtime classifies a deterministic Codex input-size rejection as a
generic provider error. It retries the same impossible input and does not use
the configured fallback.

## User stories

- As a maintainer, I can complete an exact-diff review when the primary
  provider has a smaller input limit than the fallback provider.
- As a maintainer, I can see signed incomplete evidence if neither provider can
  complete the review.

## Requirements

- Match only the typed Codex `input_too_large` turn-start failure with
  consistent maximum and actual character counts.
- Preserve the complete exact review envelope.
- Try the configured fallback at most once.
- Do not retry the same oversized input when no fallback is available.
- Keep incomplete fallback outcomes fail-closed.
- Do not convert unavailable review-check publication plus pending exact-head
  CI into an immutable terminal failure. Wait for CI, then sign local review
  evidence only after CI is green.

## Acceptance

- The observed 1,310,705-character failure is classified with its 1,048,576
  character limit.
- Partial or inconsistent error text is not classified.
- Provider runtime and merge-policy regression suites pass.
- A pending-CI regression proves that unavailable check publication defers
  local evidence until after the bounded CI wait.
