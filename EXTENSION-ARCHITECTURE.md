# Extension Architecture

claude-power-kit is the public core. It is designed to be extended, not forked.

## Three Layers

```
┌─────────────────────────────────────┐
│  Product pack (per-project)         │  .claude/ in each repo
│  Commands and context for one repo  │
├─────────────────────────────────────┤
│  Private overlay (per-operator)     │  your private config repo
│  Your preferences, private commands │
├─────────────────────────────────────┤
│  Public core (claude-power-kit)     │  this repo
│  General-purpose commands and hooks │
└─────────────────────────────────────┘
```

Each layer adds to the layer below. You never modify the public core to add personal or project-specific behaviour.

---

## Layer 1: Public Core

This repo. Contains general-purpose commands (`/bs:dev`, `/bs:quality`, `/bs:ralph`, etc.), hooks, CI gates, and skills that work for any project.

**When to use as-is:** Install it, use the commands, done.

**When to contribute back:** You've built something that would be useful to anyone — a new quality check, a missing workflow command, a hook improvement. Open a PR.

---

## Layer 2: Private Overlay

Your private config repo that sits on top of the public core. Contains:

- Your `CLAUDE.md` (preferences, team conventions, known mistakes)
- Private commands not appropriate for the public repo
- Secrets and environment config
- Operator-specific workflows

**Structure:**

```
your-private-config/
├── config/
│   └── CLAUDE.md          # Your preferences
├── commands/
│   └── bs/
│       └── my-command.md  # Private commands
└── install.sh             # Symlinks both layers into ~/.claude/
```

**How it works:** Your install script symlinks the public core first, then overlays your private commands. Claude Code merges them — it reads all `~/.claude/commands/` files regardless of source.

---

## Layer 3: Product Pack

Per-project commands and context that live inside the repo itself.

```
your-project/
└── .claude/
    ├── CLAUDE.md          # Project-specific conventions
    └── commands/
        └── bs/
            └── deploy.md  # Project-specific command
```

Claude Code automatically picks up `.claude/` in the current working directory alongside `~/.claude/`. Project-level commands take precedence over global ones with the same name.

**Use this for:** deploy commands, project-specific quality checks, domain-specific workflows, context that only makes sense in one repo.

---

## Decision Guide

| You want to...                              | Do this                          |
| ------------------------------------------- | -------------------------------- |
| Use the toolkit as-is                       | Install and use this repo        |
| Add personal preferences                   | Private overlay (`CLAUDE.md`)    |
| Add a private workflow command              | Private overlay (`commands/`)    |
| Add a project-specific command              | Product pack (`.claude/commands/`) |
| Improve something for everyone             | PR to this repo                  |
| Build a paid or premium workflow pack       | Separate repo, depends on core   |

---

## What Does Not Belong in the Public Core

- Personal preferences or style rules
- Company-specific commands (deploy to your infra, post to your Slack)
- Private service integrations
- Premium or product-specific workflows

Keep the public core general. Everything else goes in the appropriate layer above it.
