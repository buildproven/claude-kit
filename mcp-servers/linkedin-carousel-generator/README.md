# LinkedIn Carousel Generator

Automated LinkedIn carousel generator that creates professional 7-slide PDF carousels from newsletter markdown files using dual AI image generation models.

## Features

- **Dual AI Models**: Google Gemini (primary) with GPT Image 1.5 (OpenAI) fallback
- **Smart Parsing**: Extracts key points from newsletter markdown automatically
- **Brand-Consistent**: Professional dark blue (#1a1a2e) theme with teal accents
- **LinkedIn-Optimized**: 1080x1080px slides, <10MB PDFs
- **Cost-Efficient**: $0.35-$0.93 per carousel (~$16-45/year for weekly newsletters)

## Installation

```bash
cd mcp-servers/linkedin-carousel-generator
pip install -e .
```

## Configuration

Create `.env` file:

```bash
# AI Image Generation APIs
GOOGLE_GENAI_API_KEY=your_google_api_key
OPENAI_API_KEY=your_openai_api_key

# Carousel Settings
CAROUSEL_DEFAULT_MODEL=gemini
CAROUSEL_OUTPUT_DIR=~/output/carousels
CAROUSEL_ENABLE_FALLBACK=true
```

## Usage

### CLI Interface

```bash
# Generate single carousel
python scripts/generate-carousel.py newsletter.md

# Preview without API calls (free)
python scripts/generate-carousel.py --preview newsletter.md

# Batch processing
python scripts/generate-carousel.py --batch /path/to/newsletters/

# Force specific model
python scripts/generate-carousel.py --model gpt-image-1.5 newsletter.md

# Custom output directory
python scripts/generate-carousel.py --output ./custom-dir newsletter.md
```

### Python API

```python
from linkedin_carousel import CarouselGenerator
from pathlib import Path

generator = CarouselGenerator()

# Generate carousel
pdf_path = generator.generate_carousel(Path("newsletter.md"))
if pdf_path:
    print(f"Success: {pdf_path}")

# Preview slides (no API calls)
slides = generator.preview_slides(Path("newsletter.md"))
for slide in slides:
    print(f"Slide {slide.slide_num}: {slide.heading}")

# Batch process
results = generator.generate_batch(Path("./newsletters/"))
```

## Newsletter Format

Newsletters should be markdown files with YAML frontmatter:

```markdown
---
title: 'Your Newsletter Title'
description: 'Hook or summary'
slug: 'newsletter-slug'
---

## Section 1

Content with key takeaways...

- Bullet point 1
- Bullet point 2

## Section 2

More insights...
```

## Slide Structure

1. **Slide 1**: Title + Hook
2. **Slides 2-4**: Key Takeaways (3 bullets)
3. **Slides 5-6**: Top 2 insights from content
4. **Slide 7**: CTA + subscription link

## Brand Specifications

- **Background**: Dark blue (#1a1a2e)
- **Text**: White (#ffffff)
- **Accent**: Teal (#00d4aa)
- **Typography**: Bold headings (48px), regular body (36px)
- **Dimensions**: 1080x1080px (LinkedIn standard)

## Error Handling

- **Primary API failure**: Automatically falls back to secondary model
- **Partial generation**: Continues with available slides (minimum 5 of 7)
- **Rate limiting**: 1-second delays between API calls
- **Exponential backoff**: On 429 errors (2s, 4s, 8s)

## Cost Breakdown

### Per Carousel

- **Google Gemini** (default): $0.05/slide × 7 = **$0.35**
- **GPT Image 1.5** (fallback): $0.133/slide × 7 = **$0.93**

### Annual Costs

- **Weekly newsletters** (52/year): $18.20 - $48.36
- **Bi-weekly** (26/year): $9.10 - $24.18
- **Monthly** (12/year): $4.20 - $11.16

## Integration

### Beehiiv Skill Integration

The carousel generator integrates with the beehiiv skill at Step 6:

```python
from linkedin_carousel.generator import CarouselGenerator

carousel_gen = CarouselGenerator()
pdf_path = carousel_gen.generate_carousel(newsletter_path)

if pdf_path:
    # Save to database
    cursor.execute("""
        INSERT OR REPLACE INTO posted_content
        (source_type, source_id, platform, carousel_url, content_preview, tags)
        VALUES (?, ?, ?, ?, ?, ?)
    """, ("newsletter", slug, "linkedin-carousel", str(pdf_path),
          f"Carousel: {title[:100]}", "carousel,auto-generated"))
```

## Troubleshooting

### Missing Dependencies

```bash
pip install google-genai openai img2pdf Pillow PyYAML markdown python-dotenv requests
```

### API Key Issues

```bash
# Verify keys are set
python -c "from dotenv import load_dotenv; import os; load_dotenv(); print('Google:', bool(os.getenv('GOOGLE_GENAI_API_KEY'))); print('OpenAI:', bool(os.getenv('OPENAI_API_KEY')))"
```

### PDF Size Exceeded

LinkedIn's limit is 10MB. If exceeded:

- Check image compression settings
- Verify slide count (should be 7)
- Contact support if issue persists

## Development

### Run Tests

```bash
# Preview mode (no API calls, free)
python scripts/generate-carousel.py --preview test-newsletter.md

# Single test
python scripts/generate-carousel.py test-newsletter.md

# Verify output
open output/carousels/test-newsletter.pdf
```

### Project Structure

```
linkedin-carousel-generator/
├── src/
│   └── linkedin_carousel/
│       ├── __init__.py
│       ├── generator.py          # Main orchestrator
│       ├── content_parser.py     # Newsletter parsing
│       ├── slide_designer.py     # AI prompt generation
│       ├── image_client.py       # Dual API client
│       └── pdf_assembler.py      # PDF creation
├── pyproject.toml
├── .env.template
└── README.md
```

## License

MIT - See [LICENSE](../../LICENSE) for details.

## Support

For issues or questions, open a GitHub issue in the claude-power-kit repository.
