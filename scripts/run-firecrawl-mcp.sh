#!/bin/bash
# Wrapper script to run Firecrawl MCP server with env from central .env file

# Load environment variables from central .env
ENV_FILE="$HOME/Projects/claude-setup/.env"

if [ -f "$ENV_FILE" ]; then
  # Export the Firecrawl API key
  export FIRECRAWL_API_KEY="$(grep '^FIRECRAWL_API_KEY=' "$ENV_FILE" | cut -d'=' -f2-)"
fi

# Run the MCP server
exec npx -y firecrawl-mcp
