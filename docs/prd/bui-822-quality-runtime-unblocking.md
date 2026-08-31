# BUI-822: Quality runtime unblocking

## Problem

Claude Kit quality campaigns use a fallback campaign duration when the
repository does not declare its native test-gate duration. The full Claude Kit
test gate consumes most of that fallback. The campaign can then stop before
security, mutation, and independent review run.

Repository quality-control configuration is also classified as product code.
This classification requires unrelated product-delivery evidence for a change
that only adjusts the quality contract.

## User stories

- As a maintainer, I can run one bounded exact-head quality campaign through
  all required gates and review phases.
- As a maintainer, I can change repository quality-control configuration
  without making a false product-delivery claim.

## Requirements

- Claude Kit declares a 15-minute native test-gate timeout.
- The planner reserves that gate duration separately from review and
  verification time.
- `.buildproven/` files and `harness-config.json` are non-product quality
  controls.
- Unknown application configuration remains product-affecting and fails
  closed.

## Acceptance

- The planner regression test proves the funded campaign duration.
- Product classification tests prove both the narrow exemptions and the
  existing fail-closed behavior.
- The full repository test and security gates pass at the exact candidate head.
