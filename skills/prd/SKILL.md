---
name: prd
description: Carson-pattern PRD discipline — 3-5 clarifying questions before draft, junior-dev-targeted PRD, dot-notation task list (0.0 = create feature branch), machine-verifiable acceptance criteria, mandatory pause gates between parent tasks and subtask expansion. The forcing function for any work that takes more than one day.
tags: [planning, spec, prd, carson, workflow]
category: planning
---

# PRD — Carson Pattern, Strict

The biggest mistake Carson identified: _"They try to rush through the context where you just don't have the patience to tell the AI what it actually needs to know to solve your problem."_ This skill prevents that rush. It refuses to write a PRD until the user answers clarifying questions, refuses to generate subtasks until parent tasks are approved, and refuses acceptance criteria that can't be machine-verified.

## When to use this skill

**Mandatory** for: any feature estimated >1 day; anything touching billing, auth, data migration; anything user-facing that ships.
**Skip** for: typo fixes, dependency bumps, doc edits, refactors with no behavioral change.

`/bs:dev --next` and `/bs:dev <name>` auto-route to this skill when complexity assessment scores ≥ M (medium) or higher. Override with `/bs:dev --no-prd`.

## Usage

`/bs:prd <feature-name>` — start a new PRD interactively
`/bs:prd from <voice-recording-or-rough-notes>` — turn "verbal diarrhea" into structured PRD (Carson's preferred entry point)
`/bs:prd review <path-to-prd>` — re-run validation on existing PRD
`/bs:prd tasks <path-to-prd>` — generate dot-notation task list from existing PRD

## Phase 1 — Clarifying Questions (REQUIRED)

Ask exactly **3 to 5 questions**, targeting the **most critical gaps** for understanding. Not 10. Not 1. Tailor to what's actually missing from the input.

**Rule**: If the user's brief already covers one of these, skip it. Ask only what's actually gap.

Standard question pool (pick the 3–5 most important):

1. **Problem / goal**: What user pain are we solving? What does success look like in one sentence?
2. **Target user**: Name + role + decision context. ("Sarah, ops manager, evaluating tools Tuesday with 3 tabs open.")
3. **Out of scope**: What are we explicitly NOT building in this slice?
4. **Success metric**: One number you'd check in 30 days to know it worked. ("activation rate >40%", not "users love it")
5. **Constraints**: Tech stack, budget, deadline, regulatory, anything that limits design space.
6. **Failure mode**: What's the worst plausible thing that breaks?

After asking, **wait for answers**. Do not draft the PRD with placeholders.

**Concrete-answer rule (mandatory):** the answers to problem, target user, scope boundary, success metric, and failure mode MUST be concrete before drafting. "Users want it" / "it should be fast" / "increase engagement" are not concrete.

- If an answer is vague, push back with a sharper version of the question.
- If still vague on the second pass, **stop** and ask the user explicitly: _"This needs a number / name / specific thing before I can write a PRD a junior engineer could implement. Either give me one or split this into a research spike first."_
- Do **not** silently accept and flag in `Open questions` — that's Carson's exact anti-pattern.

The ONLY exception: low-stakes optional fields (e.g. a non-critical NFR detail) may be flagged as `[unverified]` in the PRD. Core fields (problem, user, metric) cannot.

## Phase 2 — Draft PRD (Junior-Dev Target)

Output to `docs/prd/<feature-slug>.md`. Audience: a junior engineer who has never seen the codebase. Plain English, no jargon, no "obviously". Sections:

```markdown
# PRD: <Feature Name>

> Status: DRAFT | Author: <user> | Date: <YYYY-MM-DD>
> Estimate: <S | M | L> | Risk: <low | medium | high>

## 1. Overview

<2-3 sentences. What is this, who is it for, why now.>

## 2. Goals

- Goal 1 (measurable)
- Goal 2 (measurable)

## 3. Non-goals

<What we are EXPLICITLY not building. Carson: "non-goals are as important as goals.">

## 4. User stories

- As <persona>, I want <action> so that <outcome>.
- (3-7 stories. If you have 20, the PRD is too big — split.)

## 5. Functional requirements

- FR1: <specific behavior>
- FR2: ...
  <numbered, atomic, testable. "User can reset password via email" is good. "User has good experience" is not.>

## 6. Non-functional requirements

- Performance: <e.g. p95 < 500ms>
- Security: <e.g. no PII in logs, rate-limit 10/min/user>
- Accessibility: WCAG 2.1 AA
- Browser support: <list>

## 7. Design considerations

<Reference docs/design.md if present. List specific tokens/components used.>

## 8. Success metrics

- Primary: <one number, with target>
- Guardrail: <what we DON'T want to regress>

## 9. Risks

- Risk: <what could go wrong> → Mitigation: <how we prevent it>

## 10. Open questions

- Q: <unresolved thing> → Owner: <who decides> → By: <date>
```

After writing, **show the PRD to the user**. Explicitly say:

> _"Read this carefully. Reply **`PRD approved`** to lock and move to parent tasks. Otherwise paste edits and I'll revise."_

Wait. Do not start generating tasks speculatively. Do not accept "looks good" — require the exact phrase `PRD approved` (case-insensitive OK) so the gate is unambiguous.

Carson's rule: _read the thing_. If the user replies in under 30 seconds, gently push: _"Want a real read first? Edits caught here are 10x cheaper than caught at implementation."_

## Phase 3 — Parent Tasks (PAUSE GATE)

After PRD is approved, generate **up to 7 parent tasks** in dot notation. Always `0.0 = "Create feature branch <branch-name>"`. Output to `docs/prd/<feature-slug>-tasks.md`:

```markdown
# Tasks: <Feature Name>

> PRD: docs/prd/<feature-slug>.md

- [ ] 0.0 Create feature branch `feat/<slug>`
- [ ] 1.0 <Database / schema layer>
- [ ] 2.0 <API / backend layer>
- [ ] 3.0 <Frontend / UI layer>
- [ ] 4.0 <Tests / QA>
- [ ] 5.0 <Docs / release>
```

**HARD STOP.** Show the parent list. Ask:

> _"Reply **`parents approved`** to expand subtasks. Otherwise paste edits or reorder first."_

Require the exact phrase `parents approved`. Generic "yes" / "ok" / "looks good" must trigger a re-prompt: _"Confirm with the phrase 'parents approved' to avoid accidental advancement."_ This sounds pedantic but it's the difference between a gate and a speed bump.

Do **NOT** proceed to subtasks without that phrase.

## Phase 4 — Subtasks (after approval)

For each approved parent task, expand into atomic subtasks. Rules:

- Each subtask is doable in a single agent session (≤ 30 min wall time)
- Each subtask names the file(s) it touches
- Every parent ends with a `Write tests` subtask
- Last subtask under each parent: `Run test suite; if green, commit`

Example:

```markdown
- [ ] 2.0 API: password reset endpoint
  - [ ] 2.1 Add POST /api/auth/reset-request route handler in `src/api/auth.ts`
  - [ ] 2.2 Generate signed reset token (jwt, 15min ttl) in `src/lib/tokens.ts`
  - [ ] 2.3 Send email via existing mailer in `src/lib/mailer.ts`
  - [ ] 2.4 Rate-limit endpoint to 5/hour/email in `src/middleware/rate-limit.ts`
  - [ ] 2.5 Write integration tests in `tests/auth/reset.test.ts`
  - [ ] 2.6 Run test suite; if green, commit
```

## Phase 5 — Machine-Verifiable Acceptance Criteria

Append to the PRD:

```markdown
## Acceptance criteria (must be machine-verifiable)

Each item must be checkable WITHOUT human judgment.

- [ ] AC1: `npm run lint` passes with 0 errors
- [ ] AC2: `npm run typecheck` passes
- [ ] AC3: `npm test -- tests/auth/reset.test.ts` passes
- [ ] AC4: Playwright test `tests/e2e/password-reset.spec.ts` passes
- [ ] AC5: Rate limit verifiable via `curl` script (6th request returns 429)
- [ ] AC6: Bundle size delta < 5KB gzipped (CI check)
```

**Vetoed phrases** in acceptance criteria (refuse to accept — full list):

- "works correctly" / "works as expected"
- "looks good" / "looks right"
- "user-friendly" / "intuitive" / "seamless"
- "performant" / "fast" / "optimized" / "snappy"
- "secure" / "safe"
- "robust" / "reliable" / "stable"
- "production-ready"
- "edge cases covered" / "edge cases handled"
- "handled gracefully" / "handled properly"
- "clean UI" / "polished" / "professional"
- "reasonable" / "sensible"
- "no regressions" (without specifying which regressions)
- "good error messages" (without specifying which messages)
- "scales" (without specifying to what — RPS, rows, users)

Replace each with a specific assertion that an agent can run: a command + expected output, a test path + expected status, a measurable threshold (p95 < X ms, bundle ≤ Y KB).

If the user pushes back ("but X clearly means Y"), respond: _"Then say Y explicitly — that's the criterion."_ Vague AC is the #1 source of "AI lied to me" moments Carson warns about.

## Phase 6 — Hand-off to /bs:dev or /bs:ralph

Once PRD + tasks + acceptance criteria are locked:

- `/bs:dev <feature-slug>` — interactive implementation (developer in loop, one subtask at a time)
- `/bs:ralph --inline "<paste task list>"` — autonomous loop (sub-task by sub-task with reflection)

Both consume `docs/prd/<feature-slug>-tasks.md` as backlog. The state-machine of `/bs:ralph` (PICK→IMPLEMENT→QUALITY→REFLECT→DECIDE) maps to one subtask per cycle.

## Anti-patterns this skill refuses

1. **One-shotting**: refuse to generate PRD + tasks + subtasks in a single response without pause gates.
2. **Skipping clarify**: refuse to draft PRD if input is < ~200 chars without asking questions first.
3. **Vague AC**: refuse acceptance criteria lacking a runnable check.
4. **Junior-dev violation**: re-read every PRD section asking "would a junior engineer who has never seen the codebase understand this?" If no, rewrite.
5. **Scope creep mid-draft**: if user adds requirements after PRD is locked, flag explicitly: "this is scope creep; new PRD or amendment?" Do not silently merge.

## Files this skill writes

- `docs/prd/<slug>.md` — the PRD
- `docs/prd/<slug>-tasks.md` — the dot-notation task list

Both live in the target project's repo, version-controlled. They are the canonical source of truth — agents reference them, humans edit them, they outlive any single conversation.

## See also

- Carson's "3-step AI coding workflow" — Lenny's Newsletter
- tenex.co playbook: "How to ship software without touching your keyboard"
- GitHub Spec Kit: https://github.com/github/spec-kit (similar pattern, more verbose)
- `/bs:plan` (claude-kit) — lighter-weight planning for non-PRD work
- `/bs:dev`, `/bs:ralph` — downstream consumers
