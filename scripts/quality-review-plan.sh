#!/usr/bin/env bash
# Mechanical provider-equivalent review depth. Claude realizes depth through
# its selected agent panel; Codex realizes it through a tier-specific scope.
QUALITY_REVIEW_TIER="${TIER:-${QUALITY_REVIEW_TIER:-medium}}"
case "$QUALITY_REVIEW_TIER" in
  low) QUALITY_REVIEW_TIMEOUT=120; QUALITY_REVIEW_FOCUS="Focused regression review of changed behavior only." ;;
  medium|95) QUALITY_REVIEW_TIMEOUT=480; QUALITY_REVIEW_FOCUS="Broad correctness, security, type-safety, and silent-failure review." ;;
  high|98) QUALITY_REVIEW_TIMEOUT=900; QUALITY_REVIEW_FOCUS="Deep adversarial review: bugs, security, data loss, races, compatibility, and rollback safety." ;;
  critical) QUALITY_REVIEW_TIMEOUT=900; QUALITY_REVIEW_FOCUS="Critical release-veto review. Assume the change is unsafe; require concrete evidence before approval. Check security, data loss, supply chain, deployment, rollback, and break-glass behavior." ;;
  *) echo "quality: invalid review tier '$QUALITY_REVIEW_TIER'" >&2; return 1 2>/dev/null || exit 1 ;;
esac
QUALITY_REVIEW_TIMEOUT="${BS_QUALITY_REVIEW_TIMEOUT:-$QUALITY_REVIEW_TIMEOUT}"
export QUALITY_REVIEW_TIER QUALITY_REVIEW_TIMEOUT QUALITY_REVIEW_FOCUS
