#!/usr/bin/env python3
"""Run a command with a hard wall-clock deadline for its whole process group."""

from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import time
from types import FrameType


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--timeout-seconds", type=int, required=True)
    parser.add_argument("--watch-parent-pid", type=int)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.timeout_seconds < 1:
        parser.error("--timeout-seconds must be positive")
    if args.watch_parent_pid is not None and args.watch_parent_pid < 1:
        parser.error("--watch-parent-pid must be positive")
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
    grace_deadline = time.monotonic() + 10
    while time.monotonic() < grace_deadline:
        process.poll()
        # Darwin may report EPERM for killpg(pgid, 0) after the group exits.
        # Inspect live members instead, including descendants after leader exit.
        members = subprocess.check_output(  # noqa: S603
            ["ps", "-axo", "pgid=,stat="], text=True
        )
        if not any(
            fields[0] == str(process.pid) and not fields[1].startswith("Z")
            for row in members.splitlines()
            if len(fields := row.split()) == 2
        ):
            process.wait()
            return
        time.sleep(0.1)
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        process.wait()
        return
    process.wait()


def main() -> int:
    args = parse_args()
    if args.watch_parent_pid is not None and os.getppid() != args.watch_parent_pid:
        return 130
    interrupted = False

    def cancel(_signum: int, _frame: FrameType | None) -> None:
        nonlocal interrupted
        interrupted = True

    signal.signal(signal.SIGTERM, cancel)
    # This utility is explicitly a command runner; argv comes from its operator.
    process = subprocess.Popen(args.command, start_new_session=True)  # noqa: S603
    deadline = time.monotonic() + args.timeout_seconds

    try:
        while True:
            if interrupted or (
                args.watch_parent_pid is not None
                and os.getppid() != args.watch_parent_pid
            ):
                terminate_group(process)
                return 130
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
