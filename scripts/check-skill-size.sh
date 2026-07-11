#!/usr/bin/env bash
# Fail if any SKILL.md exceeds the compaction re-attach budget.
#
# WHY (https://code.claude.com/docs/en/skills#skill-content-lifecycle):
#   "When the conversation is summarized to free context, Claude Code re-attaches
#    the most recent invocation of each skill after the summary, KEEPING THE FIRST
#    5,000 TOKENS OF EACH."
#
# A skill over that budget is SILENTLY TRUNCATED after any compaction — the tail
# of the file just stops existing. For skills/quality that meant its own merge
# gates and the round-cap governor (both late in the file) vanished exactly in the
# long sessions most likely to compact. Silent, and worst when it matters most.
#
# The docs also warn: "Once a skill loads, its content stays in context across
# turns, so every line is a recurring token cost."
#
# Fix a violation with progressive disclosure — move detail into reference.md /
# checklist.md / scripts/ and keep SKILL.md to the flow, the gates, and navigation.
set -euo pipefail

MAX_TOKENS="${SKILL_MAX_TOKENS:-5000}"
ROOT="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
violations=0

while IFS= read -r skill; do
  words=$(wc -w < "$skill" | tr -d ' ')
  # ~1.3 tokens/word for English prose + code. Deliberately conservative: it is
  # better to flag a skill slightly under the real limit than to let one sit
  # silently over it.
  tokens=$(( words * 13 / 10 ))
  if [ "$tokens" -gt "$MAX_TOKENS" ]; then
    rel="${skill#"$ROOT"/}"
    echo "❌ $rel — ~${tokens} tokens (cap ${MAX_TOKENS})"
    echo "   Truncated after compaction: everything past ~${MAX_TOKENS} tokens is dropped."
    echo "   Split into reference.md / checklist.md / scripts/ (progressive disclosure)."
    violations=$((violations + 1))
  fi
done < <(find "$ROOT/skills" -name SKILL.md -not -path '*/node_modules/*' 2>/dev/null | sort)

if [ "$violations" -gt 0 ]; then
  echo ""
  echo "$violations skill(s) over the ${MAX_TOKENS}-token compaction budget."
  exit 1
fi

echo "✅ All skills within the ${MAX_TOKENS}-token compaction re-attach budget."
