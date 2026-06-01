---
name: bs:help
description: "Quick reference for all /bs:* commands with flags and usage"
argument-hint: "[--full] → quick or detailed /bs:* reference"
category: maintenance
model: haiku
---

# /bs:help Command

**Arguments received:** $ARGUMENTS

## Instructions

**This command generates its output dynamically from command frontmatter.** Do NOT hardcode command lists.
New commands appear automatically when frontmatter is valid.

### Step 1: Extract command data

Run this bash command to extract frontmatter from all installed command files:

```bash
for f in ~/.claude/commands/bs/*.md ~/.claude/commands/cc/*.md ~/.claude/commands/gh/*.md; do
  [ -f "$f" ] || continue
  fm=$(awk 'BEGIN{n=0} /^---$/{n++; if(n==2) exit; next} n==1{print}' "$f")
  name=$(echo "$fm" | awk -F': ' '/^name:/{print $2}' | tr -d "'\"")
  desc=$(echo "$fm" | awk -F': ' '/^description:/{$1=""; sub(/^ /,""); print}' | tr -d "'\"")
  cat=$(echo "$fm" | awk -F': ' '/^category:/{print $2}' | tr -d "'\"")
  hint=$(echo "$fm" | awk -F': ' '/^argument-hint:/{$1=""; sub(/^ /,""); print}' | tr -d "'\"")
  # Determine tier from symlink target (graceful fallback: assume kit)
  target=$(readlink "$f" 2>/dev/null || echo "$f")
  if echo "$target" | grep -qE "claude-kit-pro|/core/commands"; then tier="pro"
  else tier="kit"; fi
  if [ -n "$name" ] && [ -n "$desc" ]; then
    echo "CMD|${cat:-uncategorized}|${name}|${desc}|${hint}|${tier}"
  fi
done
```

### Step 2: Count skills

```bash
ls ~/.claude/skills/*/SKILL.md 2>/dev/null | wc -l
```

### Step 3: Render output

Use the extracted data to generate the help output. Split commands into two groups based on the `tier` field:

- **tier=kit** → show in the main command tables
- **tier=pro** → collect separately, show in a "claude-kit-pro" upgrade section at the end

Group kit commands by `category` field using the display order and titles below. Omit commands with `category: deprecated`.

**Category display order and titles (kit tier):**

| category    | Display Title              |
| ----------- | -------------------------- |
| quality     | Quality & Production       |
| release     | Quality & Production       |
| development | Development Workflow       |
| workflow    | Development Workflow       |
| agents      | Agent & Session Management |
| strategy    | Strategy & Planning        |
| knowledge   | Strategy & Planning        |
| project     | Project Management         |
| maintenance | Maintenance & Setup        |
| utility     | Maintenance & Setup        |
| github      | GitHub Commands            |
| claude-code | Claude Code Commands       |

Also include this utility command (no frontmatter — hardcode this only):

| Command            | Description                             | Category            |
| ------------------ | --------------------------------------- | ------------------- |
| `/update-claudemd` | Update CLAUDE.md with session learnings | Strategy & Planning |

---

## If arguments contain "--full"

For each kit command, render a detailed section:

```
### /<name>

<description>

Usage: `/<name> <argument-hint>`
```

After all kit commands, render the pro upgrade section (see below), then the Archived/Removed section.

## Else (no --full flag)

For each kit category, render a table:

```
## <Category Title>

| Command | Purpose |
| ------- | ------- |
| `/<name>` | <description> |
```

After all kit tables, render the pro upgrade section (see below).

---

## Pro upgrade section (always render, after kit commands)

```
## claude-kit-pro

Upgrade for autonomous workflow, strategy tools, fleet management, and commercial intelligence.

| Command | Purpose |
| ------- | ------- |
| `/<name>` | <description> |   ← one row per pro-tier command found in Step 1

More: `/bs:strategy`, `/bs:sota`, `/bs:sentry`, `/bs:steward`, agent-browser, seo, legal, monetize skills, and more.
Details: https://github.com/buildproven/claude-kit-pro
```

---

## Skills section (always render, after pro section)

```
## Skills (<count> total)

Invoked naturally — Claude picks the right skill from context.

**Full reference**: `/bs:help --full`
**Workflow guide**: `/bs:workflow`
```

---

## Archived/Removed Commands (include in --full only)

### Quality Commands (Replaced by /bs:quality)

| Old Command           | Replacement                      |
| --------------------- | -------------------------------- |
| `/bs:ready`           | `/bs:quality` (default is 95%)   |
| `/bs:ready --merge`   | `/bs:quality --merge`            |
| `/bs:perfect`         | `/bs:quality --level 98`         |
| `/bs:perfect --merge` | `/bs:quality --level 98 --merge` |
| `/bs:pilot`           | Removed                          |

### Release Prep (now a Skill)

| Old Command | Replacement                                               |
| ----------- | --------------------------------------------------------- |
| `/bs:scrub` | `/bs:scrub` still works — now backed by the `scrub` skill |
