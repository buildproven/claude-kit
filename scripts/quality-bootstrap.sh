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

# Headless review children must never resume or create a quality invocation.
# Keep this before the resume fast path so an inherited manifest cannot bypass
# the recursion guard.
if [ "${BS_QUALITY_HEADLESS:-}" = "1" ]; then
  echo "❌ /bs:quality refused: already running inside a headless review child" >&2
  echo "   (BS_QUALITY_HEADLESS=1). Review subprocesses must not re-enter the" >&2
  echo "   quality skill — this guard prevents fork→child→fork recursion." >&2
  exit 1
fi

# A campaign is already active in this process tree. Legitimate continuations
# carry --manifest (the resume fast path) and are allowed through; a *fresh*
# invocation with no manifest means a fix-round agent (or any descendant the
# skill spawned) is trying to launch a second, nested campaign. Refuse it — one
# campaign owns the deadline and the merge gate; a nested fresh run would burn
# tokens under a second clock the governor cannot see. This marker is exported
# below so every descendant process inherits it, closing the gap that
# BS_QUALITY_HEADLESS (set only on the two review legs) did not cover.
if [ "${BS_QUALITY_ACTIVE:-}" = "1" ] && [ -z "$MANIFEST_ARG" ]; then
  echo "❌ /bs:quality refused: a quality campaign is already active in this" >&2
  echo "   process tree (BS_QUALITY_ACTIVE=1) and no --manifest was given." >&2
  echo "   A fix-round or spawned agent must not start a second campaign. To" >&2
  echo "   continue the existing run, resume it with its --manifest path." >&2
  exit 1
fi
# Mark this process tree as owning an active campaign so descendants inherit it.
export BS_QUALITY_ACTIVE=1

# Validate the complete invocation before target resolution or any GitHub
# operation. Every token must belong to the supported grammar; a bare value
# after a boolean flag (for example `--merge 1`) must never be reinterpreted as
# target context.
if [ -n "$MANIFEST_ARG" ] && [ "${#BOOTSTRAP_ARGS[@]}" -ne 0 ]; then
  echo "❌ quality resume accepts only --manifest <path>" >&2
  exit 1
fi
EXPLICIT_TARGET=false
for ((argument_index = 0; argument_index < ${#BOOTSTRAP_ARGS[@]}; argument_index += 1)); do
  argument="${BOOTSTRAP_ARGS[$argument_index]}"
  case "$argument" in
    --merge|--merge=true|--skip-tests) ;;
    --merge=*)
      echo "❌ --merge accepts only the bare flag or --merge=true" >&2
      exit 1
      ;;
    --level|--scope|--review-arm|--target-dir|--target|--worktree|--pr|--pull|--pull-request|--branch|--head|--head-ref)
      case "$argument" in
        --target-dir|--target|--worktree|--pr|--pull|--pull-request|--branch|--head|--head-ref)
          EXPLICIT_TARGET=true
          ;;
      esac
      argument_index=$((argument_index + 1))
      [ "$argument_index" -lt "${#BOOTSTRAP_ARGS[@]}" ] &&
        [ -n "${BOOTSTRAP_ARGS[$argument_index]}" ] &&
        [[ "${BOOTSTRAP_ARGS[$argument_index]}" != --* ]] || {
        echo "❌ $argument requires a value" >&2
        exit 1
      }
      ;;
    --level=*|--scope=*|--review-arm=*|--target-dir=*|--target=*|--worktree=*|--pr=*|--pull=*|--pull-request=*|--branch=*|--head=*|--head-ref=*)
      case "$argument" in
        --target-dir=*|--target=*|--worktree=*|--pr=*|--pull=*|--pull-request=*|--branch=*|--head=*|--head-ref=*)
          EXPLICIT_TARGET=true
          ;;
      esac
      [ -n "${argument#*=}" ] || {
        echo "❌ ${argument%%=*} requires a value" >&2
        exit 1
      }
      ;;
    \#*)
      EXPLICIT_TARGET=true
      [[ "$argument" =~ ^\#[1-9][0-9]*$ ]] || {
        echo "❌ unexpected quality argument: $argument" >&2
        exit 1
      }
      ;;
    /*|~/*|./*|../*) EXPLICIT_TARGET=true ;;
    */*)
      EXPLICIT_TARGET=true
      [[ "$argument" =~ ^[A-Za-z][A-Za-z0-9_.-]*/[A-Za-z0-9_./-]+$ ]] || {
        echo "❌ unexpected quality argument: $argument" >&2
        exit 1
      }
      ;;
    *)
      echo "❌ unexpected quality argument: $argument" >&2
      exit 1
      ;;
  esac
done

# Safe resumption is explicit: the caller must pass the exact manifest path.
# Never discover an active invocation through a session ID, glob, pointer, or
# mtime. A resumed manifest may advance only to a descendant HEAD; the helper
# validates repository realpath, base SHA, and the resulting exact HEAD.
if [ -n "$MANIFEST_ARG" ]; then
  [ -f "$MANIFEST_ARG" ] || {
    echo "❌ quality invocation manifest not found: $MANIFEST_ARG" >&2
    exit 1
  }
  RESUME_ROOT="$(node -e 'const q=require(process.argv[1]); process.stdout.write(q.loadManifest(process.argv[2]).manifest.repo.realpath)' \
    "$SCRIPT_DIR/quality-invocation.js" "$MANIFEST_ARG")" || exit 1
  cd "$RESUME_ROOT" || exit 1
  RESUME_PR="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST_ARG" repo.pr)"
  ADVANCE_ARGS=(advance "$MANIFEST_ARG")
  if [ -n "$RESUME_PR" ] && [ "$RESUME_PR" != null ]; then
    RESUME_GITHUB_REPOSITORY="$(gh repo view --json nameWithOwner --jq .nameWithOwner)" || exit 1
    RESUME_PR_JSON="$(gh pr view "$RESUME_PR" --repo "$RESUME_GITHUB_REPOSITORY" \
      --json headRefName,headRepository,isCrossRepository 2>/dev/null)" || exit 1
    RESUME_HEAD_REF="$(printf '%s' "$RESUME_PR_JSON" | jq -er '.headRefName')" || exit 1
    RESUME_HEAD_REPOSITORY="$(printf '%s' "$RESUME_PR_JSON" | jq -er '.headRepository.nameWithOwner')" || exit 1
    RESUME_CROSS_REPOSITORY="$(printf '%s' "$RESUME_PR_JSON" | jq -r '.isCrossRepository')" || exit 1
    { [ "$RESUME_CROSS_REPOSITORY" = true ] || [ "$RESUME_CROSS_REPOSITORY" = false ]; } || exit 1
    ADVANCE_ARGS+=(--github-repo "$RESUME_GITHUB_REPOSITORY" \
      --head-ref "$RESUME_HEAD_REF" \
      --head-repository "$RESUME_HEAD_REPOSITORY" \
      --cross-repository "$RESUME_CROSS_REPOSITORY")
  fi
  node "$SCRIPT_DIR/quality-invocation.js" "${ADVANCE_ARGS[@]}" >/dev/null || exit 1
  INVOCATION_ID="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST_ARG" invocationId)"
  HEAD_SHA="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST_ARG" revisions.currentHead)"
  echo "BS_QUALITY_MANIFEST=$MANIFEST_ARG"
  echo "GIT_ROOT=$RESUME_ROOT"
  echo "[quality] resumed invocation $INVOCATION_ID at $HEAD_SHA"
  exit 0
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
    | awk '/^worktree / {p=substr($0, 10)} /^branch refs\/heads\/main$/ {print p; exit}')
  # QUALITY_CWD must reflect --target-dir when the caller supplied one —
  # otherwise it silently carries this process's own launch directory into
  # the resolver's fallback/cwd-relative resolution paths, which breaks when
  # invoked from outside the target checkout (BUI-390). --target-dir, when
  # present, is always authoritative over ambient $PWD.
  RESOLVER_TARGET_DIR=""
  prev_resolver_arg=""
  for resolver_arg in "$@"; do
    case "$prev_resolver_arg" in
      --target-dir|--target) RESOLVER_TARGET_DIR="$resolver_arg" ;;
    esac
    case "$resolver_arg" in
      --target-dir=*|--target=*) RESOLVER_TARGET_DIR="${resolver_arg#*=}" ;;
    esac
    prev_resolver_arg="$resolver_arg"
  done
  if [ -z "$RESOLVER_TARGET_DIR" ] && [ -n "${BS_QUALITY_TARGET_DIR:-}" ]; then
    RESOLVER_TARGET_DIR="$BS_QUALITY_TARGET_DIR"
  fi
  if [ -n "$RESOLVER_TARGET_DIR" ]; then
    RESOLVER_TARGET_DIR="${RESOLVER_TARGET_DIR/#\~/$HOME}"
    CWD_INPUT="$RESOLVER_TARGET_DIR"
  else
    CWD_INPUT=$(pwd)
  fi

  RESOLVER_STDERR=$(mktemp 2>/dev/null || echo "/tmp/quality-resolver-stderr.$$")
  RESOLUTION_JSON=$(QUALITY_CWD="$CWD_INPUT" \
                    QUALITY_PRIMARY_CHECKOUT="$PRIMARY_CHECKOUT" \
                    node "$RESOLVER" --cli "$@" 2>"$RESOLVER_STDERR")
  RESOLVER_RC=$?

  # Distinguish a resolver *crash* (non-zero exit) from a clean empty/ok:false
  # result. A crash must never silently degrade to auditing the cwd when the
  # caller explicitly named a target (PR #NNN, a branch, or --target-dir): that
  # is how the "audited the wrong repo" class of bug happens. Only fall through
  # to cwd resolution when the caller passed no target token at all.
  if [ "$RESOLVER_RC" -ne 0 ]; then
    if [ "$EXPLICIT_TARGET" = true ]; then
      echo "❌ /bs:quality target resolver crashed (exit $RESOLVER_RC) while a target was requested."
      echo "   Refusing to fall back to the current directory — that could audit the wrong repo."
      [ -s "$RESOLVER_STDERR" ] && { echo "   Resolver error:"; sed 's/^/     /' "$RESOLVER_STDERR"; }
      rm -f "$RESOLVER_STDERR"
      exit 1
    fi
    # No explicit target requested — surface the error but allow cwd resolution.
    [ -s "$RESOLVER_STDERR" ] && { echo "[quality] target resolver error (continuing with cwd):"; sed 's/^/  /' "$RESOLVER_STDERR"; }
    RESOLUTION_JSON=""
  fi
  rm -f "$RESOLVER_STDERR"

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
        # No local worktree for the branch. The shared manager owns canonical
        # root resolution, collision handling, and idempotent materialization.
        WORKTREE_MANAGER="$SCRIPT_DIR/worktree-manager.js"
        [ -f "$WORKTREE_MANAGER" ] || {
          echo "❌ Could not materialize '$RES_BRANCH': worktree-manager.js is unavailable."
          exit 1
        }
        REPO_ROOT_FOR_WT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
        WT_BASE_REF="origin/$RES_BRANCH"
        if [ "$RES_KIND" = pr ] && [ -n "${RES_PR:-}" ]; then
          WT_BASE_REF="refs/remotes/pull/$RES_PR/head"
          git -C "$REPO_ROOT_FOR_WT" fetch origin \
            "refs/pull/$RES_PR/head:$WT_BASE_REF" >/dev/null 2>&1 || {
            echo "❌ Could not fetch exact head for PR #$RES_PR." >&2
            exit 1
          }
        else
          git -C "$REPO_ROOT_FOR_WT" fetch origin "$RES_BRANCH" >/dev/null 2>&1 || true
        fi
        WT_CREATE_JSON=$(node "$WORKTREE_MANAGER" create \
          --repo "$REPO_ROOT_FOR_WT" \
          --branch "$RES_BRANCH" \
          --base "$WT_BASE_REF" \
          --creator "bs:quality" \
          --purpose "quality-target-materialization") || exit 1
        RES_PATH=$(printf '%s' "$WT_CREATE_JSON" | jq -er '.worktreePath') || exit 1
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
  CURRENT_BRANCH=$(git branch --show-current)
  PRIMARY_STATUS=$(node "$SCRIPT_DIR/worktree-manager.js" status \
    --repo "$GIT_ROOT" --skip-pr-check) || {
    echo "❌ /bs:quality --merge could not resolve the primary checkout." >&2
    exit 1
  }
  PRIMARY=$(printf '%s' "$PRIMARY_STATUS" | jq -er '.repoRoot') || {
    echo "❌ /bs:quality --merge could not parse the primary checkout." >&2
    exit 1
  }
  if [ "$GIT_ROOT" = "$PRIMARY" ]; then
    echo "❌ /bs:quality --merge cannot run from the primary checkout (${CURRENT_BRANCH:-detached HEAD})."
    echo "   Create a worktree first:"
    echo "     node $SCRIPT_DIR/worktree-manager.js create --repo \"$GIT_ROOT\" --branch <type>/<slug>"
    echo "   Move uncommitted changes there with: git stash; cd <worktree>; git stash pop"
    exit 1
  fi
fi

# A PR-targeted invocation must always bind to the PR's actual base identity,
# even when it is review-only. Falling back to origin/main for non-merge runs
# produces the wrong diff and a manifest that cannot safely resume or merge.
#
# --repo is always passed explicitly (derived from GIT_ROOT's own remote, not
# left to gh's CWD-relative default) so PR lookups stay bound to --target-dir
# even when the invoking shell's $PWD points at a different repo (BUI-470).
GH_REPO_SLUG=""
if [ -n "${RES_PR:-}" ] || [ "$ARGS_MERGE" = true ]; then
  GH_REPO_SLUG="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)" || {
    echo "❌ /bs:quality could not resolve the GitHub repository for $GIT_ROOT." >&2
    exit 1
  }
fi
PR_JSON=""
if [ -n "${RES_PR:-}" ]; then
  PR_JSON="$(gh pr view "$RES_PR" --repo "$GH_REPO_SLUG" \
    --json number,baseRefName,baseRefOid,headRefName,headRefOid,headRepository,isCrossRepository 2>/dev/null)"
elif [ "$ARGS_MERGE" = true ]; then
  # `gh pr view --repo X` with no selector errors ("argument required when
  # using the --repo flag") — pass the current branch explicitly.
  MERGE_LOOKUP_BRANCH="$(git branch --show-current)"
  PR_JSON="$(gh pr view "$MERGE_LOOKUP_BRANCH" --repo "$GH_REPO_SLUG" \
    --json number,baseRefName,baseRefOid,headRefName,headRefOid,headRepository,isCrossRepository 2>/dev/null)"
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
  PR_HEAD_NAME="$(printf '%s' "$PR_JSON" | jq -r '.headRefName')"
  PR_HEAD_OID="$(printf '%s' "$PR_JSON" | jq -r '.headRefOid')"
  PR_HEAD_REPOSITORY="$(printf '%s' "$PR_JSON" | jq -r '.headRepository.nameWithOwner')"
  PR_IS_CROSS_REPOSITORY="$(printf '%s' "$PR_JSON" | jq -r '.isCrossRepository')"
  [ -n "$PR_BASE_NAME" ] && [ "$PR_BASE_NAME" != null ] &&
    [ -n "$PR_BASE_OID" ] && [ "$PR_BASE_OID" != null ] &&
    [ -n "$PR_HEAD_NAME" ] && [ "$PR_HEAD_NAME" != null ] &&
    [ -n "$PR_HEAD_REPOSITORY" ] && [ "$PR_HEAD_REPOSITORY" != null ] &&
    { [ "$PR_IS_CROSS_REPOSITORY" = true ] || [ "$PR_IS_CROSS_REPOSITORY" = false ]; } || {
      echo "❌ /bs:quality could not resolve the PR base identity." >&2
      exit 1
    }
  # Defensive check: even with --repo pinned above, fail closed (rather than
  # silently proceeding) if the resolved PR ever belongs to a different repo
  # than --target-dir/GIT_ROOT expects.
  [ "$PR_IS_CROSS_REPOSITORY" = false ] && [ "$PR_HEAD_REPOSITORY" != "$GH_REPO_SLUG" ] && {
    echo "❌ /bs:quality PR #$RES_PR belongs to $PR_HEAD_REPOSITORY, not $GH_REPO_SLUG (--target-dir)." >&2
    exit 1
  }
  [ "$PR_HEAD_OID" = "$(git rev-parse HEAD)" ] || {
    echo "❌ /bs:quality PR HEAD does not match the target worktree." >&2
    exit 1
  }
fi

BASE_REF=""
if [ -n "${PR_BASE_NAME:-}" ]; then
  # BUI-382: this used to compare the freshly-fetched base tip against
  # $PR_BASE_OID — a value read from `gh pr view`'s cached baseRefOid field
  # (above, potentially seconds stale relative to GitHub's own git backend).
  # That produced false-positive "base changed" aborts on an active repo:
  # the fetch would correctly reveal the true current tip, but comparing it
  # to a stale API-cache snapshot looked identical to a genuine race. Take a
  # fresh, authoritative read of the base tip via `git ls-remote` (bypasses
  # GitHub's API response cache entirely — same pattern already used for the
  # equivalent freshness check in quality-authorize-merge.sh) immediately
  # before the fetch, and compare the fetch result against THAT instead.
  # This still catches a genuine race (base moves between the ls-remote and
  # the fetch), just without false-alarming on API cache lag.
  FRESH_BASE_OID="$(git ls-remote origin "refs/heads/$PR_BASE_NAME" | awk '{print $1}')"
  [ -n "$FRESH_BASE_OID" ] || {
    echo "❌ /bs:quality could not resolve the live PR base tip." >&2
    exit 1
  }
  git fetch origin "$PR_BASE_NAME" -q || exit 1
  BASE_REF="origin/$PR_BASE_NAME"
  [ "$(git rev-parse "$BASE_REF")" = "$FRESH_BASE_OID" ] || {
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
REVIEW_ARM_ARG=""
previous=""
for argument in "$@"; do
  case "$previous" in
    --level) LEVEL_ARG="$argument"; previous=""; continue ;;
    --scope) SCOPE_ARG="$argument"; previous=""; continue ;;
    --review-arm) REVIEW_ARM_ARG="$argument"; previous=""; continue ;;
  esac
  case "$argument" in
    --level) previous="--level" ;;
    --level=*) LEVEL_ARG="${argument#*=}" ;;
    --scope) previous="--scope" ;;
    --scope=*) SCOPE_ARG="${argument#*=}" ;;
    --review-arm) previous="--review-arm" ;;
    --review-arm=*) REVIEW_ARM_ARG="${argument#*=}" ;;
    --skip-tests) SKIP_TESTS=true ;;
  esac
done

CREATE_ARGS=(create --repo "$GIT_ROOT" --base-ref "$BASE_REF" \
  --level "$LEVEL_ARG" --scope "$SCOPE_ARG")
case "$REVIEW_ARM_ARG" in
  "") ;;
  bespoke)
    # shellcheck source=provider-policy.sh
    source "$SCRIPT_DIR/provider-policy.sh" || exit 1
    QUALITY_PRIMARY=claude
    QUALITY_FALLBACK=codex
    QUALITY_PROVIDER_CONFIG="${BS_QUALITY_PROVIDER_CONFIG:-$(bs_provider_default_config)}"
    ;;
  native)
    # shellcheck source=provider-policy.sh
    source "$SCRIPT_DIR/provider-policy.sh" || exit 1
    QUALITY_PRIMARY=codex
    QUALITY_FALLBACK=claude
    QUALITY_PROVIDER_CONFIG="${BS_QUALITY_PROVIDER_CONFIG:-$(bs_provider_default_config)}"
    ;;
  *)
    echo "quality-bootstrap: --review-arm must be bespoke or native" >&2
    exit 1
    ;;
esac
if [ -n "$REVIEW_ARM_ARG" ]; then
  CREATE_ARGS+=(--primary "$QUALITY_PRIMARY" --fallback "$QUALITY_FALLBACK" \
    --provider-config "$QUALITY_PROVIDER_CONFIG" --review-arm "$REVIEW_ARM_ARG")
fi
# Prefer the freshly-verified base tip (FRESH_BASE_OID, see the base-drift
# guard above) over the gh-pr-view snapshot (PR_BASE_OID) when both are
# available — it's the authoritative value the fetch was actually checked
# against, so persisting it as baseHeadSha keeps the merge-time freshness
# gate (quality-authorize-merge.sh) anchored on real git state.
BASE_HEAD_SHA_ARG="${FRESH_BASE_OID:-${PR_BASE_OID:-}}"
[ -n "$BASE_HEAD_SHA_ARG" ] && CREATE_ARGS+=(--base-head-sha "$BASE_HEAD_SHA_ARG")
[ "$ARGS_MERGE" = true ] && CREATE_ARGS+=(--merge)
[ "$SKIP_TESTS" = true ] && CREATE_ARGS+=(--skip-tests)
[ -n "${RES_PR:-}" ] && CREATE_ARGS+=(--pr "$RES_PR")
if [ -n "${RES_PR:-}" ]; then
  GITHUB_REPOSITORY="$(gh repo view --json nameWithOwner --jq .nameWithOwner)" || exit 1
  CREATE_ARGS+=(--github-repo "$GITHUB_REPOSITORY" --head-ref "$PR_HEAD_NAME" \
    --head-repository "$PR_HEAD_REPOSITORY" \
    --cross-repository "$PR_IS_CROSS_REPOSITORY")
fi
BS_QUALITY_MANIFEST="$(node "$SCRIPT_DIR/quality-invocation.js" "${CREATE_ARGS[@]}")" || exit 1
INVOCATION_ID="$(node "$SCRIPT_DIR/quality-invocation.js" field "$BS_QUALITY_MANIFEST" invocationId)"
LOCK_OWNER="$(node "$SCRIPT_DIR/quality-invocation.js" lock-owner "$BS_QUALITY_MANIFEST")" || exit 1
BASE_SHA="$(node "$SCRIPT_DIR/quality-invocation.js" field "$BS_QUALITY_MANIFEST" revisions.baseSha)"
HEAD_SHA="$(node "$SCRIPT_DIR/quality-invocation.js" field "$BS_QUALITY_MANIFEST" revisions.currentHead)"

# A merge campaign owns its linked worktree until terminal cleanup. Git's
# native lock carries the exact invocation identity; manager metadata carries
# the same identity plus workflow/purpose for crash reconciliation.
if [ "$ARGS_MERGE" = true ] && [ "$CURRENT_BRANCH" != "main" ] && [ "$CURRENT_BRANCH" != "master" ]; then
  LOCK_ARGS=(lock \
    --repo "$GIT_ROOT" \
    --branch "$CURRENT_BRANCH" \
    --reason "$LOCK_OWNER" \
    --creator "bs:quality" \
    --purpose "verified-merge" \
    --invocation "$INVOCATION_ID")
  PRIOR_STATUS=$(node "$SCRIPT_DIR/worktree-manager.js" status \
    --repo "$GIT_ROOT" --skip-pr-check) || {
    echo "❌ Could not inspect existing worktree ownership." >&2
    exit 1
  }
  PRIOR_LOCK=$(printf '%s' "$PRIOR_STATUS" |
    jq -er --arg branch "$CURRENT_BRANCH" \
      '[.worktrees[] | select(.branch == $branch) | .lockReason // empty][0] // ""') || {
    echo "❌ Could not parse existing worktree ownership." >&2
    exit 1
  }
  if [ -n "$PRIOR_LOCK" ] && [ "$PRIOR_LOCK" != "$LOCK_OWNER" ]; then
    echo "❌ quality target is actively locked by '$PRIOR_LOCK'." >&2
    echo "Release that exact owner at its terminal handoff before retrying:" >&2
    echo "  node \"$SCRIPT_DIR/worktree-manager.js\" unlock --repo \"$GIT_ROOT\" --branch \"$CURRENT_BRANCH\" --owner \"$PRIOR_LOCK\" --terminal" >&2
    exit 1
  fi
  node "$SCRIPT_DIR/worktree-manager.js" "${LOCK_ARGS[@]}" >/dev/null || exit 1
fi

echo "BS_QUALITY_MANIFEST=$BS_QUALITY_MANIFEST"
echo "GIT_ROOT=$GIT_ROOT"
echo "[quality] audit target resolved: $GIT_ROOT"
echo "[quality] invocation: $INVOCATION_ID base=$BASE_SHA head=$HEAD_SHA"
