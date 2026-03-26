---
name: bs:fleet-init
description: Initialize AI Agent Fleet — interactive setup wizard for agent roles, SOUL.md, HEARTBEAT.md
tags: [agents, fleet, setup, wizard]
category: agents
---

# /bs:fleet-init -- Initialize AI Agent Fleet

Interactive setup wizard that customizes the AI Agent Fleet Starter Kit for your specific
business. Generates production-ready SOUL.md, HEARTBEAT.md, MEMORY.md, and directory
structure for every agent role that fits your context.

## When to Use

Run this when setting up a new OpenClaw agent fleet from scratch, or when onboarding the
starter kit into an existing project.

## Instructions

When this command is invoked, follow these steps in order:

### Step 1 -- Gather Business Context

Ask the user:

**Question 1:** "What does your business do? (1-2 sentences is enough)"

Wait for response. Store as: BUSINESS_DESCRIPTION

**Question 2:** "What's your primary output type? Choose one or a mix:

1. Content (newsletter, blog, social media)
2. Code/tools (SaaS, scripts, automations)
3. Research (intelligence, analysis, reports)
4. Sales (lead gen, conversions, pipeline)
5. Ops (process automation, infrastructure)
6. Mix (multiple of the above)"

Wait for response. Store as: OUTPUT_TYPE

### Step 2 -- Recommend Agent Roles

Based on the answers, recommend which of the 7 roles apply. Use this logic:

**Always recommend:** orchestrator, ops (every fleet needs coordination and infra)

**Content output type:** add writer, marketer, researcher
**Code output type:** add builder, researcher
**Research output type:** add researcher, writer (for reports)
**Sales output type:** add researcher, writer, marketer
**Ops output type:** add builder, ops (already included)
**Mix:** recommend all roles that serve any of the selected output types

Present the recommendations:
"Based on what you've described, here's the agent fleet I'd recommend:

- [role]: [one sentence explaining what it does for THIS business]
- [role]: [one sentence]
  ..."

Ask: "Does this make sense, or would you adjust it?"

If they adjust, update the role list.

### Step 3 -- Generate Customized SOUL.md for Each Role

For each recommended role, generate a customized SOUL.md that:

- Replaces generic descriptions with the user's specific business context
- Sets PURPOSE to reflect what this agent does for THEIR business
- Customizes SCOPE to match their actual output types
- Sets PERSONALITY to a voice that fits their brand (ask if unsure)

Use the template structure from the starter kit but replace all generic placeholder text
with specific, relevant content for this business.

Example transformation:

- Generic: "Run the content engine for your business."
- Customized: "Run the content engine for [BUSINESS_NAME]. Write weekly newsletters covering
  [TOPIC], SEO blog posts on [NICHE], and LinkedIn posts for [AUDIENCE]."

### Step 4 -- Create Directory Structure

Generate the commands to create the workspace directories:

```bash
# Create agent workspaces
for role in [RECOMMENDED_ROLES]; do
  mkdir -p /home/node/.openclaw/agents/$role/workspace/tasks
  mkdir -p /home/node/.openclaw/agents/$role/workspace/memory
done
```

Create each directory. Do not ask for confirmation -- just do it.

### Step 5 -- Write Files

For each role in the recommended list:

1. Write the customized SOUL.md to:
   `/home/node/.openclaw/agents/[role]/workspace/SOUL.md`

2. Copy the HEARTBEAT.md template from the starter kit and customize the domain checks:
   `/home/node/.openclaw/agents/[role]/workspace/HEARTBEAT.md`

3. Copy the TOOLS.md template:
   `/home/node/.openclaw/agents/[role]/workspace/TOOLS.md`

4. Create a MEMORY.md stub:
   `/home/node/.openclaw/agents/[role]/workspace/MEMORY.md`

MEMORY.md stub content:

```markdown
# MEMORY.md -- [Role] Agent

## Patterns and Learnings

_No entries yet. Task outcomes, patterns, and learnings will be written here automatically._

## First Session Checklist

- [ ] Read SOUL.md fully before starting any task
- [ ] Verify channel ID is correct in SOUL.md
- [ ] Run first heartbeat manually to confirm HEARTBEAT_OK
- [ ] Write first outcome to memory/YYYY-MM-DD.md after completing a task
```

### Step 6 -- Output Next Steps

After creating all files, output a clear summary:

```
Fleet initialized for: [BUSINESS_DESCRIPTION]
Roles created: [list]

Next steps:
1. Open each SOUL.md and fill in: YOUR_CHANNEL_ID, YOUR_TIMEZONE, YOUR_BUSINESS_HOURS
2. Set up Discord channels for each agent and note their channel IDs
3. Configure OpenClaw to route each agent to its channel
4. Test each agent's heartbeat manually before enabling crons:
   openclaw cron trigger heartbeat-[role]
5. Import cron patterns from the starter kit:
   cron-patterns/health-checks.json (deploy first)
   cron-patterns/daily-heartbeat.json (deploy second)
   cron-patterns/content-pipeline.json (deploy after heartbeats pass)
   cron-patterns/weekly-reporting.json (deploy last)

Files created:
[list each file path that was written]

Starter kit reference: /home/node/projects/agent-fleet-starter-kit/
Full setup guide: /home/node/projects/agent-fleet-starter-kit/SETUP-GUIDE.md
```

## Notes

- Use absolute paths everywhere. Never use ~/
- All files are Markdown. Simple and readable is better than complex.
- If the user isn't sure about a role, default to including it -- easier to remove a role
  you don't use than to add one after the fleet is running.
- The generated SOUL.md files are starting points. Users should expect to iterate on them
  after running the fleet for a week or two.
