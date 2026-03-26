#!/bin/bash
# =============================================================================
# Learn Patterns - Auto-discover defensive coding patterns from existing code
# =============================================================================
# Scans a codebase and generates .defensive-patterns.json with discovered:
# - Auth middleware patterns (withAuth, requireAuth, etc.)
# - Safe parse helpers (safeJsonParse, zodParse, etc.)
# - Error handling patterns (try/catch styles)
# - useCallback usage patterns
# - Public routes
#
# Part of CS-089: Auto-Learn Patterns from Codebase
#
# USAGE:
#   ./scripts/learn-patterns.sh                    # Generate config
#   ./scripts/learn-patterns.sh --dry-run          # Preview only
#   ./scripts/learn-patterns.sh --merge            # Merge with existing
#   ./scripts/learn-patterns.sh --output FILE      # Custom output path
# =============================================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Configuration
DRY_RUN=false
MERGE_MODE=false
OUTPUT_FILE=".defensive-patterns.json"
SCAN_DIR="."
VERBOSE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --merge)
      MERGE_MODE=true
      shift
      ;;
    --output)
      OUTPUT_FILE="$2"
      shift 2
      ;;
    --verbose|-v)
      VERBOSE=true
      shift
      ;;
    --help|-h)
      echo "Usage: learn-patterns.sh [OPTIONS] [DIRECTORY]"
      echo ""
      echo "Options:"
      echo "  --dry-run    Preview discovered patterns without saving"
      echo "  --merge      Merge with existing .defensive-patterns.json"
      echo "  --output     Custom output file path (default: .defensive-patterns.json)"
      echo "  --verbose    Show detailed discovery output"
      echo "  --help       Show this help message"
      echo ""
      echo "Examples:"
      echo "  learn-patterns.sh                    # Scan current dir"
      echo "  learn-patterns.sh --dry-run          # Preview only"
      echo "  learn-patterns.sh ~/Projects/myapp   # Scan specific project"
      exit 0
      ;;
    -*)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
    *)
      # Only set SCAN_DIR if it's not a flag
      if [[ "$1" != -* ]]; then
        SCAN_DIR="$1"
      fi
      shift
      ;;
  esac
done

# Ensure we're in a valid directory
if [[ ! -d "$SCAN_DIR" ]]; then
  echo -e "${RED}Error: Directory not found: $SCAN_DIR${NC}"
  exit 1
fi

cd "$SCAN_DIR"

echo -e "${BLUE}🔍 Learning Defensive Patterns${NC}"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Scanning: $(pwd)"
echo "Output: $OUTPUT_FILE"
echo "Mode: $([[ "$DRY_RUN" == "true" ]] && echo "Preview only" || echo "Generate config")"
echo ""

# Temp files for collecting patterns
AUTH_PATTERNS=$(mktemp)
SAFE_PARSE_PATTERNS=$(mktemp)
PUBLIC_ROUTES=$(mktemp)
ERROR_HANDLERS=$(mktemp)
CALLBACK_PATTERNS=$(mktemp)

trap 'rm -f "$AUTH_PATTERNS" "$SAFE_PARSE_PATTERNS" "$PUBLIC_ROUTES" "$ERROR_HANDLERS" "$CALLBACK_PATTERNS"' EXIT

# =============================================================================
# Pattern Discovery Functions
# =============================================================================

discover_auth_middleware() {
  echo -e "${CYAN}1. Discovering auth middleware patterns...${NC}"

  # Common auth patterns to search for
  local patterns=(
    "withAuth"
    "requireAuth"
    "authenticate"
    "getSession"
    "getServerSession"
    "protectedProcedure"
    "authMiddleware"
    "checkAuth"
    "verifyAuth"
    "ensureAuthenticated"
    "requireLogin"
    "withSession"
    "authGuard"
    "isAuthenticated"
  )

  for pattern in "${patterns[@]}"; do
    # Search for function definitions or exports
    if grep -rq --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
      -E "(export.*function\s+$pattern|export\s+(const|let)\s+$pattern\s*=|function\s+$pattern)" . 2>/dev/null; then
      echo "$pattern" >> "$AUTH_PATTERNS"
      [[ "$VERBOSE" == "true" ]] && echo -e "  ${GREEN}✓${NC} Found: $pattern"
    fi

    # Also check for HOC-style usage: withAuth(Component)
    if grep -rq --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
      "$pattern\s*(" . 2>/dev/null; then
      echo "$pattern" >> "$AUTH_PATTERNS"
    fi
  done

  # Look for custom auth wrappers by analyzing HOC patterns
  # Pattern: export const withSomething = (Component) => { ... auth logic ... }
  grep -rho --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
    'export\s\+const\s\+\(with[A-Z][a-zA-Z]*\)' . 2>/dev/null | \
    sed 's/.*export const \([^ ]*\).*/\1/' | sort -u >> "$AUTH_PATTERNS" 2>/dev/null || true

  # tRPC-style protected procedures
  grep -rho --include="*.ts" --include="*.tsx" \
    '\(protected[A-Z][a-zA-Z]*\|auth[A-Z][a-zA-Z]*Procedure\)' . 2>/dev/null | \
    sort -u >> "$AUTH_PATTERNS" 2>/dev/null || true

  # Deduplicate
  sort -u "$AUTH_PATTERNS" -o "$AUTH_PATTERNS"

  local count=$(wc -l < "$AUTH_PATTERNS" | tr -d ' ')
  echo -e "   Found ${GREEN}$count${NC} auth patterns"
}

discover_safe_parse_helpers() {
  echo -e "${CYAN}2. Discovering safe parse helpers...${NC}"

  # Common safe parsing patterns
  local patterns=(
    "safeJsonParse"
    "safeParse"
    "tryParse"
    "parseJSON"
    "parseJsonSafe"
    "zodParse"
    ".safeParse"
    "z.safeParse"
    "validateJSON"
    "parseWithSchema"
  )

  for pattern in "${patterns[@]}"; do
    # Search for function definitions
    if grep -rq --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
      -E "(function\s+${pattern//./\\.}|const\s+${pattern//./\\.}\s*=)" . 2>/dev/null; then
      echo "$pattern" >> "$SAFE_PARSE_PATTERNS"
      [[ "$VERBOSE" == "true" ]] && echo -e "  ${GREEN}✓${NC} Found: $pattern"
    fi
  done

  # Look for custom parse utilities
  grep -rho --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
    'export\s\+\(function\|const\)\s\+\(safe[A-Z][a-zA-Z]*\|try[A-Z][a-zA-Z]*Parse\|parse[A-Z][a-zA-Z]*Safe\)' . 2>/dev/null | \
    sed 's/.*export [^[:space:]]* \([^ (]*\).*/\1/' | sort -u >> "$SAFE_PARSE_PATTERNS" 2>/dev/null || true

  # Check for Zod usage patterns
  if grep -rq --include="*.ts" --include="*.tsx" "from.*'zod'\|from.*\"zod\"" . 2>/dev/null; then
    echo ".safeParse" >> "$SAFE_PARSE_PATTERNS"
    [[ "$VERBOSE" == "true" ]] && echo -e "  ${GREEN}✓${NC} Found: Zod .safeParse pattern"
  fi

  # Deduplicate
  sort -u "$SAFE_PARSE_PATTERNS" -o "$SAFE_PARSE_PATTERNS"

  local count=$(wc -l < "$SAFE_PARSE_PATTERNS" | tr -d ' ')
  echo -e "   Found ${GREEN}$count${NC} safe parse patterns"
}

discover_public_routes() {
  echo -e "${CYAN}3. Discovering public routes...${NC}"

  # Look for files with PUBLIC comments or @public annotations
  grep -rl --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
    -E '(PUBLIC.ROUTE|@public|isPublic.*=.*true)' . 2>/dev/null | while read -r file; do
    # Extract route path from filename
    if [[ "$file" =~ /api/ ]]; then
      # Convert file path to API route path
      local route_path="${file#./}"
      route_path="/api/${route_path#*api/}"
      route_path="${route_path%/route.*}"
      route_path="${route_path%/index.*}"
      route_path="${route_path%.ts}"
      route_path="${route_path%.tsx}"
      route_path="${route_path%.js}"
      echo "$route_path" >> "$PUBLIC_ROUTES"
      [[ "$VERBOSE" == "true" ]] && echo -e "  ${GREEN}✓${NC} Found public: $route_path"
    fi
  done

  # Common public routes to check
  local common_public=(
    "/api/health"
    "/api/status"
    "/api/webhooks/*"
    "/api/cron/*"
    "/api/public/*"
  )

  for route in "${common_public[@]}"; do
    local route_dir="${route#/api/}"
    route_dir="${route_dir%/*}"
    if [[ -d "app/api/$route_dir" ]] || [[ -d "pages/api/$route_dir" ]] || [[ -d "src/app/api/$route_dir" ]]; then
      echo "$route" >> "$PUBLIC_ROUTES"
      [[ "$VERBOSE" == "true" ]] && echo -e "  ${GREEN}✓${NC} Found common public: $route"
    fi
  done

  # Deduplicate
  sort -u "$PUBLIC_ROUTES" -o "$PUBLIC_ROUTES"

  local count=$(wc -l < "$PUBLIC_ROUTES" | tr -d ' ')
  echo -e "   Found ${GREEN}$count${NC} public routes"
}

discover_error_handlers() {
  echo -e "${CYAN}4. Analyzing error handling patterns...${NC}"

  # Count different error handling styles
  local try_catch_count=$(grep -r --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
    "try\s*{" . 2>/dev/null | wc -l | tr -d ' ')

  local result_pattern_count=$(grep -r --include="*.ts" --include="*.tsx" \
    -E "(Result<|Ok\(|Err\(|\.unwrap\(|\.expect\()" . 2>/dev/null | wc -l | tr -d ' ')

  local error_boundary_count=$(grep -r --include="*.tsx" --include="*.jsx" \
    "ErrorBoundary" . 2>/dev/null | wc -l | tr -d ' ')

  echo "try_catch:$try_catch_count" >> "$ERROR_HANDLERS"
  echo "result_pattern:$result_pattern_count" >> "$ERROR_HANDLERS"
  echo "error_boundary:$error_boundary_count" >> "$ERROR_HANDLERS"

  echo -e "   try/catch: ${try_catch_count}, Result pattern: ${result_pattern_count}, ErrorBoundary: ${error_boundary_count}"
}

discover_callback_patterns() {
  echo -e "${CYAN}5. Analyzing React callback patterns...${NC}"

  # Count useCallback usage
  local use_callback_count=$(grep -r --include="*.tsx" --include="*.jsx" \
    "useCallback\s*(" . 2>/dev/null | wc -l | tr -d ' ')

  # Count inline arrow handlers (potential issues)
  local inline_handler_count=$(grep -r --include="*.tsx" --include="*.jsx" \
    "on[A-Z][a-zA-Z]*={\s*(" . 2>/dev/null | wc -l | tr -d ' ')

  echo "useCallback:$use_callback_count" >> "$CALLBACK_PATTERNS"
  echo "inlineHandlers:$inline_handler_count" >> "$CALLBACK_PATTERNS"

  local ratio="N/A"
  if [[ $inline_handler_count -gt 0 ]]; then
    ratio=$(echo "scale=2; $use_callback_count / $inline_handler_count" | bc 2>/dev/null || echo "N/A")
  fi

  echo -e "   useCallback: ${use_callback_count}, Inline handlers: ${inline_handler_count}, Ratio: ${ratio}"
}

# =============================================================================
# Generate Config
# =============================================================================

generate_config() {
  echo ""
  echo -e "${BLUE}📝 Generating Configuration${NC}"
  echo "═══════════════════════════════════════════════════════════"

  # Build JSON arrays
  local auth_array=""
  while IFS= read -r pattern; do
    [[ -z "$pattern" ]] && continue
    [[ -n "$auth_array" ]] && auth_array+=","
    auth_array+="\"$pattern\""
  done < "$AUTH_PATTERNS"

  local safe_parse_array=""
  while IFS= read -r pattern; do
    [[ -z "$pattern" ]] && continue
    [[ -n "$safe_parse_array" ]] && safe_parse_array+=","
    safe_parse_array+="\"$pattern\""
  done < "$SAFE_PARSE_PATTERNS"

  local public_routes_array=""
  while IFS= read -r route; do
    [[ -z "$route" ]] && continue
    [[ -n "$public_routes_array" ]] && public_routes_array+=","
    public_routes_array+="\"$route\""
  done < "$PUBLIC_ROUTES"

  # Generate config JSON
  local config=$(cat << EOF
{
  "_comment": "Auto-generated by learn-patterns.sh (CS-089). Edit as needed.",
  "_generated": "$(date -Iseconds)",
  "authMiddleware": [${auth_array:-"\"withAuth\"", "\"requireAuth\"", "\"getSession\""}],
  "safeParseHelpers": [${safe_parse_array:-"\".safeParse\"", "\"safeJsonParse\""}],
  "publicRoutes": [${public_routes_array:-"\"/api/health\"", "\"/api/webhooks/*\""}],
  "disabled": [],
  "excludePaths": [
    "node_modules/**",
    "dist/**",
    "build/**",
    ".next/**",
    "coverage/**",
    "*.test.ts",
    "*.spec.ts",
    "__tests__/**"
  ]
}
EOF
)

  echo ""
  echo -e "${CYAN}Generated .defensive-patterns.json:${NC}"
  echo "───────────────────────────────────────────────────────────"
  echo "$config" | jq '.' 2>/dev/null || echo "$config"
  echo "───────────────────────────────────────────────────────────"

  if [[ "$DRY_RUN" == "true" ]]; then
    echo ""
    echo -e "${YELLOW}Dry run mode - no file written${NC}"
    echo "Run without --dry-run to save the config."
    return
  fi

  # Handle merge mode
  if [[ "$MERGE_MODE" == "true" ]] && [[ -f "$OUTPUT_FILE" ]]; then
    echo ""
    echo -e "${CYAN}Merging with existing config...${NC}"

    # Use jq to merge if available
    if command -v jq &> /dev/null; then
      local existing=$(cat "$OUTPUT_FILE")
      local merged=$(echo "$existing" | jq --argjson new "$config" '
        .authMiddleware = ((.authMiddleware // []) + ($new.authMiddleware // []) | unique) |
        .safeParseHelpers = ((.safeParseHelpers // []) + ($new.safeParseHelpers // []) | unique) |
        .publicRoutes = ((.publicRoutes // []) + ($new.publicRoutes // []) | unique) |
        .excludePaths = ((.excludePaths // []) + ($new.excludePaths // []) | unique) |
        ._merged = true |
        ._mergedAt = now | strftime("%Y-%m-%dT%H:%M:%SZ")
      ')
      echo "$merged" > "$OUTPUT_FILE"
      echo -e "${GREEN}✓${NC} Merged with existing config"
    else
      echo -e "${YELLOW}Warning: jq not found, overwriting instead of merging${NC}"
      echo "$config" > "$OUTPUT_FILE"
    fi
  else
    # Write new config
    echo "$config" > "$OUTPUT_FILE"
  fi

  echo ""
  echo -e "${GREEN}✓ Config saved to: $OUTPUT_FILE${NC}"
}

# =============================================================================
# Summary
# =============================================================================

print_summary() {
  echo ""
  echo -e "${BLUE}📊 Discovery Summary${NC}"
  echo "═══════════════════════════════════════════════════════════"

  local auth_count=$(wc -l < "$AUTH_PATTERNS" | tr -d ' ')
  local safe_count=$(wc -l < "$SAFE_PARSE_PATTERNS" | tr -d ' ')
  local route_count=$(wc -l < "$PUBLIC_ROUTES" | tr -d ' ')

  echo ""
  echo "  Auth Middleware:   $auth_count patterns"
  echo "  Safe Parse:        $safe_count helpers"
  echo "  Public Routes:     $route_count routes"
  echo ""

  # Recommendations
  echo -e "${CYAN}Recommendations:${NC}"

  if [[ $auth_count -eq 0 ]]; then
    echo -e "  ${YELLOW}⚠${NC}  No auth middleware found - consider adding authentication patterns"
  fi

  if [[ $safe_count -eq 0 ]]; then
    echo -e "  ${YELLOW}⚠${NC}  No safe parse helpers found - consider wrapping JSON.parse with try/catch"
  fi

  # Check for Zod
  if grep -rq --include="*.ts" --include="*.tsx" "from.*'zod'" . 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC}  Zod detected - .safeParse pattern should be enabled"
  fi

  # Check for tRPC
  if grep -rq --include="*.ts" --include="*.tsx" "from.*'@trpc" . 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC}  tRPC detected - protectedProcedure patterns may apply"
  fi

  echo ""
}

# =============================================================================
# Main
# =============================================================================

main() {
  discover_auth_middleware
  echo ""
  discover_safe_parse_helpers
  echo ""
  discover_public_routes
  echo ""
  discover_error_handlers
  echo ""
  discover_callback_patterns

  print_summary
  generate_config

  echo ""
  echo -e "${GREEN}✅ Pattern learning complete!${NC}"
  echo ""
  echo "Next steps:"
  echo "  1. Review the generated config"
  echo "  2. Add any custom patterns specific to your project"
  echo "  3. Run 'scripts/pattern-check.sh --all' to verify"
  echo ""
}

main
