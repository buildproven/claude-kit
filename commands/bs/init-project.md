---
name: bs:init-project
description: 'Bootstrap agent infrastructure in any project: dev_guide, docs/plans/, session handoff, and CLAUDE.md integration'
argument-hint: '[--dry-run] [--skip-claude-md]'
tags: [setup, agents, dev-guide, workflow]
category: maintenance
model: sonnet
---

# /bs:init-project - Bootstrap Agent Infrastructure

**Usage**: `/bs:init-project [--dry-run] [--skip-claude-md]`

**Creates:**

- `docs/dev_guide/CONVENTIONS.md` — codebase knowledge base for agents
- `docs/plans/` — directory for `/bs:plan` spec docs
- `.claude/SESSION.md` — session handoff template
- Updates `CLAUDE.md` with agent workflow references

**Arguments received:** $ARGUMENTS

## Implementation

### Step 1: Parse Flags and Confirm Target

```bash
DRY_RUN=false
SKIP_CLAUDE_MD=false

echo "$ARGUMENTS" | grep -q '\-\-dry-run' && DRY_RUN=true
echo "$ARGUMENTS" | grep -q '\-\-skip-claude-md' && SKIP_CLAUDE_MD=true

GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
[ -z "$GIT_ROOT" ] && echo "❌ Not in a git repository" && exit 1
cd "$GIT_ROOT"

PROJECT_NAME=$(basename "$GIT_ROOT")
echo "🚀 Initializing agent infrastructure for: $PROJECT_NAME"
echo "   Path: $GIT_ROOT"
echo ""

[ "$DRY_RUN" = true ] && echo "DRY RUN — no files will be written" && echo ""
```

### Step 2: Explore the Project (via Subagent)

Spawn an Explore subagent to understand the project before generating content:

```
Task(subagent_type: "Explore",
     prompt: "Explore this project to understand it well enough to write a dev_guide for agents.

     Find and summarize:
     1. What the project does (read README.md, package.json/pyproject.toml, main entry points)
     2. Tech stack (language, frameworks, key libraries)
     3. Directory structure (top-level dirs and their purpose)
     4. Key source files (the most important 5-10 files an agent would need to know about)
     5. Conventions (naming patterns, how files are organized, how to add a new feature)
     6. How to run tests, build, lint (read package.json scripts or Makefile)
     7. Non-obvious gotchas (env vars required, setup steps, known foot-guns)
     8. Recent work (git log --oneline -20 to understand active development areas)

     Return a structured summary covering all 8 points.")
```

### Step 3: Generate `docs/dev_guide/CONVENTIONS.md`

Using the exploration summary, generate this file:

```markdown
# Dev Guide — [PROJECT_NAME]

> Agent-optimized reference. Load this at session start instead of exploring the codebase blind.
> Keep it current: update when patterns change, not just when adding new ones.

**Last updated:** [DATE]

---

## What This Project Does

[1-2 sentence description from README/exploration]

**Tech stack:** [language, framework, key libs]
**Entry point:** [main file / start command]

---

## Directory Structure
```

[key dirs with one-line descriptions]

````

---

## Key Files

| File | Role |
|------|------|
| [file] | [what it does] |

---

## Conventions

### Naming
- [naming pattern for files]
- [naming pattern for functions/classes]

### Adding a New Feature
1. [step 1 — where to add it]
2. [step 2 — what to update]
3. [step 3 — how to test]

### Code Style
- [key style rules]

---

## Running the Project

```bash
# Install
[install command]

# Dev server / run
[run command]

# Tests
[test command]

# Lint
[lint command]

# Build
[build command]
````

---

## Agent Gotchas

Things that trip up agents on this project:

- **[gotcha 1]:** [explanation]
- **[gotcha 2]:** [explanation]

Required env vars: [list or "see .env.example"]

---

## Active Development Areas

Recent focus (last 20 commits):
[brief summary of what's been changing]

````

### Step 4: Create `docs/plans/` and `.claude/` Directories

```bash
if [ "$DRY_RUN" = false ]; then
  mkdir -p docs/dev_guide docs/plans .claude

  # Write SESSION.md template
  cat > .claude/SESSION.md.template <<'EOF'
# Session Handoff

**Branch:**
**Date:**

## Current Task
<!-- What are we building/fixing? -->

## Files in Play
<!-- Files you've been working on -->

## Decisions Made
<!-- Key decisions a fresh agent needs to know -->

## Next Step
<!-- Exactly where to resume — be specific -->

## Notes / Gotchas
<!-- Anything that surprised you -->
EOF

  echo "✅ Created docs/dev_guide/"
  echo "✅ Created docs/plans/"
  echo "✅ Created .claude/SESSION.md.template"
fi
````

### Step 5: Update CLAUDE.md

If `--skip-claude-md` is not set, append agent workflow section to CLAUDE.md:

```bash
if [ "$SKIP_CLAUDE_MD" = false ] && [ -f "CLAUDE.md" ]; then
  # Check if already initialized
  if grep -q "## Agent Workflow" CLAUDE.md; then
    echo "ℹ️  CLAUDE.md already has agent workflow section — skipping"
  else
    if [ "$DRY_RUN" = false ]; then
      cat >> CLAUDE.md <<'EOF'

## Agent Workflow

### Session Start
Load codebase context before exploring:
```

Read docs/dev_guide/CONVENTIONS.md

```

### Planning Complex Work
Before implementing anything with 6+ files or multiple valid approaches:
```

/bs:plan <feature-name>

```
Plan docs live in `docs/plans/`. They survive context resets — reference them in new sessions.

### Session Handoff
Before ending a session or running /compact:
```

/bs:context --save

```
Resume in a new session with:
```

/bs:context --resume

```
EOF
      echo "✅ Updated CLAUDE.md with agent workflow section"
    fi
  fi
fi
```

### Step 6: Summary

```bash
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Agent infrastructure initialized for $PROJECT_NAME"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Created:"
echo "  docs/dev_guide/CONVENTIONS.md   — codebase knowledge base"
echo "  docs/plans/                     — spec docs directory"
echo "  .claude/SESSION.md.template     — session handoff template"
[ "$SKIP_CLAUDE_MD" = false ] && echo "  CLAUDE.md                       — updated with agent workflow"
echo ""
echo "Next steps:"
echo "  1. Review docs/dev_guide/CONVENTIONS.md — add project-specific gotchas"
echo "  2. Commit: git add docs/ .claude/ CLAUDE.md && git commit -m 'chore: init agent infrastructure'"
echo "  3. Start sessions with: Read docs/dev_guide/CONVENTIONS.md"
echo "  4. Use /bs:plan before complex work, /bs:context --save before ending sessions"
```

## Examples

```bash
/bs:init-project                    # Standard init
/bs:init-project --dry-run          # Preview without writing files
/bs:init-project --skip-claude-md   # Skip CLAUDE.md update
```
