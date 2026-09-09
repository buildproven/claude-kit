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

- [x] 1.0 Reject malformed values in both CLI entrypoints before shifting.
  - Phase: implementation
  - Delivers: Prompt argument errors while valid status remains read-only.
  - Evidence: `scripts/__tests__/quality-status-cli.test.js` tests both invalid
    values and valid forms against a real manifest with unchanged bytes.
- [x] 2.0 Map shell changes to behavioral tests and document the contract.
  - Phase: implementation
  - Delivers: Deterministic test selection and actionable CLI instructions.
  - Evidence: `.buildproven/test-impact.json`, `commands/bs/help.md`, and
    `commands/bs/workflow.md`; focused and complete audits passed before this
    documentation-only follow-up.
- [ ] 3.0 Obtain protected exact-head product evidence and complete admission.
  - Phase: validation
  - Delivers: Authenticated acceptance through the existing quality workflow.
  - Evidence: BUI-836 protected behavioral and acceptance receipts, final
    independent review, and exact-head admission proof; not yet available.

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
