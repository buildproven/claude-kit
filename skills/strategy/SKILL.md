---
name: strategy
description: Multi-model strategy synthesis & advisory panel via shared ensemble runner
---

# /bs:strategy - Multi-Model Strategy Synthesis & Advisory Panel

**Usage**: `/bs:strategy "<question>" [--context <file>] [--artifact <file1,file2>] [--providers <list>] [--mode debate|parallel] [--output memo|scorecard|tasks] [--rubric <csv>] [--decision <text>] [--persist <path>] [--rounds <n>]`

Use for: architecture decisions, business/pricing strategy, debugging when stuck, validating assumptions before major refactors.

## Goal

Run a reusable cross-model collaboration pass through `scripts/ensemble-runner.js`, then synthesize the panel output into a single recommendation.

This command is the front door for the broader collaboration layer. Do not hand-roll provider calls inline when the runner can do the fan-out, persistence, and score aggregation once.

## Step 1: Clarify the Decision

Ultrathink before you run anything.

1. Identify the actual decision to make, not just the broad topic.
2. Choose only the context and artifact files needed to answer it.
3. Decide whether the answer should be:
   - `memo` for narrative synthesis
   - `scorecard` for comparing options against explicit criteria
   - `tasks` for action planning after the direction is already chosen
4. Define a rubric when tradeoffs need explicit scoring.
5. Pick providers intentionally:
   - `claude` for synthesis and tradeoffs
   - `codex` for technical rigor and implementation risks
   - `gemini` for market framing and alternative angles

## Step 2: Build the Runner Invocation

Use the shared runner instead of embedding provider-specific logic in this command.

Base form:

```bash
# Resolve the runner rather than assuming a checkout location; the last
# candidate is the symlink install.sh creates.
for c in \
  "${CLAUDE_KIT_ROOT:-}/scripts/ensemble-runner.js" \
  "${CLAUDE_PLUGIN_ROOT:-}/scripts/ensemble-runner.js" \
  "$HOME/.claude/scripts/ensemble-runner.js"; do
  if [ -n "$c" ] && [ -f "$c" ]; then RUNNER="$c"; break; fi
done
[ -n "${RUNNER:-}" ] || { echo "strategy: cannot locate ensemble-runner.js" >&2; exit 1; }

node "$RUNNER" \
  "<question>" \
  --providers claude,codex \
  --mode parallel \
  --output memo
```

Add flags only when they materially improve the panel:

- `--context path/to/file.md`
- `--artifact file1,file2`
- `--rubric "pain clarity,authority fit,speed to first sale,moat"`
- `--decision "Choose first paid offer"`
- `--persist docs/strategic-notes/<slug>.md`
- `--rounds 2` when `--mode debate` needs more than one pass

Prefer repo-relative paths when possible.

## Step 3: Run the Panel via the Shared Runner

Run `ensemble-runner.js`. Let it:

1. load context and artifact files
2. fan out prompts to the requested providers via `acpx`
3. collect raw responses
4. generate a single markdown report with:
   - run metadata
   - recommendation lines
   - aggregated scorecard when requested
   - extracted task and risk candidates
   - raw provider output

If `--persist` is present, the runner writes the report to disk.

## Step 4: Synthesize the Report

Read the generated report and then apply sequential thinking:

1. **Agreement Analysis** — where do the providers align? (highest confidence)
2. **Disagreement Analysis** — where do they conflict and why?
3. **Unique Insights** — what did each provider add that the others missed?
4. **Gap Analysis** — what remains unaddressed?
5. **Decision** — what should the user do next, given the panel output and the repo context?

## Output Format

1. **Synthesized Answer** — unified recommendation
2. **Confidence Level** — HIGH/MODERATE/LOW with reasoning
3. **Key Agreements** — where the panel aligned
4. **Notable Differences** — divergences and why they matter
5. **Unique Insights** — best points from each provider
6. **Gaps & Follow-ups** — what needs further exploration
7. **Saved Artifact** — persisted report path, if one was requested

## Error Handling

If one or more providers fail:

- do not fail the whole command unless all providers fail
- note which providers succeeded and which failed
- continue with the available panel output
- lower confidence if the missing provider would materially change the result

If the runner script fails, surface the exact command and error so the shared layer can be fixed once instead of patched in the prompt.

## Practical Defaults

- Default providers: `claude,codex`. Gemini is opt-in because it requires a
  separately installed native CLI and supported authentication.
- Default mode: `parallel`
- Default output: `memo`
- Prefer `scorecard` for concrete option selection
- Prefer `tasks` once the decision is already made

## Examples

```bash
/bs:strategy "What's the best pricing strategy for a B2B SaaS?"
/bs:strategy "Should we add a free tier?" --context ./docs/strategy/my-strategy.md --providers claude,codex,gemini
/bs:strategy "React vs Vue for dashboard app" --artifact ./docs/architecture/frontend-options.md --output scorecard --rubric "team fit,complexity,performance,migration risk"
/bs:strategy "Should we use microservices or monolith?" --mode debate --rounds 2 --output memo
/bs:strategy "What should we sell first?" --artifact docs/POSITIONING-MEMO-2026-03-31.md,docs/NICHE-ASSESSMENT-2026-03-31.md --output scorecard --rubric "pain clarity,authority fit,speed to first sale,market size,moat" --persist docs/strategic-notes/offer-decision.md
```
