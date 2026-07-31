// Shared temporary-directory helper for the test suites.
//
// Most suites here shell out to real git, real bash, and real npm, so they need
// real directories on disk rather than a mocked filesystem. They created those
// with a bare `mkdtempSync` and never removed them, which leaks a tree per test
// into whatever TMPDIR points at — 172 directories / 24MB were observed from a
// single run. When TMPDIR points inside the repo (sessions are told to use a
// scratch dir rather than /tmp), those leaked trees also get walked by tools
// that scan the working tree.
//
// `makeTempDir()` registers each directory for removal in an `afterAll` hook
// belonging to the calling suite file, so cleanup needs no per-test bookkeeping.
//
// Cleanup is deliberately forgiving. A test that leaves behind a git worktree,
// a read-only file, or a directory another process still holds must not fail
// the suite during teardown — the assertions already passed at that point.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

const pending = new Set();

function removeAll() {
  for (const dir of pending) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Teardown must never fail a suite whose assertions already passed.
    }
  }
  pending.clear();
}

// Registered at MODULE LOAD, not lazily on first use. Vitest collects hooks
// during the collection phase; an `afterAll` registered from inside a running
// test body is never attached to the suite, so a lazy version silently cleaned
// up nothing. Importing this module is what opts a file into cleanup — an
// unused import just registers a hook over an empty set.
afterAll(removeAll);

/**
 * Create a temporary directory that is removed when the suite finishes.
 *
 * @param {string} prefix Short label for the directory name, e.g. "quality-".
 * @returns {string} Absolute path to the new directory.
 */
export function makeTempDir(prefix = "kit-test-") {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  pending.add(dir);
  return dir;
}

/**
 * Track a directory this module did not create (e.g. a sibling worktree path
 * derived from a tracked root) so it is removed alongside the rest.
 */
export function trackTempDir(dir) {
  pending.add(dir);
  return dir;
}
