#!/usr/bin/env python3
"""Run a command with a hard wall-clock deadline for its whole process group."""

from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import time


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--timeout-seconds", type=int, required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.timeout_seconds < 1:
        parser.error("--timeout-seconds must be positive")
    if args.command and args.command[0] == "--":
        args.command = args.command[1:]
    if not args.command:
        parser.error("a command is required after --")
    return args


def terminate_group(process: subprocess.Popen[bytes]) -> None:
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=10)
        return
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        return
    process.wait()


def main() -> int:
    args = parse_args()
    # This utility is explicitly a command runner; argv comes from its operator.
    process = subprocess.Popen(args.command, start_new_session=True)  # noqa: S603
    deadline = time.monotonic() + args.timeout_seconds

    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                terminate_group(process)
                print(
                    f"deadline exceeded after {args.timeout_seconds}s",
                    file=sys.stderr,
                )
                return 124
            try:
                return process.wait(timeout=min(remaining, 1.0))
            except subprocess.TimeoutExpired:
                continue
    except KeyboardInterrupt:
        terminate_group(process)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
