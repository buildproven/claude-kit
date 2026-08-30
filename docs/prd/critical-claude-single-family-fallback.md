# Critical Claude Single-Family Fallback

## Problem

Critical fallback selects two review roles. Both roles inherit the configured
Claude model after automatic Opus routing was removed. The manifest still
requires two model families, so it discards a complete role-bound panel and
terminal-blocks the campaign.

## Requirements

1. Every selected critical Claude role must return usable structured evidence.
2. One configured model family must not invalidate complete role coverage.
3. Evidence must retain role, provider, and effective model identity without
   claiming model-family independence.
4. Missing selected-role evidence must remain fail-closed.

## Acceptance

A critical two-role Claude fallback using Sonnet for both roles records a
complete review. Existing quorum, identity, and malformed-evidence checks remain
active.
