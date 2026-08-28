#!/usr/bin/env python3
"""Validate and record a secret-free MCP parity state fingerprint."""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import stat
import tempfile
from pathlib import Path

SCHEMA_VERSION = 1
CACHE_DIRECTORY_ERROR = "MCP parity cache directory is not owner-controlled"
CACHE_FILE_ERROR = "MCP parity cache is not an owner-controlled regular file"


def file_identity(path: Path) -> dict[str, object]:
    try:
        resolved = path.resolve(strict=True)
        metadata = resolved.stat()
        content = resolved.read_bytes()
    except (FileNotFoundError, OSError):
        return {"path": str(path), "state": "missing"}
    if not stat.S_ISREG(metadata.st_mode):
        return {"path": str(path), "state": "not-regular"}
    return {
        "path": str(resolved),
        "state": "regular",
        "sha256": hashlib.sha256(content).hexdigest(),
    }


def executable_identity(path: Path) -> dict[str, object]:
    try:
        resolved = path.resolve(strict=True)
        metadata = resolved.stat()
    except (FileNotFoundError, OSError):
        return {"path": str(path), "state": "missing"}
    return {
        "path": str(resolved),
        "state": "present",
        "size": metadata.st_size,
        "mtimeNs": metadata.st_mtime_ns,
    }


def fingerprint(args: argparse.Namespace) -> str:
    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "profile": args.profile,
        "sources": [file_identity(Path(value)) for value in args.source],
        "clientConfigs": [file_identity(Path(value)) for value in args.client_config],
        "clientExecutables": [
            executable_identity(Path(value)) for value in args.client_executable
        ],
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf8")).hexdigest()


def cache_payload(path: Path) -> dict[str, object] | None:
    try:
        metadata = path.lstat()
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid():
            return None
        payload = json.loads(path.read_text(encoding="utf8"))
    except (FileNotFoundError, OSError, ValueError, TypeError):
        return None
    return payload if isinstance(payload, dict) else None


def cache_hit(args: argparse.Namespace) -> bool:
    payload = cache_payload(Path(args.cache))
    return bool(
        payload
        and payload.get("schemaVersion") == SCHEMA_VERSION
        and payload.get("profile") == args.profile
        and payload.get("fingerprint") == fingerprint(args)
    )


def prepare(args: argparse.Namespace) -> Path:
    cache = Path(args.cache)
    parent = cache.parent
    parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    parent_metadata = parent.lstat()
    if (
        not stat.S_ISDIR(parent_metadata.st_mode)
        or parent_metadata.st_uid != os.getuid()
    ):
        raise SystemExit(CACHE_DIRECTORY_ERROR)
    parent.chmod(0o700)
    return cache


def record(args: argparse.Namespace) -> None:
    cache = prepare(args)
    parent = cache.parent
    try:
        cache_metadata = cache.lstat()
        if (
            not stat.S_ISREG(cache_metadata.st_mode)
            or cache_metadata.st_uid != os.getuid()
        ):
            raise SystemExit(CACHE_FILE_ERROR)
    except FileNotFoundError:
        pass
    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "profile": args.profile,
        "fingerprint": fingerprint(args),
    }
    descriptor, temporary = tempfile.mkstemp(prefix=f".{cache.name}.", dir=parent)
    temporary_path = Path(temporary)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf8") as output:
            json.dump(payload, output, sort_keys=True, separators=(",", ":"))
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        temporary_path.replace(cache)
    except BaseException:
        with contextlib.suppress(OSError):
            os.close(descriptor)
        with contextlib.suppress(FileNotFoundError):
            temporary_path.unlink()
        raise


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("hit", "prepare", "record"))
    parser.add_argument("--cache", required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--source", action="append", default=[], required=True)
    parser.add_argument("--client-config", action="append", default=[], required=True)
    parser.add_argument(
        "--client-executable", action="append", default=[], required=True
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.command == "hit":
        return 0 if cache_hit(args) else 1
    if args.command == "prepare":
        prepare(args)
        return 0
    record(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
