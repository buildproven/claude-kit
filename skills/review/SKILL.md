---
name: review
description: Collaborative artifact review for products, PDFs, landing pages, emails, and docs via the shared ensemble runner
---

# /bs:review - Collaborative Artifact Review

**Usage**: `/bs:review <artifact-path[,artifact-path2]> [--type product|pdf|landing|email|doc|slides|general] [--goal sota|conversion|clarity|competitive] [--visual] [--persist <path>]`

Use this when you want a serious collaborative review of a built artifact before shipping it:

- product guides
- PDFs
- landing pages
- email sequences
- strategy docs
- slide decks
- general long-form written assets

This is **not** a code-review command. For code, use `/bs:quality` or `/gh:review-pr`.

## Review Standard

Default standard: **SOTA enough to ship confidently**

That means the review should test for:

- substance over padding
- specificity over generic AI filler
- strong buyer clarity
- differentiated insight
- structural completeness
- conversion credibility where relevant
- visual/layout quality when layout matters

## Step 1: Classify the Artifact

Determine the artifact type from the flag or the file itself:

- `product` — paid guide, playbook, starter kit, offer doc
- `pdf` — exported artifact where layout matters
- `landing` — sales or capture page copy
- `email` — launch or nurture sequence
- `doc` — general strategy or content draft
- `slides` — deck or presentation
- `general` — fallback when the shape is mixed

Determine the review goal:

- `sota` — overall quality and competitiveness
- `conversion` — does this persuade and sell?
- `clarity` — does this communicate cleanly?
- `competitive` — does this feel differentiated and current?

If no goal is given, default to `sota`.

## Step 2: Load the Right Context

Always use the `review-content` skill for rubric selection and review criteria.

Then:

- For Markdown/text artifacts: read the source directly.
- For PDFs: use the `pdf` skill to extract text and, when layout matters, render or inspect pages before reviewing.
- For visual artifacts or screenshots: use the `ui-reviewer` skill in addition to `review-content`.
- For slide decks or page screenshots: review both content and presentation quality when possible.

Do not review a PDF purely as raw text if typography, spacing, or page flow are part of the asset’s value.

## Step 3: Build the Review Packet

Create a compact artifact packet containing:

- artifact type
- review goal
- title / working title
- target buyer or audience, if known
- price, if relevant
- the actual source text or extracted text
- layout notes if visual review was performed

Use the artifact file(s) directly when possible. If the artifact requires extraction first, write a temporary packet file and pass that to the ensemble runner.

## Step 4: Run the Collaborative Review

Use the shared runner:

```bash
# Resolve the runner rather than assuming a checkout location; the last
# candidate is the symlink install.sh creates.
for c in \
  "${CLAUDE_KIT_ROOT:-}/scripts/ensemble-runner.js" \
  "${CLAUDE_PLUGIN_ROOT:-}/scripts/ensemble-runner.js" \
  "$HOME/.claude/scripts/ensemble-runner.js"; do
  if [ -n "$c" ] && [ -f "$c" ]; then RUNNER="$c"; break; fi
done
[ -n "${RUNNER:-}" ] || { echo "review: cannot locate ensemble-runner.js" >&2; exit 1; }

node "$RUNNER" \
  "Review this [artifact type] for [goal]. Is it strong enough to ship?" \
  --decision "Decide whether this artifact is ready to ship and what must change first" \
  --artifact [artifact file or temp packet] \
  --providers claude,codex,gemini \
  --mode parallel \
  --output scorecard \
  --rubric "[artifact-specific rubric from skill]" \
  --persist [optional path]
```

If the artifact is primarily visual and the user asked for a stronger design/layout read, review the rendered artifact first, capture concise layout notes, then pass those notes into the packet before running the panel.

Preferred outputs:

- `scorecard` for ship/no-ship decisions
- `tasks` for revision-focused passes after one review already happened

## Step 5: Synthesize Like an Editor, Not a Cheerleader

Return:

1. **Verdict** — `ship`, `ship after fixes`, or `not ready`
2. **Overall score** — concise, no fake precision
3. **Critical fixes** — what must change before shipping
4. **High-leverage improvements** — what would materially raise quality
5. **What feels strongest** — keep these
6. **Competitive read** — does it feel current, differentiated, and worth attention?

When the user wants a revision plan instead of a simple verdict, end with a flat task list ordered by impact.

Be blunt. Cut padding. Do not reward artifacts for being long.

## Step 6: If Asked, Apply the Review

If the user wants edits after the review, make them in a follow-up pass or continue in the same session if the request is explicit.

Do not silently rewrite the artifact during the review-only command unless the user asked for fixes.

## Examples

```bash
/bs:review docs/my-guide.md --type product --goal sota
/bs:review docs/my-guide.pdf --type pdf --goal competitive --visual
/bs:review landing-pages/e2p.html --type landing --goal conversion
/bs:review docs/WELCOME-SEQUENCE.md --type email --goal clarity
/bs:review docs/offer-memo.md --type doc --goal sota --persist docs/reviews/offer-memo-review.md
```
