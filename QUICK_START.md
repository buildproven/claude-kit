# Quick Start: Add Commands to Any Repo

Use this guide to add your `/bs:*` commands to any repository.

## Prerequisites (One-Time Setup)

**Add SSH key to GitHub** (if you haven't already):

```bash
# Generate SSH key (in Codespaces or local machine)
ssh-keygen -t ed25519 -C "your-email@example.com"

# Display public key
cat ~/.ssh/id_ed25519.pub

# Copy the output and add to: https://github.com/settings/keys
```

## Add Commands to a New Repo

**In Codespaces, local CLI, or any git environment:**

```bash
# 1. Navigate to your repo
cd /path/to/your-repo

# 2. Add claude-setup as submodule (SSH URL for private repos)
git submodule add git@github.com:buildproven/claude-setup.git .claude-setup

# 3. Create symlinks
mkdir -p .claude
ln -s ../.claude-setup/commands .claude/commands
ln -s ../.claude-setup/scripts .claude/scripts
ln -s ../.claude-setup/skills .claude/skills

# NOTE: Do NOT symlink CLAUDE.md - each repo should have its own

# 4. Verify it worked
ls -la .claude/commands/bs/

# 5. Commit and push
git add .gitmodules .claude-setup .claude
git commit -m "Add Claude commands via submodule"
git push
```

**That's it!** Commands now work in Web UI and CLI for this repo.

## After Setup

**Commands available:**

- `/bs:dev` - Start development work
- `/bs:quality` - Autonomous quality loop (95% or 98%)
- `/bs:help` - See all commands
- And 10+ more!

**Test it:**
Open the repo in Claude Code Web UI and try `/bs:help`

## Update Commands in All Repos

When you update claude-setup:

```bash
# In any repo using the submodule
cd your-repo
cd .claude-setup
git pull origin main
cd ..
git add .claude-setup
git commit -m "Update Claude commands"
git push
```

## Troubleshooting

**Submodule not cloning?**

```bash
git submodule update --init --recursive
```

**Symlinks broken?**

```bash
ls -la .claude/
# Should show symlinks pointing to ../.claude-setup/
```

**Commands not showing in Web UI?**

- Make sure you pushed the commit to GitHub
- Close and reopen the repo in Web UI
- Check that submodule cloned: `ls .claude-setup/`

## One-Liner (Copy-Paste)

```bash
git submodule add git@github.com:buildproven/claude-setup.git .claude-setup && mkdir -p .claude && ln -s ../.claude-setup/commands .claude/commands && ln -s ../.claude-setup/scripts .claude/scripts && ln -s ../.claude-setup/skills .claude/skills && git add .gitmodules .claude-setup .claude && git commit -m "Add Claude commands via submodule" && git push
```

## What Gets Added

```
your-repo/
├── .claude-setup/          # Submodule (claude-setup)
│   ├── commands/
│   ├── config/
│   ├── scripts/
│   └── skills/
│
├── .claude/
│   ├── CLAUDE.md           # Repo-specific (DO NOT symlink)
│   ├── commands → ../.claude-setup/commands
│   ├── scripts → ../.claude-setup/scripts
│   └── skills → ../.claude-setup/skills
│
└── .gitmodules             # Git submodule config
```

## Benefits

✅ Private repo stays private (SSH authentication)
✅ Single source of truth (update once, applies everywhere)
✅ Works in Web UI, CLI, and for teammates
✅ Easy updates via `git pull` in submodule

---

**Need help?** Check `SUBMODULE_SETUP.md` for detailed explanation.
