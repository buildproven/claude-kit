---
name: bs:sync-ai
description: 'Sync Claude commands to other AI CLIs (Codex, Gemini)'
argument-hint: '/bs:sync-ai → sync all | --check → verify | --codex → Codex only | --gemini → Gemini only'
category: maintenance
model: haiku
---

# /sync-ai: Sync Claude Commands to Other AI CLIs

**Usage**: `/bs:sync-ai [--check|--diff|--clean] [--codex|--gemini]`

Syncs your Claude Code slash commands to Codex CLI and Gemini CLI so all tools share the same commands.

## Paths

```
SETUP_REPO=$SETUP_REPO
```

## Command Mapping

| Claude Code     | Codex CLI               | Gemini CLI      |
| --------------- | ----------------------- | --------------- |
| `/bs:execute`   | `/prompts:bs-execute`   | `/bs:execute`   |
| `/gh:fix-issue` | `/prompts:gh-fix-issue` | `/gh:fix-issue` |

## Flags

| Flag       | Action                        |
| ---------- | ----------------------------- |
| (none)     | Sync to both Codex and Gemini |
| `--check`  | Verify sync status            |
| `--diff`   | Show what would change        |
| `--clean`  | Remove synced files           |
| `--codex`  | Sync to Codex only            |
| `--gemini` | Sync to Gemini only           |

## Script

```bash
# Sync to all CLIs
$SETUP_REPO/scripts/sync-ai-prompts.sh

# Sync to specific CLI
$SETUP_REPO/scripts/sync-ai-prompts.sh --codex
$SETUP_REPO/scripts/sync-ai-prompts.sh --gemini

# Check status
$SETUP_REPO/scripts/sync-ai-prompts.sh --check
```

## Format Differences

| Feature  | Claude                | Codex               | Gemini                |
| -------- | --------------------- | ------------------- | --------------------- |
| Format   | Markdown + YAML       | Markdown + YAML     | **TOML**              |
| Location | `~/.claude/commands/` | `~/.codex/prompts/` | `~/.gemini/commands/` |
| Subdirs  | ✅ Yes                | ❌ No (flattened)   | ✅ Yes                |

## When to Run

- After adding/modifying Claude commands
- Before using Codex or Gemini CLI
- Periodically to keep all tools in sync
