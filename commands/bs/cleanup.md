---
name: bs:cleanup
description: "Clean up AI CLI caches, temp files, and zombie processes"
argument-hint: "/bs:cleanup → preview | --all --force → full cleanup | --zombies → kill processes"
category: maintenance
model: haiku
---

# /bs:cleanup Command

**Arguments received:** $ARGUMENTS

Focused cleanup script: zombies, swap, large files (>250MB). Does NOT touch Codex/Claude auth.

## Paths

```
SETUP_REPO=$SETUP_REPO
```

## Parse Arguments

| Argument    | Action                                          |
| ----------- | ----------------------------------------------- |
| (none)      | Show system status (memory, swap, zombie count) |
| `--zombies` | Kill orphaned node processes                    |
| `--large`   | Find large files (>250MB) in temp/cache dirs    |
| `--swap`    | Clear swap memory (requires sudo)               |
| `--force`   | Skip confirmation prompts                       |
| `--all`     | Full cleanup: zombies + large + swap            |
| `--dry-run` | Preview without making changes                  |

## Execute Based on Arguments

### If no arguments

Show current system status:

```bash
$SETUP_REPO/scripts/ai-cli-cleanup.sh
```

### If `--zombies`

Find and kill orphaned node processes (vitest, webpack, esbuild, etc.):

```bash
$SETUP_REPO/scripts/ai-cli-cleanup.sh --zombies
```

### If `--zombies --force`

Kill zombie processes without confirmation:

```bash
$SETUP_REPO/scripts/ai-cli-cleanup.sh --zombies --force
```

### If `--large`

Find large files (>250MB) in temp/cache directories:

```bash
$SETUP_REPO/scripts/ai-cli-cleanup.sh --large
```

### If `--swap`

Clear swap memory:

```bash
$SETUP_REPO/scripts/ai-cli-cleanup.sh --swap
```

### If `--all`

Full cleanup - zombies + large files + swap:

```bash
$SETUP_REPO/scripts/ai-cli-cleanup.sh --all
```

### If `--dry-run`

Preview what would be done:

```bash
$SETUP_REPO/scripts/ai-cli-cleanup.sh --dry-run --all
```

## What Gets Cleaned

| Category             | Action                                              | Flag        |
| -------------------- | --------------------------------------------------- | ----------- |
| **Zombie Processes** | Kill orphaned vitest/webpack/esbuild/rollup         | `--zombies` |
| **Large Files**      | Find files >250MB in /tmp, ~/.cache, Library/Caches | `--large`   |
| **Swap Memory**      | Purge swap and inactive memory                      | `--swap`    |

## What is NOT Touched

- **Codex auth** (~/.codex) - keeps you logged in
- **Claude projects** - conversation history preserved
- **Gemini/Copilot auth** - credentials safe
- **npm/yarn caches** - minimal space savings

## Output

After running, report:

- Memory freed (if --zombies used)
- Large files found (if --large used)
- Swap status (if --swap used)

## Examples

```bash
/bs:cleanup                    # Show system status
/bs:cleanup --zombies          # Kill orphaned processes
/bs:cleanup --zombies --force  # Kill without confirmation
/bs:cleanup --large            # Find large temp files
/bs:cleanup --swap             # Clear swap memory
/bs:cleanup --all              # Full cleanup
/bs:cleanup --dry-run --all    # Preview full cleanup
```
