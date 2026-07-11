# Extension Architecture

claude-kit is the public core. It is designed to be extended, not forked.

## Two Layers

```
┌─────────────────────────────────────────┐
│  Private overlay (per-operator)         │  your private config repo
│  Your CLAUDE.md, private commands,      │  submodules claude-kit
│  service integrations, secrets          │
├─────────────────────────────────────────┤
│  claude-kit (this repo, free/MIT)       │  public core
│  Everything: quality, autonomous        │
│  workflow, strategy, domain skills      │
└─────────────────────────────────────────┘
```

There used to be a paid `claude-kit-pro` middle layer. It has been folded into
this repo — see the README for why. If you have an overlay that submodules
`claude-kit-pro`, repoint it at `claude-kit`; every command it provided is here.

Each layer adds to the one below. You never modify a lower layer to add personal
or project-specific behaviour.

Updates propagate automatically: a push to claude-kit triggers a submodule bump
PR in your private overlay. No manual syncing.

---

## Layer 1: claude-kit (this repo, free/MIT)

Everything. Core dev commands (`/bs:dev`, `/bs:quality`, `/bs:test`), autonomous
workflow (`/bs:ralph`), strategy (`/bs:strategy`), fleet management (`/bs:sota`,
`/bs:sentry`, `/bs:steward`), domain skills (`legal`, `market-validation`,
`monetize`, `seo`), 14 agents, hooks and CI gates.

**Install and use as-is.** Contribute back if you build something useful to
everyone.

---

## Layer 2: Private Overlay

Your private config repo that sits on top of claude-kit. Contains:

- Your `CLAUDE.md` (preferences, team conventions, known mistakes)
- Private commands not appropriate for the public tiers
- Service integrations (social posting, internal tools, etc.)
- Secrets and environment config

**Structure:**

```
your-private-config/
├── config/
│   └── CLAUDE.md          # Your preferences
├── commands/
│   └── bs/
│       └── my-command.md  # Private commands
└── install.sh             # Init submodules, then overlay private files
```

---

## Per-Project Commands

Claude Code automatically picks up `.claude/` in the current working directory alongside `~/.claude/`. Project-level commands take precedence over global ones with the same name.

```
your-project/
└── .claude/
    ├── CLAUDE.md          # Project-specific conventions
    └── commands/
        └── deploy.md      # Project-specific command
```

---

## Decision Guide

| You want to...                   | Do this                          |
| -------------------------------- | -------------------------------- |
| Use the core toolkit             | Install claude-kit               |
| Get autonomous workflow commands | Already in claude-kit (free)     |
| Add personal preferences         | Private overlay (`CLAUDE.md`)    |
| Add a private workflow command   | Private overlay (`commands/`)    |
| Add a project-specific command   | `.claude/commands/` in that repo |
| Improve something for everyone   | PR to claude-kit                 |
