---
name: bs:collab
description: 'Multi-model collaboration orchestrator — route turns between Claude, Codex, Gemini, and any CLI'
argument-hint: '<init|run|loop|check|status> [file] [--agents "A,B,C"] [--loop n]'
tags: [agents, workflow, collaboration]
category: agents
model: sonnet
---

# /bs:collab — Multi-Model Collaboration

**Usage:** `/bs:collab <subcommand> [file] [options]`

Routes collaboration turns between any AI CLIs using a shared markdown workspace file.

## Subcommands

```bash
/bs:collab init review.md --agents "Claude Code,Codex"   # Scaffold a new collab file
/bs:collab run review.md                                  # Run the current turn
/bs:collab loop 4 review.md                               # Auto-run 4 turns
/bs:collab check review.md                                # Who's turn? (no execution)
/bs:collab status review.md                               # Full status + log tail
```

Default file: `./AI-COLLAB.md`

## How It Works

1. Each agent reads the shared collab file, acts on `## Current Turn`, writes output, hands off to the next agent
2. Agent → CLI routing is config-driven (`collab.agents.json` or `~/.collab/agents.json`)
3. Built-in support for Claude Code, Codex, and Gemini

## Agent Config

Create `collab.agents.json` next to your collab file to add custom CLIs:

```json
{
  "Claude Code": "claude --dangerously-skip-permissions -p",
  "Codex": "codex exec -c 'sandbox_permissions=[\"disk-full-read-access\",\"disk-full-write-access\"]'",
  "Gemini": "gemini -p",
  "My Model": "mymodel --prompt"
}
```

---

**Arguments received:** $ARGUMENTS

```bash
bash $SETUP_REPO/scripts/collab $ARGUMENTS
```
