# Quality Evidence Trust Boundary

`Reviewed-By` and `Quality-*` trailers are machine-parseable records of a
quality campaign; they are not cryptographic attestations. Any process that can
create a commit can type matching trailers, so a trailer alone must never be
treated as proof that an independent reviewer approved a change.

The quality runtime reduces accidental or negligent-agent failure by binding
trailers to an exact HEAD and merge base, requiring contiguous review coverage,
and checking manifest, CI, and provider artifacts before it authorizes a
merge. Those checks are meaningful for the kit's solo-operator threat model,
but they do not defend against a process that can deliberately forge commits
and alter local quality state.

Break-glass approval has a stronger boundary because it uses a wrapper-pinned,
signed capability. Review authorization does not currently use that mechanism.
If the threat model expands beyond negligent automation, add an operator-held
signature or HMAC verification for review authorization before describing it as
tamper-evident evidence.
