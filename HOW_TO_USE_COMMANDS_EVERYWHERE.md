# How to Use Your Commands in Any Repo

If you're using Claude Code Web UI, commands need to live in the repository you open.

## Quick setup

### Option 1: Copy commands manually

```bash
mkdir -p .claude/commands
cp -r /path/to/claude-power-kit/commands/bs .claude/commands/
cp -r /path/to/claude-power-kit/commands/gh .claude/commands/
cp -r /path/to/claude-power-kit/commands/cc .claude/commands/

git add .claude
git commit -m "Add Claude Code commands"
git push
```

### Option 2: Use the install script

```bash
/path/to/claude-power-kit/scripts/install-commands-to-repo.sh

git add .claude
git commit -m "Add Claude Code commands"
git push
```

### Option 3: Download and run

```bash
curl -sL https://raw.githubusercontent.com/YOUR-USERNAME/claude-power-kit/main/scripts/install-commands-to-repo.sh | bash

git add .claude
git commit -m "Add Claude Code commands"
git push
```

## Minimal setup

If you only want the essentials:

```bash
mkdir -p .claude/commands/bs .claude/commands/gh

cp claude-power-kit/commands/bs/dev.md .claude/commands/bs/
cp claude-power-kit/commands/bs/quality.md .claude/commands/bs/
cp claude-power-kit/commands/bs/help.md .claude/commands/bs/
cp claude-power-kit/commands/gh/review-pr.md .claude/commands/gh/
```

## CLI setup

For Claude Code CLI:

```bash
git clone YOUR-REPO ~/Projects/claude-power-kit
cd ~/Projects/claude-power-kit
./scripts/setup-claude-sync.sh
```

That installs the commands globally through `~/.claude`.
