#!/usr/bin/env bash
# quality-bootstrap.sh — Step -1 of the quality skill: resolve the audit
# target (PR / branch / worktree / cwd), enforce worktree discipline, and
# initialize the run-governor sentinel.
#
# This is invoked (not sourced) as: bash quality-bootstrap.sh "$@"
# It prints machine-readable lines to stdout for the caller to eval/read:
#   BS_QUALITY_ROOT_FILE=<path>
#   BS_QUALITY_GOVERNOR_FILE=<path>
#   GIT_ROOT=<path>
# and exits non-zero (with a human-readable error already on stdout/stderr)
# if target resolution fails.
#
# WHY THIS EXISTS AS A SCRIPT, NOT INLINE BASH IN SKILL.md (2026-07-11, #70):
# SKILL.md content is re-attached after auto-compaction but ONLY the first
# ~5,000 tokens of each skill survive — see
# https://code.claude.com/docs/en/skills#skill-content-lifecycle. This ~340
# line block was itself blowing that budget before any of the actual gates
# were reached. Moving it here means SKILL.md just calls the script and
# reads its output; the resolution LOGIC is unchanged.
set -u

# --- args-file bridge (bug fixed 2026-05-12) --------------------------------
# The /bs:quality slash command writes the user's $ARGUMENTS to a tempfile
# and passes the path here as --args-file <path>. This is the reliable
# channel for getting args into a forked Skill execution; the runtime does
# not propagate `Skill(args=...)` to the fork's $@ on its own.
#
# We extract --args-file from $@ and, if found, REPLACE $@ with the file
# contents (preserving any other args that were passed alongside).
# The file is removed once read, so concurrent quality invocations
# don't pile up stale state.
ARGS_FILE=""
REMAINING_ARGS=()
prev_arg=""
for arg in "$@"; do
  case "$prev_arg" in
    --args-file)
      ARGS_FILE="$arg"
      prev_arg=""
      continue
      ;;
  esac
  case "$arg" in
    --args-file)
      prev_arg="--args-file"
      continue
      ;;
    --args-file=*)
      ARGS_FILE="${arg#*=}"
      continue
      ;;
  esac
  REMAINING_ARGS+=("$arg")
  prev_arg=""
done

if [ -n "$ARGS_FILE" ] && [ -f "$ARGS_FILE" ]; then
  # Read the file, strip trailing newline, split on whitespace into args.
  # Use a subshell + xargs to safely tokenize without eval.
  FILE_ARGS=()
  while IFS= read -r tok; do
    [ -n "$tok" ] && FILE_ARGS+=("$tok")
  done < <(xargs -n1 < "$ARGS_FILE" 2>/dev/null)
  # Defensive: only unlink files inside the expected mktemp -d directory.
  # The slash command writes to `<tmpdir>/bs-quality-args.XXXXXX/args.txt`.
  # If a caller passes an unexpected path (e.g. a config file by mistake),
  # leave it alone rather than deleting it.
  case "$ARGS_FILE" in
    */bs-quality-args.*/args.txt|*/bs-quality-args-*.txt)
      rm -f "$ARGS_FILE"
      # Also try to rmdir the parent (only succeeds if empty — which it
      # will be, since args.txt was the only file inside).
      ARGS_PARENT=$(dirname "$ARGS_FILE")
      case "$ARGS_PARENT" in
        */bs-quality-args.*)
          rmdir "$ARGS_PARENT" 2>/dev/null || true
          ;;
      esac
      ;;
    *)
      echo "[quality] WARNING: --args-file path does not match the expected" >&2
      echo "  bs-quality-args.*/args.txt pattern; leaving it in place: $ARGS_FILE" >&2
      ;;
  esac
  # Use file args ONLY if the caller didn't already pass concrete args
  # alongside --args-file (belt-and-suspenders mode). The file is the
  # fallback; explicit args win.
  if [ "${#REMAINING_ARGS[@]}" -gt 0 ]; then
    set -- "${REMAINING_ARGS[@]}"
  elif [ "${#FILE_ARGS[@]}" -gt 0 ]; then
    set -- "${FILE_ARGS[@]}"
  else
    set --
  fi
fi

# --- Recursion guard (2026-06-04 wrapper-recursion incident) -----------------
# The synchronous review leg runs each review agent as a blocking `claude -p`
# subprocess with BS_QUALITY_HEADLESS=1 exported. If one of those review
# children — via a hook, an agent, or a stray /goal — ever re-enters
# /bs:quality, we would recurse (fork → review child → fork …). Hard-refuse
# when we detect we are already inside a headless review child.
if [ "${BS_QUALITY_HEADLESS:-}" = "1" ]; then
  echo "❌ /bs:quality refused: already running inside a headless review child" >&2
  echo "   (BS_QUALITY_HEADLESS=1). Review subprocesses must not re-enter the" >&2
  echo "   quality skill — this guard prevents fork→child→fork recursion." >&2
  exit 1
fi

# Clear any STALE review-panel sentinel from a prior run in this session before
# the pipeline starts. The sentinel is session-namespaced, not run-namespaced,
# so without this a run that SKIPS agent selection (e.g. --scope changed, which
# skips agent-panel construction) could let the companion block read a
# previous run's panel and review the wrong set — or, worse, mask an "agents
# never selected" bug. Fresh run => empty sentinel => the companion block's
# empty-check blocks correctly.
QUALITY_SESSION_ID="${CLAUDE_CODE_SESSION_ID:-${CODEX_THREAD_ID:-default}}"
QUALITY_SESSION_ID="$(printf '%s' "$QUALITY_SESSION_ID" | tr -cd '[:alnum:]_.-' | cut -c1-80)"
[ -n "$QUALITY_SESSION_ID" ] || QUALITY_SESSION_ID=default
rm -f "${TMPDIR:-/tmp}/bs-quality-agents-${QUALITY_SESSION_ID}.txt"

# --- resolve the target-resolver script --------------------------------------
RESOLVER=""
for candidate in \
  "${CLAUDE_SETUP_ROOT:-}/scripts/quality-target-resolver.js" \
  "${CLAUDE_PLUGIN_ROOT:-}/../scripts/quality-target-resolver.js" \
  "$HOME/.claude/scripts/quality-target-resolver.js"; do
  if [ -n "$candidate" ] && [ -f "$candidate" ]; then
    RESOLVER="$candidate"; break
  fi
done

if [ -z "$RESOLVER" ]; then
  # Resolver missing — fall back to the legacy --target-dir-only behavior.
  # This preserves backwards compatibility in environments where the overlay
  # repo isn't checked out, at the cost of losing PR/branch resolution.
  echo "[quality] WARNING: quality-target-resolver.js not found — falling back to legacy --target-dir parsing." >&2
  TARGET_DIR=""
  prev_arg=""
  for arg in "$@"; do
    case "$prev_arg" in
      --target-dir|--target) TARGET_DIR="$arg" ;;
    esac
    case "$arg" in
      --target-dir=*|--target=*) TARGET_DIR="${arg#*=}" ;;
    esac
    prev_arg="$arg"
  done
  if [ -z "$TARGET_DIR" ] && [ -n "${BS_QUALITY_TARGET_DIR:-}" ]; then
    TARGET_DIR="$BS_QUALITY_TARGET_DIR"
  fi
  if [ -n "$TARGET_DIR" ]; then
    TARGET_DIR="${TARGET_DIR/#\~/$HOME}"
    [ -d "$TARGET_DIR" ] || { echo "❌ target dir does not exist: $TARGET_DIR"; exit 1; }
    cd "$TARGET_DIR" || exit 1
  fi
else
  # Use the resolver. It returns a JSON plan we act on.
  PRIMARY_CHECKOUT=$(git worktree list --porcelain 2>/dev/null \
    | awk '/^worktree / {p=$2} /^branch refs\/heads\/main$/ {print p; exit}')
  CWD_INPUT=$(pwd)

  RESOLUTION_JSON=$(QUALITY_CWD="$CWD_INPUT" \
                    QUALITY_PRIMARY_CHECKOUT="$PRIMARY_CHECKOUT" \
                    node "$RESOLVER" --cli "$@" 2>/dev/null) || RESOLUTION_JSON=""

  if [ -n "$RESOLUTION_JSON" ]; then
    RES_OK=$(echo "$RESOLUTION_JSON" | jq -r '.ok // false' 2>/dev/null)
    RES_KIND=$(echo "$RESOLUTION_JSON" | jq -r '.resolution // ""' 2>/dev/null)
    RES_PATH=$(echo "$RESOLUTION_JSON" | jq -r '.targetPath // ""' 2>/dev/null)
    RES_BRANCH=$(echo "$RESOLUTION_JSON" | jq -r '.targetBranch // ""' 2>/dev/null)
    RES_REASON=$(echo "$RESOLUTION_JSON" | jq -r '.reason // ""' 2>/dev/null)
    RES_WARNINGS=$(echo "$RESOLUTION_JSON" | jq -r '.warnings[]?' 2>/dev/null)

    if [ -n "$RES_WARNINGS" ]; then
      echo ""
      echo "============================================================"
      echo "  [quality] TARGET RESOLUTION WARNINGS"
      echo "============================================================"
      echo "$RES_WARNINGS" | sed 's/^/  /'
      echo "============================================================"
      echo ""
    fi

    if [ "$RES_OK" != "true" ]; then
      echo "❌ /bs:quality could not resolve an audit target."
      echo "   Reason: $RES_REASON"
      echo "   Resolution: $RES_KIND"
      exit 1
    fi

    if [ "$RES_KIND" = "pr" ] || [ "$RES_KIND" = "branch" ]; then
      if [ -z "$RES_PATH" ] && [ -n "$RES_BRANCH" ]; then
        # No local worktree for the branch — materialize one in a sibling dir.
        REPO_ROOT_FOR_WT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
        REPO_NAME=$(basename "$REPO_ROOT_FOR_WT")
        SLUG=$(echo "$RES_BRANCH" | tr '/' '-' )
        RES_PATH="${REPO_ROOT_FOR_WT%/*}/${REPO_NAME}-${SLUG}"
        if [ ! -d "$RES_PATH" ]; then
          git fetch origin "$RES_BRANCH" 2>/dev/null || true
          git worktree add "$RES_PATH" "$RES_BRANCH" 2>/dev/null \
            || git worktree add -B "$RES_BRANCH" "$RES_PATH" "origin/$RES_BRANCH" \
            || { echo "❌ Could not materialize worktree for $RES_BRANCH at $RES_PATH"; exit 1; }
        fi
      fi
    fi

    if [ -n "$RES_PATH" ]; then
      echo "[quality] audit target: $RES_PATH (resolution=$RES_KIND${RES_BRANCH:+, branch=$RES_BRANCH})"
      cd "$RES_PATH" || { echo "❌ failed to cd to $RES_PATH"; exit 1; }
    fi
  fi
fi

GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$GIT_ROOT" ]; then
  echo "❌ /bs:quality could not resolve a git root from $(pwd)."
  echo "   Pass --target-dir <path>, a PR number (#NNN), or a branch name,"
  echo "   or export BS_QUALITY_TARGET_DIR=<path> in the spawning agent harness."
  exit 1
fi
cd "$GIT_ROOT" || exit 1

# Worktree discipline: when --merge is requested, refuse to run from the
# primary checkout's main branch. The resolver already hard-refuses the
# "no target specified + --merge" case; this is the belt-and-suspenders check
# for the "I cd'd into the primary checkout and asked for --merge" case.
ARGS_MERGE=false
for arg in "$@"; do
  case "$arg" in
    --merge|--merge=*) ARGS_MERGE=true; break ;;
  esac
done

if [ "$ARGS_MERGE" = true ]; then
  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
  PRIMARY=$(git worktree list --porcelain | awk '/^worktree / {p=$2} /^branch refs\/heads\/main$/ {print p; exit}')
  if [ "$CURRENT_BRANCH" = "main" ] && [ -n "$PRIMARY" ] && [ "$GIT_ROOT" = "$PRIMARY" ]; then
    echo "❌ /bs:quality --merge cannot run from the primary checkout on main."
    echo "   Create a worktree first:"
    echo "     git worktree add ../$(basename "$GIT_ROOT")-worktrees/<slug> -b <type>/<slug> main"
    echo "   Move uncommitted changes there with: git stash; cd <worktree>; git stash pop"
    exit 1
  fi
fi

# --- persist resolved git root for downstream bash blocks --------------------
# See quality-load-root.sh for why this sentinel dance exists (each Bash tool
# call is a fresh shell) and why it's hashed per-target (multi-repo sessions).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=quality-load-root.sh
source "$SCRIPT_DIR/quality-load-root.sh" 2>/dev/null || true  # defines bs_quality_root_file/bs_quality_find_script; cd is re-done below anyway
BS_QUALITY_ROOT_FILE=$(bs_quality_root_file "$GIT_ROOT")
if ! printf '%s\n' "$GIT_ROOT" > "$BS_QUALITY_ROOT_FILE" 2>/dev/null; then
  echo "❌ /bs:quality could not write git-root sentinel to $BS_QUALITY_ROOT_FILE"
  echo "   Check that \$TMPDIR is writable: ${TMPDIR:-/tmp}"
  exit 1
fi

# --- run-governor init (2026-07-03: runaway-loop guardrails) -----------------
# Incident: two PRs in one night (#529: 128min/6 commits, #532: 167min/13
# commits) ran to completion with no circuit breaker. CODEX_ROUNDS only bounds
# the inner Codex adversarial loop; nothing bounded the OUTER cycle of
# BLOCKING-finding -> auto-fix -> re-review across the whole invocation.
# See reference.md "Run Governor" for the full incident writeup.
#
# max_review_rounds is enforced by `bump-round` immediately before the review
# panel — this is what actually terminates the outer fix -> re-review loop.
BS_QUALITY_MAX_REVIEW_ROUNDS="${BS_QUALITY_MAX_REVIEW_ROUNDS:-2}"
BS_QUALITY_MAX_FIX_COMMITS="${BS_QUALITY_MAX_FIX_COMMITS:-4}"
BS_QUALITY_MAX_WALL_SECONDS="${BS_QUALITY_MAX_WALL_SECONDS:-900}"
BS_QUALITY_GOVERNOR_FILE="${BS_QUALITY_ROOT_FILE%.txt}-governor.json"
# A fresh invocation starts with a full-branch review. Only re-review rounds
# inside this invocation may use the last-successful-review delta.
rm -f "${BS_QUALITY_GOVERNOR_FILE%.json}-last-reviewed.sha"
GOVERNOR_START_EPOCH=$(date +%s)
# Baseline the run by HEAD SHA, not by total commit count. The governor counts
# fix-commits as `<start_commit_sha>..HEAD`, which is immune to rebases and to
# the cwd/checkout the later `check` runs from. The old total-count delta
# tripped falsely under `--merge <PR>` (baseline in the PR worktree, check from
# a differently-based HEAD → bogus cross-baseline delta; 2026-07-14). We still
# record start_commit_count for legacy readers / diagnostics.
GOVERNOR_START_COMMIT_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")
GOVERNOR_START_COMMIT_COUNT=$(git rev-list --count HEAD 2>/dev/null || echo 0)
cat > "$BS_QUALITY_GOVERNOR_FILE" <<EOF
{
  "start_epoch": ${GOVERNOR_START_EPOCH},
  "start_commit_sha": "${GOVERNOR_START_COMMIT_SHA}",
  "start_commit_count": ${GOVERNOR_START_COMMIT_COUNT},
  "max_fix_commits": ${BS_QUALITY_MAX_FIX_COMMITS},
  "max_wall_seconds": ${BS_QUALITY_MAX_WALL_SECONDS},
  "max_review_rounds": ${BS_QUALITY_MAX_REVIEW_ROUNDS},
  "rounds_used": 0,
  "findings_seen": []
}
EOF

echo "BS_QUALITY_ROOT_FILE=$BS_QUALITY_ROOT_FILE"
echo "BS_QUALITY_GOVERNOR_FILE=$BS_QUALITY_GOVERNOR_FILE"
echo "GIT_ROOT=$GIT_ROOT"
echo "[quality] audit target resolved: $GIT_ROOT"
echo "[quality] governor: cap=${BS_QUALITY_MAX_REVIEW_ROUNDS} review-rounds, ${BS_QUALITY_MAX_FIX_COMMITS} fix-commits, ${BS_QUALITY_MAX_WALL_SECONDS}s wall-clock"
