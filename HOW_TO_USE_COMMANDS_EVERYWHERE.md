# How to Use Your Commands in Any Repo

Since you're using **Claude Code Web UI** (which runs in temporary containers), you need to add commands to **each repository** you want to use them in.

## Quick Setup for Any Repo

### Option 1: Copy Commands Manually

In any repo where you want commands:

```bash
# Create .claude/commands directory
mkdir -p .claude/commands

# Copy command directories
cp -r /path/to/claude-setup/commands/bs .claude/commands/
cp -r /path/to/claude-setup/commands/gh .claude/commands/
cp -r /path/to/claude-setup/commands/cc .claude/commands/

# Commit to git
git add .claude
git commit -m "Add Claude Code commands"
git push
```

### Option 2: Use the Install Script

If `claude-setup` is accessible in your session:

```bash
# From any repo
/path/to/claude-setup/scripts/install-commands-to-repo.sh

# Then commit
git add .claude
git commit -m "Add Claude Code commands"
git push
```

### Option 3: Download and Run (If repo is public)

```bash
# From any repo
curl -sL https://raw.githubusercontent.com/YOUR-USERNAME/claude-setup/main/scripts/install-commands-to-repo.sh | bash

# Then commit
git add .claude
git commit -m "Add Claude Code commands"
git push
```

## What Gets Installed

After running, your repo will have:

```
your-repo/
└── .claude/
    └── commands/
        ├── bs/
        │   ├── dev.md          → /bs:dev
        │   ├── build.md        → /bs:build
        │   ├── ship.md         → /bs:ship
        │   ├── git-sync.md     → /bs:git-sync
        │   └── ... (21 total)
        ├── gh/
        │   ├── review-pr.md    → /gh:review-pr
        │   └── fix-issue.md    → /gh:fix-issue
        └── cc/
            ├── optimize.md     → /cc:optimize
            └── create-command.md → /cc:create-command
```

## Essential Commands Only (Minimal Setup)

If you only want the most-used commands, manually copy just these:

```bash
mkdir -p .claude/commands/bs .claude/commands/gh

# Copy essentials
cp claude-setup/commands/bs/dev.md .claude/commands/bs/
cp claude-setup/commands/bs/sync.md .claude/commands/bs/
cp claude-setup/commands/bs/help.md .claude/commands/bs/
cp claude-setup/commands/gh/review-pr.md .claude/commands/gh/
```

## Understanding the Architecture

### Where You Are Now

```
┌─────────────────────────────────────────┐
│ Your Windows PC                         │
│ (No Claude Code files needed here)     │
└─────────────────────────────────────────┘
                 │
                 │ Opens Web UI
                 ▼
┌─────────────────────────────────────────┐
│ Anthropic's Server (Linux container)   │
│                                         │
│ Clones your git repo:                  │
│   your-repo/                           │
│   └── .claude/                         │
│       └── commands/  ← Must be in git! │
│           └── bs/                      │
└─────────────────────────────────────────┘
```

### Why Commands Must Be in Git

- Web UI = Temporary container (resets every session)
- Only persistent storage = Git repositories
- Commands in `.claude/commands/` must be committed to git
- When you open the repo → commands are there!

## For Windows/Mac/Linux Local Development

If you're using Claude Code **CLI** (not Web UI), the setup is different:

### One-Time Global Setup (CLI only)

```bash
# Clone your setup repo
git clone YOUR-REPO ~/Projects/claude-setup

# Run setup once
cd ~/Projects/claude-setup
./scripts/setup-claude-sync.sh

# Done! Commands work everywhere via ~/.claude/ symlinks
```

**Note:** This ONLY works for CLI, not Web UI.

## Updating Commands

When you update commands in `claude-setup`:

### For Web UI Users

You need to re-copy to each repo:

```bash
# In each repo
/path/to/claude-setup/scripts/install-commands-to-repo.sh
git add .claude
git commit -m "Update Claude commands"
git push
```

### For CLI Users

Changes are immediate (symlinked):

```bash
# Edit in claude-setup
vim ~/Projects/claude-setup/commands/bs/dev.md

# Already works everywhere via symlink!
```

## FAQ

**Q: Do I need to do this for every repo?**
A: For Web UI, yes. For CLI, no (one-time global setup).

**Q: Can I pick which commands to include?**
A: Yes! Just copy the specific `.md` files you want.

**Q: Will this work on my coworker's machine?**
A: Yes, if they clone the repo (commands are in git).

**Q: What if I'm on a Mac/PC/Linux?**
A: Same process for Web UI. For CLI, run the setup script once.

**Q: How do I know if I'm using Web UI or CLI?**
A: Web UI = Opens in browser. CLI = Terminal/command line.

## Summary

**Web UI (what you're using):**

- ✅ Copy commands to `.claude/commands/` in each repo
- ✅ Commit to git
- ✅ Commands work across all sessions

**CLI (optional):**

- ✅ Run setup script once
- ✅ Commands work everywhere via `~/.claude/`
