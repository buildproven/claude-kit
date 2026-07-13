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
MODEL=""
DRY_RUN=false

while [ $# -gt 0 ]; do
  case "$1" in
    --findings) FINDINGS="$2"; shift 2 ;;
    --diff)     DIFF_FILE="$2"; shift 2 ;;
    --out)      OUT_DIR="$2"; shift 2 ;;
    --voters)   VOTERS="$2"; shift 2 ;;
    --timeout)  TIMEOUT="$2"; shift 2 ;;
    --model)    MODEL="$2"; shift 2 ;;
    --dry-run)  DRY_RUN=true; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

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

MODEL_ARGS=()
[ -n "$MODEL" ] && MODEL_ARGS=(--model "$MODEL")

# Portable timeout: macOS has no coreutils `timeout` by default.
run_with_timeout() {
  local secs="$1"; shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$secs" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$secs" "$@"
  else
    "$@" &
    local pid=$!
    ( sleep "$secs"; kill -9 "$pid" 2>/dev/null ) &
    local killer=$!
    wait "$pid"; local rc=$?
    kill -9 "$killer" 2>/dev/null
    return $rc
  fi
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

echo "[verify] $COUNT finding(s) × $VOTERS skeptic(s) — trying to refute each."

: > "$OUT_DIR/votes.jsonl"

i=0
while [ "$i" -lt "$COUNT" ]; do
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

  v=0
  while [ "$v" -lt "$VOTERS" ]; do
    if [ "$DRY_RUN" = true ]; then
      out="VERDICT: STANDS — dry-run"
    else
      out="$(run_with_timeout "$TIMEOUT" \
            env BS_QUALITY_HEADLESS=1 \
            claude -p "$(verify_prompt "$F_FILE" "$F_LINE" "$F_SUM" "$F_DET")" \
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
    fi

    if printf '%s' "$out" | grep -qiE '^[[:space:]]*VERDICT:[[:space:]]*REFUTED'; then
      refuted=$((refuted + 1))
    else
      stands=$((stands + 1))
    fi
    v=$((v + 1))
  done

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

node -e '
  const fs = require("fs");
  const lines = fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean);
  fs.writeFileSync(process.argv[2], JSON.stringify(lines.map((l) => JSON.parse(l)), null, 2) + "\n");
' "$OUT_DIR/votes.jsonl" "$VERDICTS"

SURVIVING=$(node -e '
  const f = require("fs").readFileSync(process.argv[1], "utf8");
  process.stdout.write(String(JSON.parse(f).filter((x) => x.verified.survives).length));
' "$VERDICTS")

echo "[verify] $SURVIVING of $COUNT finding(s) survived adversarial verification."
echo "[verify] verdicts: $VERDICTS"
exit 0
