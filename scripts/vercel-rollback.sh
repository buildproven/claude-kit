#!/bin/bash

# vercel-rollback.sh - Vercel deployment rollback helper
# Part of CS-074: Deployment Rollback in git-sync
#
# Usage:
#   ./scripts/vercel-rollback.sh [--dry-run] [--deployment-id <id>]
#
# Examples:
#   ./scripts/vercel-rollback.sh                     # Rollback to previous deployment
#   ./scripts/vercel-rollback.sh --dry-run           # Show what would be rolled back
#   ./scripts/vercel-rollback.sh --deployment-id xyz # Rollback to specific deployment

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
DRY_RUN=false
TARGET_DEPLOYMENT=""
LOG_FILE=".claude/rollback-log.json"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --deployment-id)
      TARGET_DEPLOYMENT="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--dry-run] [--deployment-id <id>]"
      echo ""
      echo "Options:"
      echo "  --dry-run           Show what would be rolled back without doing it"
      echo "  --deployment-id     Rollback to a specific deployment ID"
      echo "  -h, --help          Show this help message"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Ensure we're in a Vercel project
if [ ! -d ".vercel" ] && [ ! -f "vercel.json" ]; then
  echo -e "${RED}Error: Not a Vercel project (no .vercel folder or vercel.json)${NC}"
  exit 1
fi

# Ensure vercel CLI is available
if ! command -v vercel &> /dev/null; then
  echo -e "${RED}Error: Vercel CLI not installed. Run: npm i -g vercel${NC}"
  exit 1
fi

echo -e "${BLUE}=== Vercel Deployment Rollback ===${NC}"
echo ""

# Get current production deployment
echo -e "${BLUE}Fetching current deployment...${NC}"
CURRENT_DEPLOYMENT=$(vercel ls --prod 2>/dev/null | grep -E "^[a-z]" | head -1 | awk '{print $1}' || echo "")

if [ -z "$CURRENT_DEPLOYMENT" ]; then
  echo -e "${YELLOW}Warning: Could not determine current deployment${NC}"
fi

echo -e "Current production deployment: ${GREEN}${CURRENT_DEPLOYMENT:-"(unknown)"}${NC}"

# Get previous deployment if no target specified
if [ -z "$TARGET_DEPLOYMENT" ]; then
  echo -e "${BLUE}Fetching previous deployment...${NC}"

  # Get the second most recent production deployment
  PREV_DEPLOYMENT=$(vercel ls --prod 2>/dev/null | grep -E "^[a-z]" | head -2 | tail -1 | awk '{print $1}' || echo "")

  if [ -z "$PREV_DEPLOYMENT" ]; then
    echo -e "${RED}Error: No previous deployment found${NC}"
    exit 1
  fi

  TARGET_DEPLOYMENT="$PREV_DEPLOYMENT"
fi

echo -e "Target deployment for rollback: ${GREEN}${TARGET_DEPLOYMENT}${NC}"

# Get deployment details
echo ""
echo -e "${BLUE}Deployment details:${NC}"
vercel inspect "$TARGET_DEPLOYMENT" 2>/dev/null || echo -e "${YELLOW}Could not inspect deployment${NC}"

# Confirm rollback
echo ""
if [ "$DRY_RUN" = true ]; then
  echo -e "${YELLOW}DRY RUN - Would promote: ${TARGET_DEPLOYMENT}${NC}"
  echo -e "${YELLOW}No changes made.${NC}"
  exit 0
fi

# Perform the rollback
echo -e "${BLUE}Promoting ${TARGET_DEPLOYMENT} to production...${NC}"

if vercel promote "$TARGET_DEPLOYMENT" --yes 2>/dev/null; then
  ROLLBACK_SUCCESS=true
  echo -e "${GREEN}Rollback successful!${NC}"
else
  # Fallback: try using vercel alias
  echo -e "${YELLOW}Promote failed, trying alias method...${NC}"

  # Get the production domain
  PROD_DOMAIN=$(vercel domains ls 2>/dev/null | grep -E "Production" | awk '{print $1}' || echo "")

  if [ -n "$PROD_DOMAIN" ]; then
    if vercel alias "$TARGET_DEPLOYMENT" "$PROD_DOMAIN" --yes 2>/dev/null; then
      ROLLBACK_SUCCESS=true
      echo -e "${GREEN}Rollback successful via alias!${NC}"
    else
      ROLLBACK_SUCCESS=false
      echo -e "${RED}Rollback failed!${NC}"
    fi
  else
    ROLLBACK_SUCCESS=false
    echo -e "${RED}Could not determine production domain. Rollback failed.${NC}"
  fi
fi

# Log the rollback
echo ""
echo -e "${BLUE}Logging rollback...${NC}"

mkdir -p "$(dirname "$LOG_FILE")"

# Create or append to log file
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
PROJECT_NAME=$(basename "$(pwd)")

# Build log entry
LOG_ENTRY=$(cat <<EOF
{
  "timestamp": "$TIMESTAMP",
  "project": "$PROJECT_NAME",
  "from_deployment": "$CURRENT_DEPLOYMENT",
  "to_deployment": "$TARGET_DEPLOYMENT",
  "success": $ROLLBACK_SUCCESS,
  "triggered_by": "manual"
}
EOF
)

# Append to log (create array if new file)
if [ -f "$LOG_FILE" ]; then
  # Add to existing array
  TMP_FILE=$(mktemp)
  jq --argjson entry "$LOG_ENTRY" '. + [$entry]' "$LOG_FILE" > "$TMP_FILE" 2>/dev/null || echo "[$LOG_ENTRY]" > "$TMP_FILE"
  mv "$TMP_FILE" "$LOG_FILE"
else
  echo "[$LOG_ENTRY]" > "$LOG_FILE"
fi

echo -e "${GREEN}Rollback logged to $LOG_FILE${NC}"

# Summary
echo ""
echo -e "${BLUE}=== Rollback Summary ===${NC}"
echo -e "From: ${RED}$CURRENT_DEPLOYMENT${NC}"
echo -e "To:   ${GREEN}$TARGET_DEPLOYMENT${NC}"
echo -e "Status: $([ "$ROLLBACK_SUCCESS" = true ] && echo -e "${GREEN}SUCCESS${NC}" || echo -e "${RED}FAILED${NC}")"
echo -e "Time: $TIMESTAMP"

if [ "$ROLLBACK_SUCCESS" = true ]; then
  echo ""
  echo -e "${GREEN}Production has been restored to the previous deployment.${NC}"
  echo ""
  echo -e "${YELLOW}Next steps:${NC}"
  echo "1. Investigate why the deployment failed"
  echo "2. Fix the issue locally"
  echo "3. Run /bs:quality --merge to redeploy"
  exit 0
else
  echo ""
  echo -e "${RED}Rollback failed. Manual intervention required.${NC}"
  echo ""
  echo "Try manually:"
  echo "  vercel promote $TARGET_DEPLOYMENT --yes"
  exit 1
fi
