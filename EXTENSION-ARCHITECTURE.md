# Extension Architecture

claude-kit is the public core. It is designed to be extended, not forked.

## Three Layers

```
┌─────────────────────────────────────────┐
│  Private overlay (per-operator)         │  your private config repo
│  Your CLAUDE.md, private commands,      │  submodules claude-kit-pro
│  service integrations, secrets          │
├─────────────────────────────────────────┤
│  claude-kit-pro (paid)                  │  submodules claude-kit
│  Autonomous workflow, agents, premium   │
│  skills, session and backlog management │
├─────────────────────────────────────────┤
│  claude-kit (this repo, free)           │  public core
│  Core dev commands, quality, hooks,     │
│  basic skills and review agents         │
└─────────────────────────────────────────┘
```

Each layer adds to the layer below. You never modify a lower layer to add personal or project-specific behaviour.

Updates propagate automatically: a push to claude-kit triggers a submodule bump PR in claude-kit-pro, which in turn triggers a bump PR in your private overlay. No manual syncing.

---

## Layer 1: claude-kit (free, this repo)

General-purpose commands (`/bs:dev`, `/bs:quality`, `/bs:test`, etc.), hooks, CI gates, and skills that work for any project.

**Install and use as-is.** Contribute back if you build something useful to everyone.

---

## Layer 2: claude-kit-pro (paid)

Submodules claude-kit as `/core` and adds the autonomous workflow layer on top:

- `/bs:ralph` — graph-orchestrated backlog execution loop
- `/bs:strategy` — multi-LLM strategy synthesis
- `/bs:session`, `/bs:resume` — session continuity
- `/bs:backlog`, `/bs:sota`, `/bs:sentry`, `/bs:steward` — project management
- `/bs:agent-new`, `/bs:agent-run` — custom agent workflows
- 13 additional specialist agents
- Premium skills: frontend-design, seo, ui-reviewer, webapp-testing, pdf, docx, xlsx, and more

**install.sh** initialises the core submodule, then symlinks both layers into `~/.claude/`.

---

## Layer 3: Private Overlay

Your private config repo that sits on top of claude-kit-pro. Contains:

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
| Get autonomous workflow commands | Upgrade to claude-kit-pro        |
| Add personal preferences         | Private overlay (`CLAUDE.md`)    |
| Add a private workflow command   | Private overlay (`commands/`)    |
| Add a project-specific command   | `.claude/commands/` in that repo |
| Improve something for everyone   | PR to claude-kit                 |
