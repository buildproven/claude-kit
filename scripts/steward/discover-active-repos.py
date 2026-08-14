#!/usr/bin/env python3
"""Discover recently active GitHub repos and map them to local checkouts."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse


def run_json(args: list[str]) -> object:
    result = subprocess.run(args, check=True, capture_output=True, text=True)
    return json.loads(result.stdout or "null")


def normalize_remote(value: str) -> str:
    value = value.strip()
    if value.startswith("git@github.com:"):
        value = value.removeprefix("git@github.com:")
    elif "github.com" in value:
        parsed = urlparse(value)
        value = parsed.path.lstrip("/")
    return value.removesuffix(".git").lower()


def local_map(roots: list[str]) -> dict[str, str]:
    mapped: dict[str, str] = {}
    for root_value in roots:
        root = Path(os.path.expanduser(root_value))
        if not root.is_dir():
            continue
        for repo in root.iterdir():
            # A linked worktree has a `.git` file. Fleet operations must map to
            # the primary checkout (`.git` directory), never an ephemeral
            # worktree that may disappear or already contain active changes.
            if not (repo / ".git").is_dir():
                continue
            try:
                remote = subprocess.run(
                    ["git", "-C", str(repo), "remote", "get-url", "origin"],
                    check=True,
                    capture_output=True,
                    text=True,
                ).stdout
            except subprocess.CalledProcessError:
                continue
            # localRoots are ordered by operator preference. Keep the first
            # primary checkout when the same remote exists under more than one
            # root. A later stale clone must not silently replace the
            # canonical checkout used for fleet repair and measurement.
            mapped.setdefault(normalize_remote(remote), str(repo.resolve()))
    return mapped


def is_bot(commit: dict[str, object]) -> bool:
    author = commit.get("author") or {}
    if isinstance(author, dict):
        login = str(author.get("login") or "")
        kind = str(author.get("type") or "")
        if kind.lower() == "bot" or login.lower().endswith("[bot]"):
            return True
    raw = commit.get("commit") or {}
    if isinstance(raw, dict):
        raw_author = raw.get("author") or {}
        if isinstance(raw_author, dict):
            email = str(raw_author.get("email") or "").lower()
            name = str(raw_author.get("name") or "").lower()
            return "[bot]" in name or "dependabot" in email or "bot@" in email
    return False


def classify(repos: list[dict[str, object]], minimum: int) -> list[dict[str, object]]:
    active: list[dict[str, object]] = []
    for repo in repos:
        if repo.get("isArchived"):
            continue
        commits_value = repo.get("commits")
        prs_value = repo.get("pullRequests")
        commits = commits_value if isinstance(commits_value, list) else []
        prs = prs_value if isinstance(prs_value, list) else []
        non_bot = sum(
            1 for commit in commits if isinstance(commit, dict) and not is_bot(commit)
        )
        active_prs = sum(
            1 for pr in prs if isinstance(pr, dict) and not pr.get("isDraft")
        )
        if (len(commits) >= minimum and non_bot >= 1) or active_prs:
            item = dict(repo)
            item["commitCount"] = len(commits)
            item["nonBotCommitCount"] = non_bot
            item["activePullRequestCount"] = active_prs
            active.append(item)
    return sorted(active, key=lambda item: str(item.get("nameWithOwner") or ""))


def collect(config: dict[str, object], since: str) -> list[dict[str, object]]:
    repos: list[dict[str, object]] = []
    owners_value = config.get("owners")
    owners = owners_value if isinstance(owners_value, list) else []
    for owner in owners:
        owner_repos = run_json(
            [
                "gh",
                "repo",
                "list",
                str(owner),
                "--limit",
                "100",
                "--json",
                "nameWithOwner,name,isArchived,defaultBranchRef",
            ]
        )
        if not isinstance(owner_repos, list):
            continue
        for repo in owner_repos:
            if repo.get("isArchived"):
                continue
            full = str(repo["nameWithOwner"])
            branch = str((repo.get("defaultBranchRef") or {}).get("name") or "main")
            commits = run_json(
                [
                    "gh",
                    "api",
                    f"repos/{full}/commits?sha={branch}&since={since}&per_page=100",
                ]
            )
            prs = run_json(
                [
                    "gh",
                    "pr",
                    "list",
                    "--repo",
                    full,
                    "--state",
                    "open",
                    "--json",
                    "isDraft,updatedAt",
                ]
            )
            repo["commits"] = commits if isinstance(commits, list) else []
            repo["pullRequests"] = prs if isinstance(prs, list) else []
            repos.append(repo)
    return repos


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--fixture")
    parser.add_argument("--output")
    args = parser.parse_args()

    config = json.loads(Path(args.config).read_text())
    days = int(config.get("windowDays", 14))
    minimum = int(config.get("minimumCommits", 2))
    if days < 1 or minimum < 1:
        raise SystemExit("windowDays and minimumCommits must be positive")
    since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)).isoformat()

    if args.fixture:
        repos = json.loads(Path(args.fixture).read_text())
    else:
        repos = collect(config, since)
    active = classify(repos, minimum)

    mapped = local_map([str(root) for root in config.get("localRoots", [])])
    include = {str(value).lower() for value in config.get("include", [])}
    exclude = {str(value).lower() for value in config.get("exclude", [])}
    active_names = {str(repo.get("nameWithOwner") or "").lower() for repo in active}
    for repo in repos:
        full = str(repo.get("nameWithOwner") or "").lower()
        if full in include and full not in active_names:
            active.append(repo)
            active_names.add(full)
    active = [repo for repo in active if str(repo.get("nameWithOwner") or "").lower() not in exclude]
    for repo in active:
        repo["localPath"] = mapped.get(str(repo.get("nameWithOwner") or "").lower())
        repo.pop("commits", None)
        repo.pop("pullRequests", None)

    payload = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "windowDays": days,
        "minimumCommits": minimum,
        "repositories": sorted(active, key=lambda item: str(item.get("nameWithOwner") or "")),
    }
    rendered = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    if args.output:
        Path(args.output).write_text(rendered)
    else:
        sys.stdout.write(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
