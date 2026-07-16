#!/usr/bin/env bash
# quality-bootstrap.sh — Step -1 of the quality skill: resolve the audit
# target (PR / branch / worktree / cwd), enforce worktree discipline, and
# initialize the run-governor sentinel.
#
# This is invoked (not sourced) as: bash quality-bootstrap.sh "$@"
# It prints machine-readable lines to stdout for the wrapper to read:
#   BS_QUALITY_MANIFEST=<path>
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
MANIFEST_ARG=""
BOOTSTRAP_ARGS=()
previous=""
for argument in "$@"; do
  if [ "$previous" = "--manifest" ]; then
    MANIFEST_ARG="$argument"
    previous=""
    continue
  fi
  case "$argument" in
    --manifest) previous="--manifest" ;;
    --manifest=*) MANIFEST_ARG="${argument#*=}" ;;
    *) BOOTSTRAP_ARGS+=("$argument") ;;
  esac
done
[ -z "$previous" ] || {
  echo "❌ --manifest requires a path" >&2
  exit 1
}
set -- ${BOOTSTRAP_ARGS[@]+"${BOOTSTRAP_ARGS[@]}"}

# Safe resumption is explicit: the caller must pass the exact manifest path.
# Never discover an active invocation through a session ID, glob, pointer, or
# mtime. A resumed manifest may advance only to a descendant HEAD; the helper
# validates repository realpath, base SHA, and the resulting exact HEAD.
if [ -n "$MANIFEST_ARG" ]; then
  [ -f "$MANIFEST_ARG" ] || {
    echo "❌ quality invocation manifest not found: $MANIFEST_ARG" >&2
    exit 1
  }
  node "$SCRIPT_DIR/quality-invocation.js" advance "$MANIFEST_ARG" >/dev/null || exit 1
  RESUME_ROOT="$(node -e 'const q=require(process.argv[1]); process.stdout.write(q.loadManifest(process.argv[2]).manifest.repo.realpath)' \
    "$SCRIPT_DIR/quality-invocation.js" "$MANIFEST_ARG")" || exit 1
  cd "$RESUME_ROOT" || exit 1
  if [ "${BREAK_GLASS_APPROVED:-}" = true ]; then
    node "$SCRIPT_DIR/quality-invocation.js" approve "$MANIFEST_ARG" \
      --approval-actor "${BREAK_GLASS_APPROVER:-${USER:-unknown}}" \
      --approval-source resumed-outer-invocation || exit 1
  fi
  INVOCATION_ID="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST_ARG" invocationId)"
  HEAD_SHA="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST_ARG" revisions.currentHead)"
  echo "BS_QUALITY_MANIFEST=$MANIFEST_ARG"
  echo "GIT_ROOT=$RESUME_ROOT"
  echo "[quality] resumed invocation $INVOCATION_ID at $HEAD_SHA"
  exit 0
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
    RES_PR=$(echo "$RESOLUTION_JSON" | jq -r '.targetPr // ""' 2>/dev/null)
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

# A PR-targeted invocation must always bind to the PR's actual base identity,
# even when it is review-only. Falling back to origin/main for non-merge runs
# produces the wrong diff and a manifest that cannot safely resume or merge.
PR_JSON=""
if [ -n "${RES_PR:-}" ]; then
  PR_JSON="$(gh pr view "$RES_PR" \
    --json number,baseRefName,baseRefOid,headRefOid 2>/dev/null)"
elif [ "$ARGS_MERGE" = true ]; then
  PR_JSON="$(gh pr view \
    --json number,baseRefName,baseRefOid,headRefOid 2>/dev/null)"
fi
if [ "$ARGS_MERGE" = true ]; then
  [ -n "$PR_JSON" ] || {
    echo "❌ /bs:quality --merge requires an open PR for the target branch." >&2
    exit 1
  }
fi
if [ -n "$PR_JSON" ]; then
  RES_PR="$(printf '%s' "$PR_JSON" | jq -r '.number')"
  PR_BASE_NAME="$(printf '%s' "$PR_JSON" | jq -r '.baseRefName')"
  PR_BASE_OID="$(printf '%s' "$PR_JSON" | jq -r '.baseRefOid')"
  PR_HEAD_OID="$(printf '%s' "$PR_JSON" | jq -r '.headRefOid')"
  [ -n "$PR_BASE_NAME" ] && [ "$PR_BASE_NAME" != null ] &&
    [ -n "$PR_BASE_OID" ] && [ "$PR_BASE_OID" != null ] || {
      echo "❌ /bs:quality could not resolve the PR base identity." >&2
      exit 1
    }
  [ "$PR_HEAD_OID" = "$(git rev-parse HEAD)" ] || {
    echo "❌ /bs:quality PR HEAD does not match the target worktree." >&2
    exit 1
  }
fi

BASE_REF=""
if [ -n "${PR_BASE_NAME:-}" ]; then
  git fetch origin "$PR_BASE_NAME" -q || exit 1
  BASE_REF="origin/$PR_BASE_NAME"
  [ "$(git rev-parse "$BASE_REF")" = "$PR_BASE_OID" ] || {
    echo "❌ /bs:quality PR base changed during bootstrap." >&2
    exit 1
  }
fi
for candidate in ${BASE_REF:+"$BASE_REF"} origin/main origin/master main master; do
  if git rev-parse --verify --quiet "${candidate}^{commit}" >/dev/null 2>&1; then
    BASE_REF="$candidate"
    break
  fi
done
[ -n "$BASE_REF" ] || {
  echo "❌ /bs:quality could not resolve a base ref" >&2
  exit 1
}

LEVEL_ARG=auto
SCOPE_ARG=branch
SKIP_TESTS=false
previous=""
for argument in "$@"; do
  case "$previous" in
    --level) LEVEL_ARG="$argument"; previous=""; continue ;;
    --scope) SCOPE_ARG="$argument"; previous=""; continue ;;
  esac
  case "$argument" in
    --level) previous="--level" ;;
    --level=*) LEVEL_ARG="${argument#*=}" ;;
    --scope) previous="--scope" ;;
    --scope=*) SCOPE_ARG="${argument#*=}" ;;
    --skip-tests) SKIP_TESTS=true ;;
  esac
done

CREATE_ARGS=(create --repo "$GIT_ROOT" --base-ref "$BASE_REF" \
  --level "$LEVEL_ARG" --scope "$SCOPE_ARG")
[ -n "${PR_BASE_OID:-}" ] && CREATE_ARGS+=(--base-head-sha "$PR_BASE_OID")
[ "$ARGS_MERGE" = true ] && CREATE_ARGS+=(--merge)
[ "$SKIP_TESTS" = true ] && CREATE_ARGS+=(--skip-tests)
[ -n "${RES_PR:-}" ] && CREATE_ARGS+=(--pr "$RES_PR")
[ "${BREAK_GLASS_APPROVED:-}" = true ] && CREATE_ARGS+=(--break-glass-approved)
BS_QUALITY_MANIFEST="$(node "$SCRIPT_DIR/quality-invocation.js" "${CREATE_ARGS[@]}")" || exit 1
INVOCATION_ID="$(node "$SCRIPT_DIR/quality-invocation.js" field "$BS_QUALITY_MANIFEST" invocationId)"
BASE_SHA="$(node "$SCRIPT_DIR/quality-invocation.js" field "$BS_QUALITY_MANIFEST" revisions.baseSha)"
HEAD_SHA="$(node "$SCRIPT_DIR/quality-invocation.js" field "$BS_QUALITY_MANIFEST" revisions.currentHead)"

echo "BS_QUALITY_MANIFEST=$BS_QUALITY_MANIFEST"
echo "GIT_ROOT=$GIT_ROOT"
echo "[quality] audit target resolved: $GIT_ROOT"
echo "[quality] invocation: $INVOCATION_ID base=$BASE_SHA head=$HEAD_SHA"
