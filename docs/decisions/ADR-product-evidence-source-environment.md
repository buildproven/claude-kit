# ADR: Product evidence source environment

**Status:** Accepted

## Decision

The protected Product Evidence Source worker runs on the fixed Ubuntu 24.04
runner and installs the exact Ubuntu `zsh` and `zsh-common` package version
`5.9-6ubuntu2` before running the candidate suite. The claude-kit regression
tests include shell-parent checks; the normal Quality workflow already
provisions `zsh`, so the evidence worker must use the same test environment.
Installation has bounded network and package-manager timeouts, and the
installed version is recorded in the diagnostic artifact. The artifact action
is referenced by its immutable commit SHA. Failed behavioral or acceptance
commands remain blocking, and their logs are uploaded for diagnosis.

## Verification

The workflow is validated by the repository's workflow contract tests and by a
manual complete regression run on the candidate head.
