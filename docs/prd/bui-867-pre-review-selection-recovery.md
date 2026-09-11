# BUI-867: Pre-review selection recovery

## Problem

A repaired review-panel selector cannot resume a campaign when its earlier
nonzero exit was saved as a generic blocked terminal.

## Requirements

- Save a typed `pre-review-selection-failed` terminal only for a nonzero panel
  selector exit before any gate or provider execution.
- Reopen once only when the exact selector source cohort changed and all
  identity, lease, terminal epoch, policy, non-selector runtime, budget, and
  execution evidence remain unchanged.
- Keep previous invocation identity, risk, gates, review policy, provider
  ledger, budgets, and evidence. Do not rescore or create a new campaign.

## Acceptance

- An unchanged selector, a changed non-selector cohort, a used budget, a gate,
  a review, an active execution, or a prior selection recovery stays blocked.
- The recovery archive records old and new selector digests and increments the
  terminal epoch under the existing manifest lease.
