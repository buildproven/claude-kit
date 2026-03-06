---
name: bs:image
description: 'Generate images for newsletters (beehiiv, twitter, linkedin, facebook, carousel)'
argument-hint: '[file] [--preset beehiiv|carousel|twitter|facebook|linkedin] [--slides N]'
category: newsletter
model: opus
---

# /bs:image Command

**Arguments received:** $ARGUMENTS

Generate images for newsletters and social media using AI (Gemini or OpenAI).

## Paths

```
SETUP_REPO=$SETUP_REPO
```

## Parse Arguments

Extract from ARGUMENTS:

- `[file]` - Newsletter markdown file path (required)
- `--preset [type]` - Image preset (default: beehiiv)
- `--slides [N]` - Number of slides for carousel (auto-detect if not specified)
- `--preview` - Preview without generating (free, no API calls)
- `--model [gemini|openai]` - Force specific AI model
- `--output [dir]` - Custom output directory

## Available Presets

| Preset     | Size      | Format | Use For                             |
| ---------- | --------- | ------ | ----------------------------------- |
| `beehiiv`  | 1200x630  | PNG    | Newsletter featured image           |
| `twitter`  | 1200x628  | PNG    | Twitter/X card                      |
| `facebook` | 1200x630  | PNG    | Facebook post                       |
| `linkedin` | 1200x627  | PNG    | LinkedIn post                       |
| `carousel` | 1080x1080 | PDF    | LinkedIn carousel (variable slides) |
| `og`       | 1200x630  | PNG    | Open Graph generic                  |

## Execute

Run the generate-image.py script:

```bash
python3 $SETUP_REPO/scripts/generate-image.py [file] [options]
```

### Examples

**Featured image for Beehiiv (default):**

```bash
python3 $SETUP_REPO/scripts/generate-image.py \
  newsletters/2026/01/2026-01-21-my-post.md \
  --preset beehiiv
```

**LinkedIn carousel with 5 slides:**

```bash
python3 $SETUP_REPO/scripts/generate-image.py \
  newsletters/2026/01/2026-01-21-my-post.md \
  --preset carousel \
  --slides 5
```

**Preview carousel content (free):**

```bash
python3 $SETUP_REPO/scripts/generate-image.py \
  newsletters/2026/01/2026-01-21-my-post.md \
  --preset carousel \
  --preview
```

**Twitter card with custom output:**

```bash
python3 $SETUP_REPO/scripts/generate-image.py \
  newsletters/2026/01/2026-01-21-my-post.md \
  --preset twitter \
  --output output/images/
```

## Output

Images are saved to `[newsletter-dir]/images/` by default:

- Single image: `[slug]-[preset].png`
- Carousel: `[slug]-carousel.pdf`

## Cost

- **Gemini (default):** ~$0.05 per image, ~$0.35 for 7-slide carousel
- **OpenAI (fallback):** ~$0.08 per image, ~$0.56 for 7-slide carousel

## API Keys

All keys loaded from `$SETUP_REPO/.env`:

- `GOOGLE_GENAI_API_KEY` - Gemini (preferred)
- `OPENAI_API_KEY` - DALL-E fallback
