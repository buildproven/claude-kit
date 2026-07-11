---
name: bs:help
standalone: true
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
  if [ -n "$name" ] && [ -n "$desc" ]; then
    echo "CMD|${cat:-uncategorized}|${name}|${desc}|${hint}"
  fi
done
```

### Step 2: Count skills

```bash
ls ~/.claude/skills/*/SKILL.md 2>/dev/null | wc -l
```

### Step 3: Render output

Use the extracted data to generate the help output. Everything in the kit is free
and MIT — there is no paid tier and no upgrade section.

Group commands by `category` field using the display order and titles below. Omit
commands with `category: deprecated`.

**Category display order and titles:**

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

| Command               | Description                             | Category            |
| --------------------- | --------------------------------------- | ------------------- |
| `/cc:update-claudemd` | Update CLAUDE.md with session learnings | Strategy & Planning |

---

## If arguments contain "--full"

For each command, render a detailed section:

```
### /<name>

<description>

Usage: `/<name> <argument-hint>`
```

After all commands, render the Archived/Removed section.

## Else (no --full flag)

For each category, render a table:

```
## <Category Title>

| Command | Purpose |
| ------- | ------- |
| `/<name>` | <description> |
```

After all tables, render the Skills section.

---

## Skills section (always render, after commands)

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
