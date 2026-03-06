---
name: bs:git-sync
description: 'One command: commit + push + pull + update docs + deploy + release'
argument-hint: '/bs:git-sync [project] [message] | --all → sync all | --no-release → skip auto-versioning'
category: development
model: sonnet
---

# EXECUTE: Git Sync Command

**This is an imperative command. Execute each step in order.**

## Environment Setup

Set the projects directory (defaults to ~/Projects if not set):

```bash
USER_PROJECTS_DIR="${USER_PROJECTS_DIR:-$HOME/Projects}"
```

## Arguments

Parse any arguments passed after `/bs:git-sync`:

- If `--all` → set SYNC_ALL=true (sync all git repos in $USER_PROJECTS_DIR)
- If `--no-commit` → set SKIP_COMMIT=true
- If `--no-docs` → set SKIP_DOCS=true (skip CHANGELOG/BACKLOG updates)
- If `--no-deploy` → set SKIP_DEPLOY=true (skip Vercel deploy)
- If `--no-release` → set SKIP_RELEASE=true (skip auto-versioning/tagging)
- If `--skip-ci-check` → set SKIP_CI_CHECK=true (bypass pre-push CI validation)
- If `--skip-verify` → set SKIP_VERIFY=true (skip post-deploy verification)
- If `--skip-rollback` → set SKIP_ROLLBACK=true (don't auto-rollback on failure, just report)
- If arg matches a folder in `$USER_PROJECTS_DIR/` → that's the TARGET_PROJECT
- Otherwise → treat as COMMIT_MESSAGE

## Push-to-Main Protection Helper

All `git push` calls MUST use this helper to respect the `block-push-main` hook.

```bash
safe_push() {
  local CURRENT_BRANCH=$(git branch --show-current)
  local MAIN_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")

  # Feature branches push directly
  if [ "$CURRENT_BRANCH" != "$MAIN_BRANCH" ] && [ "$CURRENT_BRANCH" != "master" ]; then
    git push -u origin "$CURRENT_BRANCH"
    return $?
  fi

  # On main: create temp branch -> PR -> squash merge -> back to main
  local SYNC_BRANCH="sync/$(date +%Y%m%d-%H%M%S)"
  local COMMIT_MSG=$(git log -1 --pretty=%s)
  git checkout -b "$SYNC_BRANCH"
  git push -u origin "$SYNC_BRANCH"
  local PR_URL=$(gh pr create --title "$COMMIT_MSG" --body "Auto-created by /bs:git-sync." 2>&1)
  gh pr merge --squash --delete-branch --auto 2>/dev/null || gh pr merge --squash --delete-branch
  git checkout "$MAIN_BRANCH"
  git pull --rebase origin "$MAIN_BRANCH"
}
```

For tag-only pushes, use `git push origin <tag>` directly (tags are not blocked).

## Step 0: Ensure Working Directory is Git Root

```bash
if [[ "$SYNC_ALL" != "true" ]]; then
  GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "Not in a git repository"; exit 1; }
  cd "$GIT_ROOT"
fi
```

## Step 1: Handle --all Flag

If SYNC_ALL is true: find all git repos (`find $USER_PROJECTS_DIR -maxdepth 2 -name ".git" -type d`), run the full sync workflow (Steps 2-3) for each, track results, then jump to Step 4. **Actually commit and push uncommitted changes -- don't just check status.**

## Step 2: Set Variables

- **PROJECT_DIR**: `$USER_PROJECTS_DIR/$TARGET_PROJECT` or current directory
- **PROJECT_NAME**: basename of PROJECT_DIR

## Step 3: Git Sync

### 3a. Handle Feature Branch Auto-Switch

If on a feature/fix/refactor/experiment branch with no uncommitted changes, auto-switch to main. If uncommitted changes exist, exit with "Commit or stash first".

### 3b. Check current state

```bash
git status --short
git diff --name-only
```

### 3c. Handle Git Submodules (CRITICAL - do this before committing!)

If `.gitmodules` exists: update submodules to latest remote (`git submodule update --init --remote`), commit any submodule changes using `safe_push`, then update submodule pointers in parent repo.

**Why:** Submodules must be clean before committing the parent repo. Add submodule paths to `.eslintignore` and `.prettierignore` if ESLint/Prettier fails on submodule files.

### 3d. Commit uncommitted changes (CRITICAL - don't skip!)

If SKIP_COMMIT is false AND there are uncommitted changes: `git add -A` and commit with a smart message from changed files.

### 3e. Pre-Push CI Validation (CS-075)

Skip if SKIP_CI_CHECK=true or no PR exists. Check `gh pr checks` for failures before pushing. Block push if CI failing (show failing checks). Warn but allow if checks pending.

### 3f. Sync with remote (CRITICAL ORDER: fetch -> pull -> push)

```bash
git fetch origin --prune
LOCAL_AHEAD=$(git rev-list --count origin/main..HEAD)
REMOTE_AHEAD=$(git rev-list --count HEAD..origin/main)
```

1. If REMOTE_AHEAD > 0: `git pull --rebase origin main` first
2. If LOCAL_AHEAD > 0: `safe_push`
3. If both 0: already in sync

**If rebase conflicts:** show conflict files, ask user to resolve or offer `git rebase --abort`. Do NOT force push.

### 3g. Verify

```bash
git log --oneline -3
```

### 3h. Update Project Docs (if applicable)

Skip if SKIP_DOCS=true.

- **CHANGELOG.md:** Get commits since last sync/tag, append to [Unreleased] section grouped by type (Added/Changed/Fixed/Removed)
- **BACKLOG.md:** Check off completed items matching recent commits, update priorities, add discoveries as P2/P3

Commit doc updates via `safe_push`.

### 3i. Pre-Deployment CI Validation

Secondary CI gate after push but before deployment. Catches CI failures triggered by the push itself. Blocks deployment if checks fail.

### 3j. Auto-deploy to Vercel (if applicable)

If `.vercel/project.json` or `vercel.json` exists AND commits were pushed AND not `--no-deploy`:

1. Store previous deployment URL for rollback
2. Run `vercel --prod --yes`
3. Store deployment ID

### 3k. Post-Deploy Verification and Rollback (CS-074)

Skip if SKIP_VERIFY=true. After deployment:

1. Load config from `.verifyrc.json` (health checks, rollback strategy, notification settings)
2. Run health checks against deployment URL (configurable endpoints, methods, expected status codes)
3. If critical checks fail and AUTO_ROLLBACK=true:
   - `vercel-promote` strategy: promote previous deployment
   - `git-revert` strategy: revert commit, push, redeploy
   - Log rollback to `.claude/rollback-log.json`
   - Create GitHub issue with failure details and investigation checklist
   - Send Slack/Discord notifications if webhooks configured in `.verifyrc.json`
4. If AUTO_ROLLBACK=false or SKIP_ROLLBACK=true: report failure, provide manual rollback commands

### 3l. Check and setup auto-release workflow (if needed)

If `.github/workflows/auto-release.yml` missing, prompt user to add it. If yes, create the workflow file and commit via `safe_push`.

### 3m. Auto-version and tag (if applicable)

Skip if SKIP_RELEASE=true or no commits pushed.

1. Get commits since last tag
2. Analyze commit types for version bump:
   - `feat!:` or `BREAKING CHANGE:` → MAJOR
   - `feat:` → MINOR
   - `fix:`, `perf:` → PATCH
   - `docs:`, `chore:`, `ci:`, etc. → skip release
3. Calculate and create tag: `git tag -a $NEXT_VERSION -m "Release $NEXT_VERSION"` then `git push origin $NEXT_VERSION`
4. Store release info for summary

## Step 4: Summary

Show table per project: | Repo | Status | Docs | Deploy | Release | Latest Commit |

If releases created, show release details box with version bumps, URLs, and undo instructions (`git tag -d`, `git push origin --delete`, `gh release delete`).

---

## Quick Reference

| Command                        | Effect                                         |
| ------------------------------ | ---------------------------------------------- |
| `/bs:git-sync`                 | Sync + update docs + deploy + release          |
| `/bs:git-sync projectname`     | Sync specific project                          |
| `/bs:git-sync "message"`       | Sync with custom commit message                |
| `/bs:git-sync --all`           | Sync all git repos in ~/Projects               |
| `/bs:git-sync --no-commit`     | Fetch/push/pull only                           |
| `/bs:git-sync --no-docs`       | Skip CHANGELOG/BACKLOG updates                 |
| `/bs:git-sync --no-deploy`     | Skip Vercel deploy                             |
| `/bs:git-sync --no-release`    | Skip auto-versioning/tagging                   |
| `/bs:git-sync --skip-ci-check` | Bypass pre-push CI validation (emergency only) |
| `/bs:git-sync --skip-verify`   | Skip post-deploy verification                  |
| `/bs:git-sync --skip-rollback` | Don't auto-rollback on failure (just report)   |

## Deployment Safety Features (CS-074, CS-075)

- **Pre-push CI validation (CS-075):** Blocks push if existing CI checks failing. Override: `--skip-ci-check`
- **Pre-deployment CI validation:** Secondary gate after push, before deploy. Catches push-triggered failures
- **Auto-rollback (CS-074):** Health checks from `.verifyrc.json`, auto-rollback via `vercel-promote` or `git-revert`, GitHub issue + Slack/Discord notifications, audit trail in `.claude/rollback-log.json`. Override: `--skip-verify` or `--skip-rollback`

## Setup Required

For auto-release, each repo needs `.github/workflows/auto-release.yml`:

```yaml
name: Auto Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Get previous tag
        id: prev_tag
        run: |
          PREV_TAG=$(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || echo "")
          echo "tag=$PREV_TAG" >> $GITHUB_OUTPUT

      - name: Generate release notes
        run: |
          TAG=${GITHUB_REF#refs/tags/}
          PREV_TAG=${{ steps.prev_tag.outputs.tag }}
          if [ -n "$PREV_TAG" ]; then
            echo "## Changes since $PREV_TAG" > notes.md
            git log ${PREV_TAG}..${TAG} --pretty=format:"- %s" >> notes.md
            echo -e "\n\n**Full Changelog**: https://github.com/${{ github.repository }}/compare/${PREV_TAG}...${TAG}" >> notes.md
          else
            echo "Initial release" > notes.md
          fi

      - uses: softprops/action-gh-release@v2
        with:
          body_path: notes.md
```
