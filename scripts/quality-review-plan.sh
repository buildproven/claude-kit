#!/usr/bin/env bash
# Mechanical provider-equivalent review depth. Claude realizes depth through
# its selected agent panel; Codex realizes it through a tier-specific scope.
# The caller must first load the explicit invocation manifest.
QUALITY_REVIEW_TIER="${TIER:-${QUALITY_REVIEW_TIER:-medium}}"
PLANNED_REVIEW_TIMEOUT="${QUALITY_REVIEW_TIMEOUT:-}"
case "$QUALITY_REVIEW_TIER" in
  low) QUALITY_REVIEW_TIMEOUT=120; QUALITY_REVIEW_FOCUS="Focused regression review of changed behavior only." ;;
  medium|95) QUALITY_REVIEW_TIMEOUT=480; QUALITY_REVIEW_FOCUS="Broad correctness, security, type-safety, and silent-failure review." ;;
  high|98) QUALITY_REVIEW_TIMEOUT=900; QUALITY_REVIEW_FOCUS="Deep adversarial review: bugs, security, data loss, races, compatibility, and rollback safety." ;;
  critical) QUALITY_REVIEW_TIMEOUT=900; QUALITY_REVIEW_FOCUS="Critical release-veto review. Assume the change is unsafe; require concrete evidence before approval. Check security, data loss, supply chain, deployment, rollback, and break-glass behavior." ;;
  *) echo "quality: invalid review tier '$QUALITY_REVIEW_TIER'" >&2; return 1 2>/dev/null || exit 1 ;;
esac
QUALITY_REVIEW_TIMEOUT="${PLANNED_REVIEW_TIMEOUT:-$QUALITY_REVIEW_TIMEOUT}"
QUALITY_REVIEW_TIMEOUT="${BS_QUALITY_REVIEW_TIMEOUT:-$QUALITY_REVIEW_TIMEOUT}"
QUALITY_REVIEW_DEPTH="${CODEX_DEPTH:-$QUALITY_REVIEW_TIER}"
case "$QUALITY_REVIEW_DEPTH" in
  skip|low) QUALITY_REVIEW_DEPTH=low ;;
  medium|95) QUALITY_REVIEW_DEPTH=medium ;;
  high|98|critical) QUALITY_REVIEW_DEPTH=high ;;
  xhigh|max) ;;
  *) echo "quality: invalid Codex review effort '$QUALITY_REVIEW_DEPTH'" >&2; return 1 2>/dev/null || exit 1 ;;
esac
# Provider model choice is task-scoped and mechanical. The caller's interactive
# Codex model is intentionally irrelevant: routine reviews use the balanced
# model, while only critical release-veto work pays for the flagship model.
case "$QUALITY_REVIEW_TIER" in
  low) QUALITY_CODEX_MODEL=gpt-5.6-luna ;;
  medium|95|high|98) QUALITY_CODEX_MODEL=gpt-5.6-terra ;;
  critical) QUALITY_CODEX_MODEL=gpt-5.6-sol ;;
esac
QUALITY_CODEX_MODEL="${BS_QUALITY_CODEX_MODEL:-$QUALITY_CODEX_MODEL}"
QUALITY_REVIEW_PASSES="${CODEX_ROUNDS:-1}"
[ "$QUALITY_REVIEW_PASSES" -ge 1 ] 2>/dev/null || QUALITY_REVIEW_PASSES=1
export QUALITY_REVIEW_TIER QUALITY_REVIEW_TIMEOUT QUALITY_REVIEW_FOCUS QUALITY_REVIEW_DEPTH QUALITY_CODEX_MODEL QUALITY_REVIEW_PASSES
