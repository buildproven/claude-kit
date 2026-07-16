---
name: review-content
description: Collaborative artifact review skill for products, PDFs, landing pages, email sequences, decks, and long-form docs. Use when you want a serious pre-ship critique focused on SOTA quality, differentiation, clarity, conversion strength, and competitive sharpness rather than code quality.
user-invocable: false
---

# Review Content

Use this skill when the artifact is content or content-like, not code.

## When To Use

Trigger for:

- digital products and guides
- PDFs where the artifact itself is the deliverable
- landing pages and sales pages
- email sequences
- strategy documents
- slide decks
- competitive content audits

Do **not** use this for:

- code review
- raw architecture review
- PR review

For code, use `/bs:quality` or `/gh:review-pr`.

Use this skill as the rubric source for `/bs:review`. The command is the entrypoint; this skill supplies the review frame and artifact-specific standards.

## Core Review Principle

The goal is not “helpful feedback.”

The goal is to determine:

1. whether the artifact is good enough to ship
2. what would make it clearly better than the generic AI slop in the market
3. what should be cut, tightened, or restructured

## Review Modes

### 1. SOTA Review

Use when the user asks whether something is top-tier, strong enough, or “good enough to ship.”

Rubric:

- substance
- originality
- specificity
- structure
- audience fit
- differentiation
- polish

### 2. Conversion Review

Use for landing pages, sales pages, launch emails, and offer docs.

Rubric:

- buyer clarity
- pain clarity
- offer legibility
- objection handling
- credibility
- CTA strength
- price support

### 3. Clarity Review

Use when the artifact is informative but not directly sales-led.

Rubric:

- readability
- hierarchy
- signal-to-noise
- terminology precision
- pacing
- takeaway clarity

### 4. Competitive Review

Use when the user asks whether the asset feels current or differentiated.

Rubric:

- novelty
- category awareness
- differentiation
- authority
- practical value
- memorability

## Artifact-Specific Review Rubrics

### Product / Guide

- chapter quality
- specificity
- buyer payoff
- template usefulness
- price-to-value match
- distinct insight density

Critical questions:

- Does every chapter earn its place?
- Is there at least one non-obvious insight per major section?
- Would an experienced buyer feel this is worth paying for?

### PDF

- content quality
- layout flow
- typography readability
- page density
- visual polish
- export professionalism

Critical questions:

- Does it read like a finished artifact or an exported draft?
- Are any pages cramped, weak, repetitive, or visually amateur?

If layout matters, combine this skill with the `pdf` skill and, when appropriate, `ui-reviewer`.

### Landing Page

- headline strength
- problem clarity
- offer clarity
- objection handling
- CTA quality
- proof and trust
- scanability

Critical questions:

- Could a qualified buyer understand the offer in 10 seconds?
- Is the deliverable concrete enough to buy?

### Email Sequence

- subject line quality
- narrative progression
- voice consistency
- repetition control
- pitch timing
- CTA fit

Critical questions:

- Does each email have a job?
- Is the sequence pushing too early or too softly?

### Strategy Doc / Memo

- decision clarity
- evidence quality
- tradeoff handling
- actionability
- discipline against abstraction

Critical questions:

- Is this a plan or a plan about planning?
- Are there trip wires and forcing functions?

### Slides / Deck

- story flow
- slide density
- clarity per slide
- visual consistency
- presenter utility

Critical questions:

- Can the audience follow the argument without narration?
- Are there slides trying to do too much?

## Process

1. Classify artifact type and review goal.
2. Extract or load the artifact.
3. If the artifact is visual, inspect layout and not just text.
4. Build an artifact packet for the ensemble runner.
5. Run collaborative review with `claude,codex,gemini` unless the context suggests fewer.
6. Synthesize into a blunt ship/no-ship verdict.

Keep the final synthesis tighter than the raw panel output. The point is editorial judgment, not replaying every model response.

## Output Format

Use this format unless the caller specifies otherwise:

```markdown
## Review Verdict

**Status:** ship | ship after fixes | not ready
**Score:** X/10

### What’s Strong

- ...

### Critical Fixes

- ...

### High-Leverage Improvements

- ...

### Competitive Read

- ...
```

## Anti-Patterns To Flag Hard

- generic AI filler
- vague claims without concrete deliverables
- bloated outlines
- repetitive sections
- weak pricing support
- obvious template smell
- “motivational” copy where the buyer needs specifics
- exported PDFs that still feel like drafts
- decks or landing pages that depend on narration to make sense
