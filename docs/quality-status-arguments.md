# Quality status argument safety — BUI-844

## Requirements

`quality-status.sh` and `quality-load-root.sh` must reject a missing, empty,
or option-like `--manifest` value promptly with a nonzero exit and an
actionable error. They must accept both `--manifest <path>` and
`--manifest=<path>`. A relative path starting with `-` must use a `./` prefix.

A valid status or manifest-loading call must preserve exact manifest identity
validation and must not change the manifest. This change must not start a
campaign, alter approval rules, or bypass a quality or security gate.

The cause was a failed `shift 2` that left a lone `--manifest` argument in the
parser loop. Validate its value before advancing the parser. No new interface
or architecture is required.

## Implementation tasks

- [x] Reject malformed values in both CLI entrypoints before shifting.
- [x] Test missing, empty, and option-like values through bounded real CLI calls.
- [x] Test both valid forms with a real manifest and unchanged manifest bytes.
- [x] Map shell changes to behavioral tests and document the argument contract.

## Verification and admission

Focused proof: `npx vitest run scripts/__tests__/quality-status-cli.test.js
scripts/__tests__/quality-terminal-status.test.js`.

The governing PRD and task-list path for a future exact campaign is this file
(`--product-prd docs/quality-status-arguments.md --product-tasks
docs/quality-status-arguments.md`). Use the `local-product` delivery claim.

Local tests and green CI are implementation evidence, not protected product
receipts. Final admission requires the BUI-836 protected producer and admission
service to provide signed behavioral and acceptance evidence for the exact
HEAD and the digest of this file. The system trust key must be installed by
the trusted operator workflow. Do not create a candidate-controlled signer,
substitute a trust key, relabel this script fix as contract-only, or claim
independent review or merge before the required workflow completes.
