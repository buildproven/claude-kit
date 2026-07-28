#!/usr/bin/env bash
# =============================================================================
# quality-adversarial-verify.sh — try to REFUTE each finding before it blocks.
# =============================================================================
# WHY THIS EXISTS
#
# The judge (Step 2.5) promotes a finding's severity when 2+ agents flag it.
# But agents reading the same diff make CORRELATED errors: they share a model, a
# prompt shape, and the same blind spots. "Three agents agreed" is not
# independent evidence — it can just be the same mistake three times.
#
# And the failure mode is asymmetric. A false BLOCKING finding costs a wasted
# fix round. A false PASS ships the bug. So the panel is tuned to flag, which
# means the findings that reach the judge are noisy by construction.
#
# This inverts the burden. Each finding is handed to N skeptics whose ONLY job
# is to refute it — to prove the code is actually fine. A finding survives only
# if the skeptics cannot kill it. Nobody is asked "is this a bug?" (a question
# that invites agreement); they are asked "show me why this is NOT a bug."
#
# Verdicts are combined by majority. Ties survive: when the skeptics are split,
# the finding stands, because the cost of a false PASS is higher.
#
# Usage:
#   quality-adversarial-verify.sh --findings <file.json> --diff <file> \
#       --out <dir> [--voters 3] [--timeout 300] [--model <m>] [--dry-run]
#
# Input findings JSON: [{ "file": "...", "line": 12, "severity": "BLOCKING",
#                         "summary": "...", "detail": "..." }, ...]
# Output: <out>/verdicts.json — the same findings, each with a `verified` block.
#         Exit 0 always (a verification run that errors must not silently drop
#         findings — unverifiable findings SURVIVE and are marked as such).
# =============================================================================

set -uo pipefail

FINDINGS=""
DIFF_FILE=""
OUT_DIR=""
VOTERS=3
TIMEOUT=300
# Adversarial verification is the deliberate Claude escalation: use Opus at
# high effort for a bounded, revision-specific skeptic pass. Never inherit the
# operator session model; that could silently reintroduce a long-context pin.
DEFAULT_REVIEW_MODEL="claude-opus-5"
MODEL=""
DRY_RUN=false
# Governor integration: an absolute wall-clock deadline (epoch seconds) that the
# whole verification pass must finish within, and a hard cap on how many
# findings to verify. Without these, a run costs COUNT × VOTERS × TIMEOUT of
# full `claude -p` sessions, unbounded by the campaign clock. 0 = unset.
DEADLINE_EPOCH=0
MAX_FINDINGS=6

while [ $# -gt 0 ]; do
  case "$1" in
    --findings) FINDINGS="$2"; shift 2 ;;
    --diff)     DIFF_FILE="$2"; shift 2 ;;
    --out)      OUT_DIR="$2"; shift 2 ;;
    --voters)   VOTERS="$2"; shift 2 ;;
    --timeout)  TIMEOUT="$2"; shift 2 ;;
    --deadline-epoch) DEADLINE_EPOCH="$2"; shift 2 ;;
    --max-findings)   MAX_FINDINGS="$2"; shift 2 ;;
    --model)    MODEL="$2"; shift 2 ;;
    --dry-run)  DRY_RUN=true; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done
case "$DEADLINE_EPOCH" in ''|*[!0-9]*) echo "--deadline-epoch must be a number" >&2; exit 2 ;; esac
case "$MAX_FINDINGS" in ''|*[!0-9]*) echo "--max-findings must be a number" >&2; exit 2 ;; esac

if [ -z "$FINDINGS" ] || [ -z "$DIFF_FILE" ] || [ -z "$OUT_DIR" ]; then
  echo "usage: $(basename "$0") --findings <json> --diff <file> --out <dir> [--voters N]" >&2
  exit 2
fi
[ -f "$FINDINGS" ]  || { echo "findings file not found: $FINDINGS" >&2; exit 2; }
[ -f "$DIFF_FILE" ] || { echo "diff file not found: $DIFF_FILE" >&2; exit 2; }

mkdir -p "$OUT_DIR"
VERDICTS="$OUT_DIR/verdicts.json"

# An odd voter count avoids a tie needing a tiebreak rule that isn't the
# survive-on-tie default. Even counts still work; ties simply survive.
case "$VOTERS" in ''|*[!0-9]*) echo "voters must be a number" >&2; exit 2 ;; esac
[ "$VOTERS" -ge 1 ] || { echo "voters must be >= 1" >&2; exit 2; }

EFFECTIVE_MODEL="${MODEL:-$DEFAULT_REVIEW_MODEL}"
case "$EFFECTIVE_MODEL" in
  *"[1m]"*|*"-1m"*)
    echo "quality-adversarial-verify: refusing 1M-context model ($EFFECTIVE_MODEL) — using $DEFAULT_REVIEW_MODEL" >&2
    EFFECTIVE_MODEL="$DEFAULT_REVIEW_MODEL"
    ;;
esac
MODEL_ARGS=(--model "$EFFECTIVE_MODEL" --effort high)

# Portable timeout: macOS has no coreutils `timeout` by default.
run_with_timeout() {
  local secs="$1"; shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$secs" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$secs" "$@"
  else
    # No coreutils timeout: run the child in its OWN process group and kill the
    # whole group on expiry. `claude -p` spawns tool subprocesses; killing only
    # the parent PID (the old behavior) leaves those grandchildren alive to keep
    # consuming the budget the timeout was meant to reclaim.
    set -m
    "$@" &
    local pid=$!
    ( sleep "$secs"; kill -TERM "-$pid" 2>/dev/null; sleep 2; kill -KILL "-$pid" 2>/dev/null ) &
    local killer=$!
    wait "$pid"; local rc=$?
    kill -KILL "-$killer" 2>/dev/null
    set +m
    return $rc
  fi
}

# Seconds left before the governor deadline, or a large sentinel when unset.
remaining_seconds() {
  if [ "$DEADLINE_EPOCH" -eq 0 ]; then echo 999999; return; fi
  local now; now=$(date +%s)
  local left=$((DEADLINE_EPOCH - now))
  [ "$left" -lt 0 ] && left=0
  echo "$left"
}

# The skeptic's brief. Deliberately adversarial: the DEFAULT is "refuted".
# An agent asked "is this real?" drifts toward yes. Asked to disprove it, it has
# to actually go and read the code.
verify_prompt() {
  local file="$1" line="$2" summary="$3" detail="$4"
  cat <<PROMPT
A code reviewer claims this is a real defect. Your job is to REFUTE it.

  File:    ${file}${line:+:$line}
  Claim:   ${summary}
  Detail:  ${detail}

Read the actual code. Then argue the reviewer is WRONG — that the code is fine as
written. Look for the reasons a flag like this is usually a false positive:

  - The dangerous path is already guarded somewhere the reviewer didn't look.
  - The reviewer misread the control flow, or the language's semantics.
  - The input they're worried about cannot actually reach this code.
  - It's a deliberate, documented choice (read the comments).
  - The "bug" is in dead code, a test fixture, or an example.

You may only conclude the finding is REAL if you genuinely cannot refute it —
if you can describe a concrete input or state that reaches this code and produces
the wrong result. A vague "it could be risky" is a refutation, not a confirmation.

DEFAULT TO REFUTED. The burden of proof is on the reviewer, not on the code.

Reply with exactly one line, then your reasoning:
VERDICT: REFUTED
or
VERDICT: STANDS — <the concrete failing input or state>
PROMPT
}

# --- Parse findings with node (already a hard dependency of this repo) --------
COUNT=$(node -e '
  const fs = require("fs");
  try {
    const f = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(String(Array.isArray(f) ? f.length : 0));
  } catch { process.stdout.write("-1"); }
' "$FINDINGS")

if [ "$COUNT" = "-1" ]; then
  # Malformed input must not silently drop findings. Fail loud, keep them all.
  echo "[verify] findings file is not valid JSON — cannot verify. All findings SURVIVE unverified." >&2
  cp "$FINDINGS" "$VERDICTS" 2>/dev/null || echo "[]" > "$VERDICTS"
  exit 0
fi

if [ "$COUNT" = "0" ]; then
  echo "[verify] no findings to verify."
  echo "[]" > "$VERDICTS"
  exit 0
fi

# Cap the number of findings we verify. Beyond the cap, findings SURVIVE
# unverified (the same asymmetric default as a timeout) so a huge finding set
# can't blow the budget. Never silently truncate: say exactly how many were
# capped, so "verified" is not mistaken for "all covered".
VERIFY_COUNT="$COUNT"
if [ "$MAX_FINDINGS" -gt 0 ] && [ "$COUNT" -gt "$MAX_FINDINGS" ]; then
  VERIFY_COUNT="$MAX_FINDINGS"
  echo "[verify] $COUNT finding(s) exceed the --max-findings cap of $MAX_FINDINGS;" \
       "verifying the first $MAX_FINDINGS, the remaining $((COUNT - MAX_FINDINGS)) SURVIVE unverified." >&2
fi

echo "[verify] $VERIFY_COUNT finding(s) × $VOTERS skeptic(s) — trying to refute each."

: > "$OUT_DIR/votes.jsonl"

i=0
while [ "$i" -lt "$VERIFY_COUNT" ]; do
  # Read the finding's fields as TAB-separated values.
  #
  # Deliberately NOT `eval` on shell-quoted output: a finding's summary is
  # written by a model and can contain anything, including quotes. Eval-ing it
  # would be a shell-injection hole in the tool whose whole job is catching
  # security bugs. TSV + IFS read cannot inject.
  IFS=$'\t' read -r F_FILE F_LINE F_SUM F_DET <<TSV
$(node -e '
    const fs = require("fs");
    const f = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))[Number(process.argv[2])];
    // Strip tabs/newlines from the fields themselves so the delimiter holds.
    const flat = (s) => String(s ?? "").replace(/[\t\r\n]+/g, " ").trim();
    process.stdout.write([f.file, f.line, f.summary, f.detail].map(flat).join("\t"));
  ' "$FINDINGS" "$i")
TSV

  refuted=0
  stands=0

  # Clamp this finding's per-skeptic timeout so the whole finding (all voters,
  # which run concurrently below) fits inside the governor's remaining budget,
  # with headroom for the findings still queued after it. When the deadline is
  # already exhausted, stop verifying: the current and all remaining findings
  # SURVIVE unverified rather than each burning a doomed, timing-out session.
  rem=$(remaining_seconds)
  if [ "$rem" -le 0 ]; then
    echo "[verify] governor deadline exhausted; finding $((i + 1))..$VERIFY_COUNT SURVIVE unverified." >&2
    while [ "$i" -lt "$VERIFY_COUNT" ]; do
      IFS=$'\t' read -r U_FILE U_LINE U_SUM U_DET <<UTSV
$(node -e '
        const fs = require("fs");
        const f = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))[Number(process.argv[2])];
        const flat = (s) => String(s ?? "").replace(/[\t\r\n]+/g, " ").trim();
        process.stdout.write([f.file, f.line, f.summary, f.detail].map(flat).join("\t"));
      ' "$FINDINGS" "$i")
UTSV
      node -e '
        const [file, line, summary, detail] = process.argv.slice(1);
        process.stdout.write(JSON.stringify({
          file, line: line || null, summary, detail,
          verified: { refuted: 0, stands: 0, survives: true, unverified: "deadline" },
        }) + "\n");
      ' "$U_FILE" "$U_LINE" "$U_SUM" "$U_DET" >> "$OUT_DIR/votes.jsonl"
      i=$((i + 1))
    done
    break
  fi
  # Reserve budget for the findings still queued after this one so an early
  # finding can't consume the whole clock. Divide remaining time across the
  # findings left, then floor at 30s (below that a skeptic can't do useful work).
  findings_left=$((VERIFY_COUNT - i))
  finding_budget=$((rem / findings_left))
  pass_timeout="$TIMEOUT"
  [ "$finding_budget" -lt "$pass_timeout" ] && pass_timeout="$finding_budget"
  [ "$pass_timeout" -lt 30 ] && pass_timeout=30

  if [ "$DRY_RUN" = true ]; then
    # Deterministic, no subprocesses — count directly.
    stands="$VOTERS"
  else
    # Run all voters for THIS finding concurrently. Each writes its verdict word
    # (REFUTED/STANDS) to its own file; we tally after they join. Concurrency
    # turns per-finding latency from VOTERS×timeout into ~1×timeout.
    vote_dir="$OUT_DIR/votes-$i"
    mkdir -p "$vote_dir"
    v=0
    while [ "$v" -lt "$VOTERS" ]; do
      (
        out="$(run_with_timeout "$pass_timeout" \
              env BS_QUALITY_HEADLESS=1 \
              claude -p "$(verify_prompt "$F_FILE" "$F_LINE" "$F_SUM" "$F_DET")" \
                --no-session-persistence \
                --permission-mode bypassPermissions \
                --allowedTools "Read,Grep,Glob" \
                ${MODEL_ARGS[@]+"${MODEL_ARGS[@]}"} \
                2>>"$OUT_DIR/verify.stderr")"
        rc=$?
        if [ $rc -ne 0 ] || [ -z "$out" ]; then
          # A skeptic that times out has NOT refuted anything. Silence is not a
          # refutation — the finding keeps the benefit of the doubt.
          out="VERDICT: STANDS — verifier inconclusive (rc=$rc)"
        fi
        if printf '%s' "$out" | grep -qiE '^[[:space:]]*VERDICT:[[:space:]]*REFUTED'; then
          echo REFUTED > "$vote_dir/$v"
        else
          echo STANDS > "$vote_dir/$v"
        fi
      ) &
      v=$((v + 1))
    done
    wait

    v=0
    while [ "$v" -lt "$VOTERS" ]; do
      if [ "$(cat "$vote_dir/$v" 2>/dev/null)" = "REFUTED" ]; then
        refuted=$((refuted + 1))
      else
        stands=$((stands + 1))
      fi
      v=$((v + 1))
    done
    rm -rf "$vote_dir"
  fi

  # Majority refutes -> the finding dies. A TIE SURVIVES: a false PASS ships the
  # bug, a false BLOCK costs one fix round. Asymmetric cost, asymmetric default.
  if [ "$refuted" -gt "$stands" ]; then survives=false; else survives=true; fi

  node -e '
    const [file, line, summary, detail, refuted, stands, survives] = process.argv.slice(1);
    process.stdout.write(JSON.stringify({
      file, line: line || null, summary, detail,
      verified: {
        refuted: Number(refuted),
        stands: Number(stands),
        survives: survives === "true",
      },
    }) + "\n");
  ' "$F_FILE" "$F_LINE" "$F_SUM" "$F_DET" "$refuted" "$stands" "$survives" >> "$OUT_DIR/votes.jsonl"

  if [ "$survives" = "false" ]; then
    echo "[verify] REFUTED ($refuted/$VOTERS): $F_FILE — $F_SUM"
  else
    echo "[verify] survives ($stands/$VOTERS): $F_FILE — $F_SUM"
  fi

  i=$((i + 1))
done

# Emit survive-unverified records for findings past the cap so they are never
# silently dropped from the verdicts — the downstream gate must see them (they
# survive, exactly like the deadline case).
i="$VERIFY_COUNT"
while [ "$i" -lt "$COUNT" ]; do
  IFS=$'\t' read -r C_FILE C_LINE C_SUM C_DET <<CTSV
$(node -e '
    const fs = require("fs");
    const f = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))[Number(process.argv[2])];
    const flat = (s) => String(s ?? "").replace(/[\t\r\n]+/g, " ").trim();
    process.stdout.write([f.file, f.line, f.summary, f.detail].map(flat).join("\t"));
  ' "$FINDINGS" "$i")
CTSV
  node -e '
    const [file, line, summary, detail] = process.argv.slice(1);
    process.stdout.write(JSON.stringify({
      file, line: line || null, summary, detail,
      verified: { refuted: 0, stands: 0, survives: true, unverified: "capped" },
    }) + "\n");
  ' "$C_FILE" "$C_LINE" "$C_SUM" "$C_DET" >> "$OUT_DIR/votes.jsonl"
  i=$((i + 1))
done

node -e '
  const fs = require("fs");
  const lines = fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean);
  fs.writeFileSync(process.argv[2], JSON.stringify(lines.map((l) => JSON.parse(l)), null, 2) + "\n");
' "$OUT_DIR/votes.jsonl" "$VERDICTS"

SURVIVING=$(node -e '
  const f = require("fs").readFileSync(process.argv[1], "utf8");
  process.stdout.write(String(JSON.parse(f).filter((x) => x.verified.survives).length));
' "$VERDICTS")

echo "[verify] $SURVIVING of $COUNT finding(s) survived adversarial verification" \
     "(${VERIFY_COUNT} verified$([ "$VERIFY_COUNT" -lt "$COUNT" ] && echo ", $((COUNT - VERIFY_COUNT)) survived uncapped-unverified"))."
echo "[verify] verdicts: $VERDICTS"
exit 0
