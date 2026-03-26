#!/usr/bin/env python3
"""Symphony-lite: GitHub issue → acpx agent → PR dispatch loop.

Polls GitHub issues labeled `agent-ready` in a target repo, spawns an acpx
Claude session per issue in an isolated git worktree, then creates a PR on
completion and moves the issue to "Human Review".

Usage:
    python3 scripts/symphony-dispatch.py --repo OWNER/REPO [--label agent-ready]
                                          [--dry-run] [--once]

Flags:
    --repo OWNER/REPO   Target GitHub repository (required)
    --label LABEL       Issue label to poll (default: agent-ready)
    --dry-run           Print what would happen without executing
    --once              Poll once then exit (default: loop every 5 min)
    --interval SECONDS  Polling interval in seconds (default: 300)
    --worktree-root DIR Base directory for worktrees (default: /tmp)
"""

import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

DONE_LABEL = "agent-in-review"
POLL_INTERVAL_DEFAULT = 300  # 5 minutes
WORKTREE_ROOT_DEFAULT = "/tmp"
WORKFLOW_FILENAME = "WORKFLOW.md"


# ---------------------------------------------------------------------------
# Shell helpers
# ---------------------------------------------------------------------------


def run(cmd, *, capture=True, cwd=None, check=True, dry_run=False, label=""):
    """Run a shell command, optionally in dry-run mode."""
    display = cmd if isinstance(cmd, str) else " ".join(str(c) for c in cmd)
    tag = f"[{label}] " if label else ""
    if dry_run:
        print(f"  {tag}DRY-RUN: {display}")
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
    result = subprocess.run(
        cmd,
        shell=isinstance(cmd, str),
        capture_output=capture,
        text=True,
        cwd=cwd,
        check=False,
    )
    if check and result.returncode != 0:
        raise RuntimeError(
            f"Command failed (exit {result.returncode}): {display}\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}"
        )
    return result


def gh(*args, cwd=None, dry_run=False):
    """Run a gh CLI command and return parsed JSON output."""
    cmd = ["gh", *args]
    result = run(cmd, capture=True, cwd=cwd, dry_run=dry_run)
    return result.stdout.strip()


# ---------------------------------------------------------------------------
# GitHub operations
# ---------------------------------------------------------------------------


def fetch_issues(repo, label, dry_run=False):
    """Return list of open issues with the given label as dicts."""
    if dry_run:
        print(f"  DRY-RUN: gh issue list --repo {repo} --label {label} --json ...")
        return []
    raw = gh(
        "issue", "list",
        "--repo", repo,
        "--label", label,
        "--state", "open",
        "--json", "number,title,body,labels,url",
    )
    if not raw:
        return []
    return json.loads(raw)


def add_label(repo, issue_number, label, dry_run=False):
    gh(
        "issue", "edit", str(issue_number),
        "--repo", repo,
        "--add-label", label,
        dry_run=dry_run,
    )


def remove_label(repo, issue_number, label, dry_run=False):
    gh(
        "issue", "edit", str(issue_number),
        "--repo", repo,
        "--remove-label", label,
        dry_run=dry_run,
    )


def comment_on_issue(repo, issue_number, body, dry_run=False):
    gh(
        "issue", "comment", str(issue_number),
        "--repo", repo,
        "--body", body,
        dry_run=dry_run,
    )


def create_pr(repo, base_branch, title, body, branch, cwd, dry_run=False):
    """Create a PR and return the URL."""
    if dry_run:
        print(f"  DRY-RUN: gh pr create --repo {repo} --title '{title}' --head {branch}")
        return "https://github.com/{repo}/pull/DRY-RUN"
    result = run(
        [
            "gh", "pr", "create",
            "--repo", repo,
            "--base", base_branch,
            "--head", branch,
            "--title", title,
            "--body", body,
        ],
        capture=True,
        cwd=cwd,
        dry_run=False,
    )
    return result.stdout.strip()


def get_default_branch(repo, dry_run=False):
    """Return the default branch name for the repo."""
    if dry_run:
        return "main"
    raw = gh(
        "repo", "view", repo,
        "--json", "defaultBranchRef",
        "--jq", ".defaultBranchRef.name",
    )
    return raw.strip() or "main"


def ensure_label_exists(repo, label, color="0075ca", dry_run=False):
    """Create the label if it doesn't exist (idempotent)."""
    if dry_run:
        print(f"  DRY-RUN: ensure label '{label}' exists in {repo}")
        return
    try:
        gh("label", "create", label, "--repo", repo, "--color", color, "--force")
    except RuntimeError:
        pass  # already exists or no permission — non-fatal


# ---------------------------------------------------------------------------
# Worktree operations
# ---------------------------------------------------------------------------


def repo_local_path(repo):
    """Return ~/Projects/<repo-name> if it exists, else None."""
    repo_name = repo.split("/")[-1]
    candidate = Path.home() / "Projects" / repo_name
    if candidate.exists():
        return str(candidate)
    return None


def setup_worktree(repo, issue_number, base_branch, worktree_root, dry_run=False):
    """Clone (or use existing) repo and create an isolated worktree.

    Returns (worktree_path, branch_name, repo_path).
    """
    repo_name = repo.split("/")[-1]
    branch = f"symphony-issue-{issue_number}"
    worktree_path = str(Path(worktree_root) / f"symphony-{issue_number}")

    # Find or clone the repo
    local_repo = repo_local_path(repo)

    if local_repo:
        print(f"  Using existing local repo: {local_repo}")
        repo_path = local_repo
        # Fetch latest
        run(["git", "fetch", "origin"], cwd=repo_path, dry_run=dry_run)
    else:
        # Clone into worktree_root
        clone_path = str(Path(worktree_root) / f"symphony-repo-{repo_name}")
        if not Path(clone_path).exists():
            print(f"  Cloning {repo} into {clone_path}...")
            run(
                ["git", "clone", f"https://github.com/{repo}.git", clone_path],
                capture=True,
                dry_run=dry_run,
            )
        else:
            run(["git", "fetch", "origin"], cwd=clone_path, dry_run=dry_run)
        repo_path = clone_path

    # Remove stale worktree if present
    if Path(worktree_path).exists():
        print(f"  Removing stale worktree at {worktree_path}")
        run(
            ["git", "worktree", "remove", "--force", worktree_path],
            cwd=repo_path,
            check=False,
            dry_run=dry_run,
        )
        shutil.rmtree(worktree_path, ignore_errors=True)

    # Create new worktree on a fresh branch
    run(
        [
            "git", "worktree", "add",
            "-b", branch,
            worktree_path,
            f"origin/{base_branch}",
        ],
        cwd=repo_path,
        dry_run=dry_run,
    )

    return worktree_path, branch, repo_path


def teardown_worktree(repo_path, worktree_path, dry_run=False):
    """Remove the worktree after use."""
    run(
        ["git", "worktree", "remove", "--force", worktree_path],
        cwd=repo_path,
        check=False,
        dry_run=dry_run,
    )
    shutil.rmtree(worktree_path, ignore_errors=True)


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------


def load_workflow_md(worktree_path):
    """Load WORKFLOW.md from the worktree root, if present."""
    workflow_file = Path(worktree_path) / WORKFLOW_FILENAME
    if workflow_file.exists():
        return workflow_file.read_text()
    return (
        "No WORKFLOW.md found in this repo. "
        "Follow standard coding practices: write tests, keep PRs focused, "
        "use conventional commits, and open a PR when done."
    )


def build_prompt(issue, workflow_content):
    """Construct the agent prompt from the issue and WORKFLOW.md."""
    number = issue["number"]
    title = issue["title"]
    body = issue.get("body") or "(no description provided)"
    url = issue.get("url", "")

    return f"""You are an autonomous coding agent implementing a GitHub issue.

## Issue #{number}: {title}
URL: {url}

### Issue Description
{body}

## Workflow Instructions
{workflow_content}

## Your Task
Implement the issue described above following the workflow instructions.
- Work in the current directory (this is an isolated git worktree on branch `symphony-issue-{number}`)
- Make all necessary code changes, write/update tests, update docs
- Commit your changes with conventional commit messages (feat:, fix:, chore:, docs:)
- Do NOT open a PR — Symphony will handle that after you finish
- When done, print exactly: SYMPHONY_DONE
"""


# ---------------------------------------------------------------------------
# Agent session
# ---------------------------------------------------------------------------


def spawn_agent(session_name, prompt, worktree_path, dry_run=False):
    """Spawn an acpx claude session and wait for completion.

    acpx claude -s SESSION_NAME PROMPT  runs the session in the worktree.
    """
    cmd = ["acpx", "claude", "-s", session_name, prompt]
    display = f"acpx claude -s {session_name} '<prompt>'"

    if dry_run:
        print(f"  DRY-RUN: {display}  (cwd={worktree_path})")
        return True

    print(f"  Spawning: {display}")
    result = subprocess.run(
        cmd,
        cwd=worktree_path,
        text=True,
    )
    return result.returncode == 0


# ---------------------------------------------------------------------------
# PR body
# ---------------------------------------------------------------------------


def build_pr_body(issue, session_name):
    number = issue["number"]
    title = issue["title"]
    url = issue.get("url", f"#{number}")
    return (
        f"## Summary\n\n"
        f"Automated implementation of issue #{number}: {title}\n\n"
        f"Closes {url}\n\n"
        f"## Agent Session\n\n"
        f"Session name: `{session_name}`\n\n"
        f"## Review Checklist\n\n"
        f"- [ ] Code logic is correct\n"
        f"- [ ] Tests pass\n"
        f"- [ ] No unintended side effects\n"
        f"- [ ] Ready to merge\n\n"
        f"---\n"
        f"_Generated by Symphony-lite dispatch_"
    )


# ---------------------------------------------------------------------------
# Core dispatch loop
# ---------------------------------------------------------------------------


def dispatch_issue(issue, repo, label, base_branch, worktree_root, dry_run=False):
    """Handle a single issue end-to-end."""
    number = issue["number"]
    title = issue["title"]
    session_name = f"symphony-{number}"
    print(f"\n[Issue #{number}] {title}")

    # 1. Set up worktree
    print(f"  Setting up worktree...")
    worktree_path, branch, repo_path = setup_worktree(
        repo, number, base_branch, worktree_root, dry_run=dry_run
    )

    # 2. Build prompt
    workflow_content = load_workflow_md(worktree_path) if not dry_run else "(workflow content)"
    prompt = build_prompt(issue, workflow_content)

    # 3. Spawn agent
    print(f"  Spawning agent session '{session_name}'...")
    success = spawn_agent(session_name, prompt, worktree_path, dry_run=dry_run)

    if not success:
        print(f"  [Issue #{number}] Agent session failed — skipping PR creation.")
        teardown_worktree(repo_path, worktree_path, dry_run=dry_run)
        return

    # 4. Push branch
    print(f"  Pushing branch '{branch}'...")
    run(
        ["git", "push", "-u", "origin", branch],
        cwd=worktree_path,
        dry_run=dry_run,
    )

    # 5. Create PR
    print(f"  Creating PR...")
    pr_title = f"feat: {title} (symphony-{number})"
    pr_body = build_pr_body(issue, session_name)
    pr_url = create_pr(repo, base_branch, pr_title, pr_body, branch, worktree_path, dry_run=dry_run)
    print(f"  PR created: {pr_url}")

    # 6. Comment on issue with PR link
    comment = f"PR created by Symphony-lite: {pr_url}\n\nMoving to Human Review."
    comment_on_issue(repo, number, comment, dry_run=dry_run)

    # 7. Rotate labels: remove agent-ready, add agent-in-review
    remove_label(repo, number, label, dry_run=dry_run)
    add_label(repo, number, DONE_LABEL, dry_run=dry_run)

    print(f"  [Issue #{number}] Done. Label updated to '{DONE_LABEL}'.")

    # 8. Clean up worktree
    teardown_worktree(repo_path, worktree_path, dry_run=dry_run)


def poll_once(repo, label, base_branch, worktree_root, dry_run=False):
    """Fetch and dispatch all currently labeled issues."""
    print(f"Polling {repo} for issues labeled '{label}'...")
    issues = fetch_issues(repo, label, dry_run=dry_run)

    if not issues:
        print("  No issues found.")
        return

    print(f"  Found {len(issues)} issue(s).")
    for issue in issues:
        dispatch_issue(issue, repo, label, base_branch, worktree_root, dry_run=dry_run)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def parse_args():
    parser = argparse.ArgumentParser(
        description="Symphony-lite: GitHub issue → acpx agent → PR dispatch loop",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--repo",
        required=True,
        metavar="OWNER/REPO",
        help="Target GitHub repository (e.g. buildproven/buildproven)",
    )
    parser.add_argument(
        "--label",
        default="agent-ready",
        help="Issue label to poll (default: agent-ready)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would happen without executing",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Poll once then exit (default: loop every 5 min)",
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=POLL_INTERVAL_DEFAULT,
        metavar="SECONDS",
        help=f"Polling interval in seconds (default: {POLL_INTERVAL_DEFAULT})",
    )
    parser.add_argument(
        "--worktree-root",
        default=WORKTREE_ROOT_DEFAULT,
        metavar="DIR",
        help=f"Base directory for isolated worktrees (default: {WORKTREE_ROOT_DEFAULT})",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    if args.dry_run:
        print("[DRY-RUN MODE] No changes will be made.\n")

    # Verify gh CLI is available
    result = subprocess.run(["gh", "auth", "status"], capture_output=True)
    if result.returncode != 0 and not args.dry_run:
        print("ERROR: gh CLI not authenticated. Run `gh auth login` first.", file=sys.stderr)
        sys.exit(1)

    # Ensure the done label exists
    ensure_label_exists(args.repo, DONE_LABEL, dry_run=args.dry_run)

    base_branch = get_default_branch(args.repo, dry_run=args.dry_run)
    print(f"Target repo:   {args.repo}")
    print(f"Label:         {args.label}")
    print(f"Base branch:   {base_branch}")
    print(f"Worktree root: {args.worktree_root}")
    print(f"Mode:          {'once' if args.once else f'loop every {args.interval}s'}")

    if args.once:
        poll_once(args.repo, args.label, base_branch, args.worktree_root, dry_run=args.dry_run)
    else:
        while True:
            try:
                poll_once(
                    args.repo, args.label, base_branch, args.worktree_root, dry_run=args.dry_run
                )
            except KeyboardInterrupt:
                print("\nInterrupted. Exiting.")
                break
            except Exception as exc:
                print(f"ERROR during poll: {exc}", file=sys.stderr)

            print(f"\nSleeping {args.interval}s until next poll...")
            try:
                time.sleep(args.interval)
            except KeyboardInterrupt:
                print("\nInterrupted. Exiting.")
                break


if __name__ == "__main__":
    main()
