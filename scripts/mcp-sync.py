#!/usr/bin/env python3
"""Synchronize a declarative MCP manifest into Claude Code and Codex."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


def run(args: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, check=check, text=True, capture_output=True)


def configured(client: str) -> str:
    try:
        result = run([client, "mcp", "list"], check=False)
    except FileNotFoundError:
        return ""
    return f"{result.stdout}\n{result.stderr}"


def has_server(listing: str, name: str) -> bool:
    for line in listing.splitlines():
        first = line.strip().split(maxsplit=1)[0] if line.strip() else ""
        if first.rstrip(":") == name:
            return True
    return False


def string_list(value: object, label: str) -> list[str]:
    if not isinstance(value, list):
        message = f"{label} must be a list"
        raise SystemExit(message)
    return [str(item) for item in value]


def add_claude(server: dict[str, object]) -> None:
    name = str(server["name"])
    transport = str(server.get("transport", "stdio"))
    if transport == "http":
        args = [
            "claude",
            "mcp",
            "add",
            "--scope",
            "user",
            "--transport",
            "http",
            name,
            str(server["url"]),
        ]
    else:
        args = [
            "claude",
            "mcp",
            "add",
            "--scope",
            "user",
            "--transport",
            "stdio",
            name,
            "--",
        ]
        args.append(str(server["command"]))
        args.extend(string_list(server.get("args", []), f"{name}: args"))
    run(args)


def add_codex(server: dict[str, object]) -> None:
    name = str(server["name"])
    transport = str(server.get("transport", "stdio"))
    if transport == "http":
        # Codex documents configuration and OAuth as separate steps, but some
        # CLI builds start an OAuth callback wait during `mcp add`. Write the
        # supported config.toml form directly so unattended installs cannot
        # stall waiting for a browser. `--login` remains the explicit auth step.
        config_home = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
        config_path = config_home / "config.toml"
        config_home.mkdir(parents=True, exist_ok=True)
        lines = [
            "",
            f"[mcp_servers.{json.dumps(name)}]",
            f"url = {json.dumps(str(server['url']))}",
        ]
        bearer = server.get("bearerTokenEnvVar")
        if bearer:
            lines.append(f"bearer_token_env_var = {json.dumps(str(bearer))}")
        auth = server.get("auth")
        if auth in {"oauth", "chatgpt"}:
            lines.append(f"auth = {json.dumps(str(auth))}")
        with config_path.open("a", encoding="utf8") as config:
            config.write("\n".join(lines) + "\n")
        return
    args = ["codex", "mcp", "add", name, "--", str(server["command"])]
    args.extend(string_list(server.get("args", []), f"{name}: args"))
    run(args)


def remove_server(client: str, name: str) -> None:
    args = [client, "mcp", "remove"]
    if client == "claude":
        args.extend(["--scope", "user"])
    args.append(name)
    run(args)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--check", action="store_true")
    parser.add_argument(
        "--force",
        action="store_true",
        help="replace existing manifest servers so their definitions converge",
    )
    parser.add_argument("--login", action="store_true")
    args = parser.parse_args()
    if args.check and args.force:
        parser.error("--check and --force are mutually exclusive")

    manifest = json.loads(Path(args.manifest).read_text())
    servers = manifest.get("servers", [])
    if not isinstance(servers, list):
        raise SystemExit("manifest servers must be a list")
    claude_listing = configured("claude")
    codex_listing = configured("codex")
    drift: list[str] = []
    auth_needed: list[tuple[str, str]] = []

    for server in servers:
        name = str(server["name"])
        clients = server.get("clients", ["claude", "codex"])
        if not isinstance(clients, list):
            raise SystemExit(f"{name}: clients must be a list")
        if "claude" in clients and has_server(claude_listing, name) and args.force:
            remove_server("claude", name)
            add_claude(server)
        elif "claude" in clients and not has_server(claude_listing, name):
            drift.append(f"claude missing {name}")
            if not args.check:
                add_claude(server)
        if "codex" in clients and has_server(codex_listing, name) and args.force:
            remove_server("codex", name)
            add_codex(server)
        elif "codex" in clients and not has_server(codex_listing, name):
            drift.append(f"codex missing {name}")
            if not args.check:
                add_codex(server)
        if server.get("auth") == "oauth":
            for client in clients:
                auth_needed.append((str(client), name))

    if args.login and not args.check:
        for client, name in auth_needed:
            result = subprocess.run([client, "mcp", "login", name], check=False)
            if result.returncode:
                print(f"{client} MCP login incomplete: {name}", file=sys.stderr)

    if drift:
        print("\n".join(drift))
        if args.check:
            return 1
    print(f"MCP parity: {len(servers)} manifest server(s) checked")
    if auth_needed and not args.login:
        print("OAuth authentication is a separate step: rerun with --login")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
