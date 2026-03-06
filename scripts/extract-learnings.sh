#!/bin/bash
# Extract learnings from session files and CLAUDE.md for agent context injection
# Part of CS-073: Agent Learning Integration

set -eo pipefail

# Configuration
SESSION_LEARNINGS_FILE="${PWD}/.claude/session-learnings.md"
LEARNING_INDEX_FILE="${PWD}/.claude/learning-index.json"
CLAUDE_MD_FILE="${PWD}/CLAUDE.md"
GLOBAL_CLAUDE_MD="${HOME}/.claude/CLAUDE.md"

# Default limits
DEFAULT_RECENT_LEARNINGS=10
DEFAULT_RELEVANT_PATTERNS=5

# Initialize learning index if it doesn't exist
init_learning_index() {
  local index_file="${1:-$LEARNING_INDEX_FILE}"

  if [ ! -f "$index_file" ]; then
    mkdir -p "$(dirname "$index_file")"
    cat > "$index_file" <<'EOF'
{
  "version": "1.0",
  "lastUpdated": null,
  "learnings": []
}
EOF
  fi
}

# Add a learning to the index
add_learning() {
  local id="$1"
  local topic="$2"
  local keywords="$3"  # comma-separated
  local learning="$4"
  local date="${5:-$(date +%Y-%m-%d)}"

  init_learning_index

  if ! command -v jq &> /dev/null; then
    echo "Error: jq is required. Install with 'brew install jq'" >&2
    return 1
  fi

  # Convert comma-separated keywords to JSON array
  local keywords_json=$(echo "$keywords" | tr ',' '\n' | jq -R . | jq -s .)

  local tmp_file="${LEARNING_INDEX_FILE}.tmp"
  jq --arg id "$id" \
     --arg topic "$topic" \
     --argjson keywords "$keywords_json" \
     --arg learning "$learning" \
     --arg date "$date" \
     '
     .lastUpdated = (now | strftime("%Y-%m-%dT%H:%M:%SZ")) |
     .learnings = (.learnings | map(select(.id != $id))) + [{
       id: $id,
       topic: $topic,
       keywords: $keywords,
       learning: $learning,
       date: $date
     }]
     ' "$LEARNING_INDEX_FILE" > "$tmp_file" && mv "$tmp_file" "$LEARNING_INDEX_FILE"

  echo "Added learning for $id: $topic"
}

# Search learnings by keyword
search_learnings() {
  local query="$1"
  local limit="${2:-$DEFAULT_RELEVANT_PATTERNS}"

  if [ ! -f "$LEARNING_INDEX_FILE" ]; then
    echo "[]"
    return
  fi

  if ! command -v jq &> /dev/null; then
    echo "Error: jq is required" >&2
    return 1
  fi

  # Search in topic, keywords, and learning text (case-insensitive)
  jq --arg query "$query" --argjson limit "$limit" '
    .learnings
    | map(select(
        (.topic | ascii_downcase | contains($query | ascii_downcase)) or
        (.learning | ascii_downcase | contains($query | ascii_downcase)) or
        (.keywords | map(ascii_downcase) | any(contains($query | ascii_downcase)))
      ))
    | sort_by(.date) | reverse
    | .[:$limit]
  ' "$LEARNING_INDEX_FILE"
}

# Get recent learnings (last N items by date)
get_recent_learnings() {
  local limit="${1:-$DEFAULT_RECENT_LEARNINGS}"

  if [ ! -f "$LEARNING_INDEX_FILE" ]; then
    echo "[]"
    return
  fi

  jq --argjson limit "$limit" '
    .learnings
    | sort_by(.date) | reverse
    | .[:$limit]
  ' "$LEARNING_INDEX_FILE"
}

# Extract learnings from session-learnings.md (last N items)
extract_session_learnings() {
  local limit="${1:-$DEFAULT_RECENT_LEARNINGS}"
  local learnings_file="${2:-$SESSION_LEARNINGS_FILE}"

  if [ ! -f "$learnings_file" ]; then
    echo "No session learnings file found at $learnings_file" >&2
    return 0
  fi

  # Extract item sections from session learnings
  # Each section starts with "## CS-XXX:" or "## [ID]:"
  awk -v limit="$limit" '
    /^## [A-Z]+-[0-9]+:/ {
      if (item_count >= limit) exit
      if (in_item) {
        print item_content
        print ""
      }
      in_item = 1
      item_count++
      item_content = $0
      next
    }
    in_item && /^---$/ {
      print item_content
      print ""
      in_item = 0
      item_content = ""
      next
    }
    in_item {
      item_content = item_content "\n" $0
    }
    END {
      if (in_item && item_content != "") {
        print item_content
      }
    }
  ' "$learnings_file"
}

# Extract relevant patterns from CLAUDE.md based on keywords
extract_claude_patterns() {
  local keywords="$1"  # comma-separated keywords
  local limit="${2:-$DEFAULT_RELEVANT_PATTERNS}"
  local claude_file="${3:-$CLAUDE_MD_FILE}"

  # Try project CLAUDE.md first, then global
  if [ ! -f "$claude_file" ]; then
    claude_file="$GLOBAL_CLAUDE_MD"
  fi

  if [ ! -f "$claude_file" ]; then
    echo "No CLAUDE.md found" >&2
    return 0
  fi

  # Convert keywords to grep pattern
  local pattern=$(echo "$keywords" | tr ',' '|')

  # Find sections containing keywords (### level headings)
  # Extract the section header and content until next ### or ##
  awk -v pattern="$pattern" -v limit="$limit" '
    BEGIN {
      IGNORECASE = 1
      found_count = 0
    }
    /^###/ {
      if (in_section && section_matches) {
        print section_content
        print ""
        found_count++
      }
      in_section = 1
      section_content = $0
      section_matches = 0
      if ($0 ~ pattern) section_matches = 1
      next
    }
    /^##[^#]/ {
      if (in_section && section_matches) {
        print section_content
        print ""
        found_count++
      }
      in_section = 0
      section_content = ""
      section_matches = 0
      next
    }
    in_section {
      section_content = section_content "\n" $0
      if ($0 ~ pattern) section_matches = 1
      if (found_count >= limit) exit
    }
    END {
      if (in_section && section_matches && found_count < limit) {
        print section_content
      }
    }
  ' "$claude_file"
}

# Format learnings for agent prompt injection
format_learnings_for_prompt() {
  local item_id="${1:-}"
  local keywords="${2:-}"
  local output=""

  # Header
  output="## Relevant Learnings\n\n"

  # Recent session learnings
  local session_learnings=""
  if [ -f "$SESSION_LEARNINGS_FILE" ]; then
    session_learnings=$(extract_session_learnings 5)
  fi

  # Index-based learnings (search by keywords if provided, else recent)
  local index_learnings=""
  if [ -n "$keywords" ] && [ -f "$LEARNING_INDEX_FILE" ]; then
    index_learnings=$(search_learnings "$keywords" 5)
  elif [ -f "$LEARNING_INDEX_FILE" ]; then
    index_learnings=$(get_recent_learnings 5)
  fi

  # Format indexed learnings
  if [ -n "$index_learnings" ] && [ "$index_learnings" != "[]" ]; then
    output+="### From Previous Items\n\n"

    # Parse JSON and format
    echo "$index_learnings" | jq -r '.[] | "From \(.id) (\(.topic)):\n- \(.learning)\n"' 2>/dev/null | while read -r line; do
      output+="$line"
    done
    output+="\n"
  fi

  # Claude.md patterns
  if [ -n "$keywords" ]; then
    local patterns=$(extract_claude_patterns "$keywords" 3)
    if [ -n "$patterns" ]; then
      output+="### From CLAUDE.md Patterns\n\n"
      output+="$patterns\n"
    fi
  fi

  echo -e "$output"
}

# Sync learnings from ralph-dev state to learning index
sync_from_ralph_state() {
  local state_file="${1:-$PWD/.claude/ralph-dev-state.json}"

  if [ ! -f "$state_file" ]; then
    echo "No ralph-dev state file found at $state_file" >&2
    return 1
  fi

  init_learning_index

  # Extract learnings from each item in state
  jq -r '.items[] | select(.learnings != null and (.learnings | length) > 0) | "\(.id)|\(.description)|\(.completedAt // "")|\(.learnings | join("; "))"' "$state_file" | while IFS='|' read -r id desc date learnings; do
    # Extract keywords from description (first 3 significant words)
    local keywords=$(echo "$desc" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '\n' | grep -v '^$' | head -5 | tr '\n' ',')
    keywords="${keywords%,}"  # Remove trailing comma

    # Format date
    if [ -n "$date" ]; then
      date=$(echo "$date" | cut -d'T' -f1)
    else
      date=$(date +%Y-%m-%d)
    fi

    # Add to index (skips if already exists with same ID)
    add_learning "$id" "$desc" "$keywords" "$learnings" "$date" 2>/dev/null || true
  done

  echo "Synced learnings from ralph-dev state to learning index"
}

# Get learning by item ID
get_learning_by_id() {
  local id="$1"

  if [ ! -f "$LEARNING_INDEX_FILE" ]; then
    echo "null"
    return
  fi

  jq --arg id "$id" '.learnings[] | select(.id == $id)' "$LEARNING_INDEX_FILE"
}

# Main command dispatcher
case "${1:-help}" in
  add)
    # add <id> <topic> <keywords> <learning> [date]
    add_learning "${2}" "${3}" "${4}" "${5}" "${6:-}"
    ;;
  search)
    # search <query> [limit]
    search_learnings "${2}" "${3:-$DEFAULT_RELEVANT_PATTERNS}"
    ;;
  recent)
    # recent [limit]
    get_recent_learnings "${2:-$DEFAULT_RECENT_LEARNINGS}"
    ;;
  session)
    # session [limit]
    extract_session_learnings "${2:-$DEFAULT_RECENT_LEARNINGS}"
    ;;
  patterns)
    # patterns <keywords> [limit]
    extract_claude_patterns "${2}" "${3:-$DEFAULT_RELEVANT_PATTERNS}"
    ;;
  format)
    # format [item_id] [keywords]
    format_learnings_for_prompt "${2:-}" "${3:-}"
    ;;
  sync)
    # sync [state_file]
    sync_from_ralph_state "${2:-}"
    ;;
  get)
    # get <id>
    get_learning_by_id "${2}"
    ;;
  init)
    init_learning_index
    echo "Learning index initialized at $LEARNING_INDEX_FILE"
    ;;
  help|*)
    cat <<EOF
Extract Learnings - Agent Learning Integration (CS-073)

Usage:
  extract-learnings.sh add <id> <topic> <keywords> <learning> [date]
  extract-learnings.sh search <query> [limit]
  extract-learnings.sh recent [limit]
  extract-learnings.sh session [limit]
  extract-learnings.sh patterns <keywords> [limit]
  extract-learnings.sh format [item_id] [keywords]
  extract-learnings.sh sync [state_file]
  extract-learnings.sh get <id>
  extract-learnings.sh init

Commands:
  add       Add a learning to the index
  search    Search learnings by keyword
  recent    Get recent learnings from index
  session   Extract learnings from session-learnings.md
  patterns  Extract relevant patterns from CLAUDE.md
  format    Format learnings for agent prompt injection
  sync      Sync learnings from ralph-dev state to index
  get       Get learning by item ID
  init      Initialize the learning index file

Examples:
  # Add a learning
  extract-learnings.sh add "CS-055" "cost-tracking" "bash,jq,json" "Bash 3.2 compatibility - use case statements"

  # Search for relevant learnings
  extract-learnings.sh search "bash" 5

  # Get formatted learnings for agent prompt
  extract-learnings.sh format "CS-073" "bash,agent,learning"

  # Sync from ralph-dev state
  extract-learnings.sh sync

Data stored in: .claude/learning-index.json
EOF
    ;;
esac
