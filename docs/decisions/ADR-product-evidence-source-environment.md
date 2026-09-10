# ADR: Product evidence source environment

**Status:** Accepted

## Decision

The protected Product Evidence Source worker runs on the fixed Ubuntu 24.04
runner and provisions `zsh` with the same bounded package flow as the normal
Quality workflow before running the candidate suite. The exact package version
is recorded as environment provenance; the workflow does not depend on a
mutable historical apt version remaining available. Checkout runs before this
setup, and the provenance artifact is uploaded before candidate code runs, so
checkout cleanup and candidate writes cannot alter the trusted record. The
artifact action is referenced by its immutable commit SHA. Failed behavioral
or acceptance commands remain blocking, and their logs are uploaded for
diagnosis.

## Verification

The workflow is validated by the repository's workflow contract tests and by a
manual complete regression run on the candidate head.
