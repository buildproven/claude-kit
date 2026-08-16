---
name: cross-review
description: Request an independent review from the other provider (Claude from Codex, or Codex from Claude) so the reviewer is a different model than the author
---

# Cross-Provider Review

Get a second opinion on a change from a **different model than the one that wrote
it**. This exists so heterogeneous review holds in both directions: `/bs:quality`
already spawns Codex when Claude drives, but a Codex session had no way to reach
Claude. Without it, Codex-authored work is reviewed by Codex — the reviewer and the
author are the same model, and agreement means nothing.

**Usage**: `/bs:cross-review [--base <ref>] [--provider claude|codex|auto] [--timeout <seconds>]`

## When to use this

- You are in a Codex session and want a Claude review before merging.
- You are in a Claude session and want a Codex review outside a full `/bs:quality` run.
- A review came back clean and you want to know whether that survives a different model.

This is an **advisory** review. It does not stamp a `Reviewed-By:` trailer and does
not satisfy the merge gate — `/bs:quality` remains the only path that produces merge
evidence. Say so when reporting results; do not imply a change is cleared to merge.

## How it runs

Everything routes through the existing provider runner. Do not shell out to `claude`
or `codex` directly — `provider-run.sh` already handles the deadline, sandboxing,
structured error classification, exhaustion/unavailability exit codes (74/75/76), and
unwrapping the CLI's JSON envelope.

**Never pass `--provider auto` from this skill.** `auto` resolves via
`bs_provider_invoker`, which reports _which provider is currently running_ —
`CODEX_THREAD_ID` set means it returns `codex`. From a Codex session `auto` therefore
selects Codex to review Codex's own work: the precise same-model failure this skill
exists to prevent, and it fails silently because the run succeeds.

You must invert the invoker explicitly and pass the result:

```bash
case "$(bash -c 'source ~/.claude/scripts/provider-policy.sh; bs_provider_invoker')" in
  codex)  REVIEWER=claude ;;
  claude) REVIEWER=codex ;;
  *)      echo "cross-review: cannot identify the current provider" >&2; exit 2 ;;
esac
```

If the user passed `--provider` explicitly, honour it, but refuse when it names the
provider that is currently running — that is a same-model review, not a cross-review.

### Step 1 — collect the diff

Determine the base ref. Use `--base` if given; otherwise the merge-base against the
default branch:

```bash
BASE="$(git merge-base HEAD "$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||' || echo main)")"
git diff "$BASE"...HEAD
```

If the diff is empty, stop and say so. Do not send an empty prompt to a provider.

### Step 2 — build the review prompt

Write a prompt file containing exactly the five elements from the review-request
template — requirements, diff, test evidence, known uncertainties, and the ask.
Omitting the uncertainties section is the common failure: a reviewer that cannot see
where you are unsure spends its budget re-deriving what you already know.

```bash
OUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cross-review-evidence.XXXXXX")"
PROMPT_FILE="$(mktemp "${TMPDIR:-/tmp}/cross-review.XXXXXX")"
cat > "$PROMPT_FILE" <<'PROMPT'
Review this change for defects. Report actionable defects only — each with
file:line and a concrete failure scenario. No style notes, no praise, no
speculation. If you find nothing, say so plainly.

## Requirements
<what the change is supposed to do>

## Diff
<the diff from step 1, with its base ref>

## Test evidence
<what was run and what it returned — say "none run" if that is the case>

## Known uncertainties
<where you are unsure, stated plainly>
PROMPT
```

### Step 3 — run the review

```bash
TARGET_DIR="$(git rev-parse --show-toplevel)"
EXECUTION_FACTS="$OUT_DIR/execution-facts.json"
CHANGED_FILES="$(git diff --name-only "$BASE"...HEAD | wc -l | tr -d ' ')"
jq -n \
  --argjson changedFiles "$CHANGED_FILES" \
  '{phase:"scan",readOnly:true,localized:true,targetedProof:true,changedFiles:$changedFiles,protectedSurfaces:[],sameFailureStreak:0}' \
  > "$EXECUTION_FACTS"
bash ~/.claude/scripts/provider-run.sh \
  --prompt-file "$PROMPT_FILE" \
  --execution-facts "$EXECUTION_FACTS" \
  --provider "$REVIEWER" \
  --fallback none \
  --target-dir "$TARGET_DIR" \
  --sandbox read-only \
  --timeout 900 \
  --output-dir "$OUT_DIR"
```

Use `--sandbox read-only`. A reviewer has no reason to write to the tree, and a
review that mutates the code it is reviewing invalidates its own findings.

Use `--fallback none`. The entire point is a _different_ model; silently falling back
to the provider that authored the change reproduces BUI-468, where a degraded panel
returned same-model consensus that read as independent agreement.

### Step 4 — report

Report the findings as-is, then state two things explicitly:

1. **Which provider actually ran.** Read it from `<output-dir>/provider`, do not
   assume — `auto` resolution depends on environment variables that may be unset.
2. **That this is advisory and does not gate merge.**

## Failure handling

Exit codes come from `provider-run.sh`:

- **74** — provider not installed or unavailable on this machine.
- **75** — provider exhausted (usage limit); the message carries a reset time.
- **76** — timed out.

In every case, report the failure plainly and state that **no cross-review happened**.
Do not fall back to reviewing the change yourself and present it as a cross-review —
that is the exact false-heterogeneity failure this skill exists to prevent. An honest
"the second opinion could not be obtained" is the correct output.
