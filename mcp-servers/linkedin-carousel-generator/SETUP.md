# LinkedIn Carousel Generator - Setup Guide

## Current Status

✅ **Code:** Fully implemented
✅ **Skill:** Available as `linkedin-carousel`
✅ **CLI:** Works (but you don't need to use it)
⏳ **API Keys:** Need to be added to `.env`

## Quick Start

### 1. Add API Keys to Central .env

Edit `/Users/youruser/Projects/claude-setup/.env` (same file used by all MCP servers) and add your keys:

```bash
# Get from: https://ai.google.dev/gemini-api/docs
GOOGLE_GENAI_API_KEY=your_actual_google_key

# Get from: https://platform.openai.com/api-keys
OPENAI_API_KEY=your_actual_openai_key
```

**You only need ONE of these keys** (but having both enables fallback).

**Recommended:** Start with Google Gemini (cheaper at $0.35/carousel vs $0.93)

### 2. Test It

Just say in Claude Code:

```
"Generate a LinkedIn carousel from test-newsletter.md"
```

Or use the beehiiv skill:

```
"Create a newsletter and then make a carousel"
```

## How to Get API Keys

### Google Gemini API (Recommended - Cheaper)

1. Go to https://ai.google.dev/gemini-api/docs
2. Click "Get API key"
3. Sign in with Google account
4. Create new project (or use existing)
5. Click "Get API Key" → Copy
6. Paste into `.env` as `GOOGLE_GENAI_API_KEY`

**Cost:** $0.05/image = $0.35 per 7-slide carousel

### OpenAI API (Fallback)

1. Go to https://platform.openai.com/api-keys
2. Sign in with OpenAI account
3. Click "+ Create new secret key"
4. Name it "LinkedIn Carousel Generator"
5. Copy key immediately (only shown once!)
6. Paste into `.env` as `OPENAI_API_KEY`

**Cost:** $0.133/image = $0.93 per 7-slide carousel

## Testing

### Preview Mode (Free - No API calls)

```
"Preview carousel slides from my newsletter"
```

This shows what slides will be generated WITHOUT making API calls.

### Generate First Carousel

```
"Generate a carousel from test-newsletter.md"
```

Expected output:

- 7 slide images (1080x1080px)
- PDF file (~2-5MB)
- Location: `/Users/youruser/Projects/yourbrand/output/carousels/`
- Cost: $0.35-$0.93

## Troubleshooting

**Error: "At least one API key must be configured"**
→ Add API key to `.env` file

**Error: "ModuleNotFoundError: No module named 'google.generativeai'"**
→ Run: `pip3 install google-genai openai img2pdf Pillow`

**Slide text not legible**
→ Let me know and I'll tune the AI prompts

**PDF too large (>10MB)**
→ Shouldn't happen with 7 slides, but let me know if it does

## Ready to Use

Once you add ONE API key to `.env`, just say:

- "Generate a carousel"
- "Make LinkedIn slides from this newsletter"
- "Create a carousel for my latest post"

The skill handles everything automatically!
