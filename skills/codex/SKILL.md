---
name: codex
description: "Codex health: ChatGPT auth, native skills, canonical AGENTS, and MCP profile"
---

# Codex Health and Parity Check

Use this skill when you want a fast answer to:

- Is Codex using ChatGPT auth instead of API billing?
- Are curated Claude skills installed natively in Codex?
- Does `~/.codex/AGENTS.md` point at canonical `CLAUDE.md`?
- Are native skills and the MCP profile synchronized?
- What exactly is out of sync if parity drifted?

All commands below use `~/.claude/scripts/`, the installed (symlinked) location —
not a repo-relative path — so this works regardless of which repo's `install.sh`
put the scripts there.

## Default mode

Run the repo health script:

```bash
bash ~/.claude/scripts/codex-check.sh
```

Then summarize the result in 3 sections:

1. **Auth** — chatgpt vs apikey, and whether billing risk exists
2. **Surface** — native skills, canonical instructions, MCP profile
3. **Action** — exact next command if repair is needed

## `--profile` mode

Install one or more explicit Codex skill packs, then re-run health. Packs are
additive to the engineering default. Available pack names vary by installed
overlay — run `--profiles` mode first to list what's actually available:

```bash
bash ~/.claude/scripts/setup-codex-skill-profile.sh --profile <pack[,pack...]>
bash ~/.claude/scripts/codex-check.sh
```

Accept comma-separated packs and the special profiles `default` and `all`.

Example:

```bash
# Claude Code
/bs:codex --profile <pack1>,<pack2>

# Local Codex or Terminal: choose one (permission is required for ~/.agents/skills)
bash ~/.claude/scripts/setup-codex-skill-profile.sh --profile <pack1>,<pack2>
bash ~/.claude/scripts/setup-codex-skill-profile.sh --profile default
```

After activation, CLI/IDE users use `/skills` to browse or explicitly invoke a
linked skill by name. Desktop-app users browse the Skills sidebar. Natural task
descriptions work on every surface. Start a new Codex session if a newly linked
skill does not appear. If Codex cannot write `~/.agents/skills`, run the
canonical command directly in Terminal; the `--profile default` command above
resets to the lean default. It does not restore the previously selected
optional packs.

## `--profiles` mode

List the default skills and every optional pack (packs are discovered from
`config/codex-skill-packs/*.json` in both the kit and any private overlay, so
this reflects exactly what's installed — not a hardcoded list):

```bash
bash ~/.claude/scripts/setup-codex-skill-profile.sh --list
```

## `--mcp-profile` mode

Activate an MCP capability profile across Claude and Codex. Profile names are
defined in `config/mcp.json`'s `profiles` key — read that file (`jq -r '.profiles
| keys[]' config/mcp.json`) for the exact list on this installation, since it
varies by which overlay is installed:

```bash
bash ~/.claude/scripts/setup-mcp-parity.sh --profile <profile> --login
```

## Rules

- Do not print secret values.
- If auth mode is `apikey`, make that the first line of the summary.
- If native-skill or profile drift exists, include the exact repair command.
- Keep the summary concise and factual.
