---
name: bs:help
description: 'Quick reference for all /bs:* commands with flags and usage'
argument-hint: '[--full] → quick or detailed /bs:* reference'
category: maintenance
model: haiku
---

# /bs:help Command

**Arguments received:** $ARGUMENTS

## Instructions

**This command generates its output dynamically from command frontmatter.** Do NOT hardcode command lists.
New commands (for example `/bs:ralph-next`) appear automatically when frontmatter is valid.

### Step 1: Extract command data

Run this bash command to extract frontmatter from all command files:

```bash
for f in ~/Projects/claude-setup/commands/bs/*.md ~/Projects/claude-setup/commands/cc/*.md ~/Projects/claude-setup/commands/gh/*.md; do
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
ls ~/Projects/claude-setup/skills/*/SKILL.md 2>/dev/null | wc -l
```

### Step 3: Render output

Use the extracted data to generate the help output. Group commands by `category` field.

**Category display order and titles:**

| category    | Display Title              |
| ----------- | -------------------------- |
| quality     | Quality & Production       |
| development | Development Workflow       |
| workflow    | Development Workflow       |
| agents      | Agent & Session Management |
| strategy    | Strategy & Planning        |
| knowledge   | Strategy & Planning        |
| newsletter  | Newsletter & Social Media  |
| project     | Project Management         |
| maintenance | Maintenance & Setup        |
| github      | GitHub Commands            |
| claude-code | Claude Code Commands       |

Also include these utility commands (no frontmatter - hardcode these 3 only):

| Command            | Description                                | Category            |
| ------------------ | ------------------------------------------ | ------------------- |
| `/debug`           | Systematic debugging protocol (when stuck) | Strategy & Planning |
| `/refactor`        | Code quality cleanup (jscpd + knip)        | Strategy & Planning |
| `/update-claudemd` | Update CLAUDE.md with session learnings    | Strategy & Planning |

---

## If arguments contain "--full"

For each command, render a detailed section:

```
### /<name>

<description>

Usage: `/<name> <argument-hint>`
```

At the end, include the Skills section and the Archived/Removed section (below).

## Else (no --full flag)

For each category, render a table:

```
## <Category Title>

| Command | Purpose |
| ------- | ------- |
| `/<name>` | <description> |
```

At the end, add:

```
## Skills (<count> total)

Ask Claude naturally to invoke. Example: "Use pdf skill to extract data"

**Content:** pdf, docx, xlsx
**Development:** frontend-design, webapp-testing, ui-reviewer, api-conventions, error-handling, test-strategy
**Operations:** recover, cleanup, sota
**Meta:** doc-coauthoring, mcp-builder, skill-creator

**Full reference**: `/bs:help --full`
**Workflow guide**: `/bs:workflow`
**Cheat sheet**: `~/Projects/claude-setup/docs/WORKFLOW-CHEATSHEET.md`
**Optimization**: `/cc:optimize`
```

---

## Archived/Removed Commands (include in --full only)

### Content Pipeline (Moved to your newsletter tool)

| Old Command   | Status                                          |
| ------------- | ----------------------------------------------- |
| `/bs:pilot`   | Content pipeline moved to your newsletter tool (2026-02-10) |
| `/bs:article` | Article creation moved to your newsletter tool (2026-02-15) |

### Quality Commands (Replaced by /bs:quality)

| Old Command           | Replacement                      |
| --------------------- | -------------------------------- |
| `/bs:ready`           | `/bs:quality` (default is 95%)   |
| `/bs:ready --merge`   | `/bs:quality --merge`            |
| `/bs:perfect`         | `/bs:quality --level 98`         |
| `/bs:perfect --merge` | `/bs:quality --level 98 --merge` |

### Commands Moved to VibeBuildLab Product (CS-004 cleanup)

| Old Command    | Status                                         |
| -------------- | ---------------------------------------------- |
| `/bs:validate` | Moved to VibeBuildLab product                  |
| `/bs:build`    | Moved to VibeBuildLab product                  |
| `/bs:ship`     | Moved to VibeBuildLab product                  |
| `/bs:launch`   | Moved to VibeBuildLab product                  |
| `/bs:grow`     | Moved to VibeBuildLab product                  |
| `/bs:run`      | Moved to VibeBuildLab product                  |
| `/bs:project`  | Moved to VibeBuildLab product                  |
| `/bs:monitor`  | Moved to VibeBuildLab product                  |
| `/bs:queue`    | Moved to VibeBuildLab product (`/vbl-queue`)   |
| `/bs:revenue`  | Moved to VibeBuildLab product (`/vbl-revenue`) |
