#!/bin/bash
# Wrapper script to run DataForSEO MCP server with env from central .env file

# Load environment variables from central .env
ENV_FILE="$HOME/Projects/claude-kit/.env"

if [ -f "$ENV_FILE" ]; then
  # Export only the DataForSEO variables
  export DATAFORSEO_LOGIN="$(grep '^DATAFORSEO_LOGIN=' "$ENV_FILE" | cut -d'=' -f2-)"
  export DATAFORSEO_PASSWORD="$(grep '^DATAFORSEO_PASSWORD=' "$ENV_FILE" | cut -d'=' -f2-)"
  export ENABLED_MODULES="KEYWORDS_DATA,CONTENT_ANALYSIS,LABS"
fi

# Run the MCP server
exec node "$HOME/Projects/claude-kit/mcp-servers/dataforseo-mcp-server/dist/index.js"
