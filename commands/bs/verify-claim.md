---
name: bs:verify-claim
description: Extract factual claims from a draft, verify each against primary sources, mark unverifiable as [unverified] before output. Use before any research or strategy memo.
argument-hint: '[<file-path> | "pasted text"]'
category: quality
tags: [research, rigor, verification, citations]
---

Invoke the `verify-claim` skill with all provided arguments.

**Usage**:

- `/bs:verify-claim <file-path>` — verify a document on disk
- `/bs:verify-claim` — verify the most recent output in the current conversation
- `/bs:verify-claim "pasted text"` — verify inline text
