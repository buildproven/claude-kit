---
name: bs:scrub
invokes: scrub
description: "Scrub/clean a project for release: open source, giveaway, or commercial sale"
argument-hint: "[path] [opensource|sell|giveaway]"
tags: [release, security, opensource]
category: release
---

**Invocation args:** `$ARGUMENTS`

Invoke the `scrub` skill with all provided arguments.

The skill handles three release modes (`opensource`, `giveaway`, `sell`) with shared security/privacy phases and mode-specific documentation generation. If no mode is provided, it will prompt.
