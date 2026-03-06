---
name: seo
description: SEO keyword research, SERP analysis, backlink checks, and competitor intelligence using DataForSEO API.
---

# SEO & Keyword Research

Use the DataForSEO API for keyword research, SERP analysis, backlinks, and competitor intelligence.

## Credentials

Located in the project `.env` file:

```
DATAFORSEO_LOGIN=<email>
DATAFORSEO_PASSWORD=<password>
```

## API Access

### Direct API (preferred for simple queries)

DataForSEO uses HTTP Basic Auth. Base URL: `https://api.dataforseo.com/v3`

```bash
# Keyword search volume
curl -X POST "https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live" \
  -H "Content-Type: application/json" \
  -u "$DATAFORSEO_LOGIN:$DATAFORSEO_PASSWORD" \
  -d '[{"keywords": ["vibe coding", "ai product builder"], "location_code": 2840, "language_code": "en"}]'

# SERP results
curl -X POST "https://api.dataforseo.com/v3/serp/google/organic/live/regular" \
  -H "Content-Type: application/json" \
  -u "$DATAFORSEO_LOGIN:$DATAFORSEO_PASSWORD" \
  -d '[{"keyword": "ai product builder for non developers", "location_code": 2840, "language_code": "en"}]'

# Keyword suggestions
curl -X POST "https://api.dataforseo.com/v3/keywords_data/google_ads/keywords_for_keywords/live" \
  -H "Content-Type: application/json" \
  -u "$DATAFORSEO_LOGIN:$DATAFORSEO_PASSWORD" \
  -d '[{"keywords": ["vibe coding"], "location_code": 2840, "language_code": "en"}]'

# Competitor domain analysis
curl -X POST "https://api.dataforseo.com/v3/dataforseo_labs/google/competitors_domain/live" \
  -H "Content-Type: application/json" \
  -u "$DATAFORSEO_LOGIN:$DATAFORSEO_PASSWORD" \
  -d '[{"target": "yoursite.com", "location_code": 2840, "language_code": "en"}]'
```

### MCP Server (for complex multi-step analysis)

Full MCP server at: `mcp-servers/dataforseo-mcp-server/`

```bash
# Run via node
cd mcp-servers/dataforseo-mcp-server
DATAFORSEO_LOGIN=<login> DATAFORSEO_PASSWORD=<pass> node dist/index.js
```

## Common Tasks

### Keyword Research for YourBrand

- Target keywords around: "vibe coding", "ai product builder", "non-developer ai tools", "domain expertise ai"
- Location code 2840 = United States
- Check search volume, competition, CPC

### Competitor Analysis

- Check what keywords competitors rank for
- Find content gaps
- Monitor SERP positions for target keywords

### Content SEO

- Before writing articles: check keyword volume and competition
- After publishing: monitor ranking position
- Find related keywords for internal linking

## Cost Notes

- DataForSEO charges per API call (varies by endpoint)
- Keyword search volume: ~$0.05 per task
- SERP results: ~$0.05-0.10 per task
- Be mindful of costs when running bulk queries
