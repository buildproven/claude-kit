---
name: bs:quality
description: Autonomous quality loop with configurable thoroughness (95% or 98%). Runs lint, tests, build, security scans, and specialized quality agents. Auto-fixes issues and creates PRs.
argument-hint: "[--level 95|98] [--scope changed|branch|all] [--merge] [--audit] [--deep] [--preflight] [--parallel] [--deploy] [--target-dir <path>]"
tags: [quality, ci, review]
category: quality
---

Invoke the `quality` skill with all provided arguments.

## Flag notes

- `--target-dir <path>` (alias `--target`): run the quality loop against the repo at `<path>` instead of the current working directory. Use when invoking from a forked agent context where the agent's `cwd` is a harness scratch directory rather than the worktree.
