#!/usr/bin/env python3
"""
Generic image generator for newsletters and social media.

Supports multiple presets:
- beehiiv: Featured image (1200x630 PNG)
- carousel: LinkedIn carousel (1080x1080 PDF, variable slides)
- twitter: Twitter card (1200x628 PNG)
- facebook: Facebook post (1200x630 PNG)
- linkedin: LinkedIn post (1200x627 PNG)

Usage:
    python3 generate-image.py newsletter.md --preset beehiiv
    python3 generate-image.py newsletter.md --preset carousel --slides 5
    python3 generate-image.py newsletter.md --size 1200x630 --format png
    python3 generate-image.py newsletter.md --preset og --logo-overlay
    python3 generate-image.py newsletter.md --preset linkedin --logo-overlay /path/to/logo.png
"""

import os
import sys
import argparse
import time
import re
import yaml
from pathlib import Path
from typing import Optional, Tuple, List, Dict
from dataclasses import dataclass

# Add carousel generator to path for reusing components
sys.path.insert(0, str(Path(__file__).parent.parent / "mcp-servers/linkedin-carousel-generator/src"))

from dotenv import load_dotenv

# Load .env from claude-setup
_env_path = Path(__file__).parent.parent / ".env"
load_dotenv(_env_path)


LOGOS_DIR = Path.home() / "Projects/buildproven/docs/logos"
DEFAULT_LOGO_PATH = LOGOS_DIR / "buildproven-dark-400w.png"

# Platform-matched logos — used when --logo-overlay is passed without an explicit path
PRESET_LOGOS: Dict[str, str] = {
    "beehiiv": "buildproven-dark-beehiiv-publogo-800x800.png",
    "twitter": "buildproven-dark-twitter-post-1200x675.png",
    "facebook": "buildproven-dark-facebook-post-1200x630.png",
    "linkedin": "buildproven-dark-linkedin-post-1200x627.png",
    "og": "buildproven-dark-og-1200x630.png",
    # carousel has no platform-specific logo — falls back to DEFAULT_LOGO_PATH
}


def apply_logo_overlay(
    image_path: Path,
    logo_path: Optional[Path] = None,
    logo_width: int = 200,
    margin: int = 40,
) -> bool:
    """Composite a logo PNG onto the bottom-right of an image."""
    from PIL import Image

    resolved_logo = logo_path or DEFAULT_LOGO_PATH
    if not resolved_logo.exists():
        print(f"  Logo overlay skipped — file not found: {resolved_logo}")
        return False

    try:
        img = Image.open(image_path).convert("RGBA")
        logo = Image.open(resolved_logo).convert("RGBA")

        aspect = logo.height / logo.width
        logo_height = int(logo_width * aspect)
        logo = logo.resize((logo_width, logo_height), Image.Resampling.LANCZOS)

        x = img.width - logo_width - margin
        y = img.height - logo_height - margin
        img.paste(logo, (x, y), logo)

        img.convert("RGB").save(image_path)
        print(f"  Logo overlaid: {resolved_logo.name}")
        return True
    except Exception as e:
        print(f"  Logo overlay error: {e}")
        return False


# Preset configurations
PRESETS = {
    "beehiiv": {
        "width": 1200,
        "height": 630,
        "format": "png",
        "description": "Beehiiv newsletter featured image"
    },
    "twitter": {
        "width": 1200,
        "height": 628,
        "format": "png",
        "description": "Twitter/X card image"
    },
    "facebook": {
        "width": 1200,
        "height": 630,
        "format": "png",
        "description": "Facebook post image"
    },
    "linkedin": {
        "width": 1200,
        "height": 627,
        "format": "png",
        "description": "LinkedIn post image"
    },
    "carousel": {
        "width": 1080,
        "height": 1080,
        "format": "pdf",
        "description": "LinkedIn carousel (variable slides)"
    },
    "og": {
        "width": 1200,
        "height": 630,
        "format": "png",
        "description": "Open Graph image (generic)"
    }
}


@dataclass
class SlideContent:
    slide_num: int
    type: str
    heading: str
    body: str


@dataclass
class NewsletterData:
    title: str
    description: str
    slug: str
    sections: List[Dict[str, str]]
    key_takeaways: List[str]


class ImageGenerator:
    def __init__(self):
        self.google_api_key = os.getenv("GOOGLE_GENAI_API_KEY")
        self.openai_api_key = os.getenv("OPENAI_API_KEY")
        self.default_model = os.getenv("IMAGE_DEFAULT_MODEL", "gemini")

        if not self.google_api_key and not self.openai_api_key:
            raise ValueError("No API keys found. Set GOOGLE_GENAI_API_KEY or OPENAI_API_KEY in .env")

    def generate_image(
        self,
        prompt: str,
        width: int,
        height: int,
        output_path: Path,
        force_model: Optional[str] = None
    ) -> Tuple[bool, Optional[Path]]:
        """Generate a single image with the given prompt and dimensions."""

        output_path.parent.mkdir(parents=True, exist_ok=True)

        models = [force_model] if force_model else ["gemini", "openai"]

        for model in models:
            if model == "gemini" and self.google_api_key:
                success, path = self._generate_gemini(prompt, width, height, output_path)
                if success:
                    return True, path
                print(f"  Gemini failed, trying fallback...")

            elif model == "openai" and self.openai_api_key:
                success, path = self._generate_openai(prompt, width, height, output_path)
                if success:
                    return True, path
                print(f"  OpenAI failed")

        return False, None

    def _generate_gemini(
        self,
        prompt: str,
        width: int,
        height: int,
        output_path: Path
    ) -> Tuple[bool, Optional[Path]]:
        """Generate image using Gemini API (google.genai SDK)."""
        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=self.google_api_key)

            enhanced_prompt = f"{prompt}. Image dimensions: {width}x{height} pixels, professional quality, clean design."

            aspect = self._get_aspect_ratio(width, height)
            response = client.models.generate_images(
                model="imagen-4.0-generate-001",
                prompt=enhanced_prompt,
                config=types.GenerateImagesConfig(
                    number_of_images=1,
                    aspect_ratio=aspect,
                    safety_filter_level="BLOCK_LOW_AND_ABOVE",
                ),
            )

            if response.generated_images:
                image = response.generated_images[0]
                with open(output_path, "wb") as f:
                    f.write(image.image.image_bytes)
                return True, output_path

            return False, None

        except Exception as e:
            print(f"  Gemini error: {e}")
            return False, None

    def _generate_openai(
        self,
        prompt: str,
        width: int,
        height: int,
        output_path: Path
    ) -> Tuple[bool, Optional[Path]]:
        """Generate image using OpenAI GPT Image API."""
        try:
            import requests
            from openai import OpenAI

            client = OpenAI(api_key=self.openai_api_key)

            # Map to nearest supported size
            size = self._get_dalle_size(width, height)

            response = client.images.generate(
                model="gpt-image-1.5",
                prompt=prompt,
                size=size,
                quality="hd",
                n=1
            )

            if response.data and response.data[0].url:
                image_url = response.data[0].url
                image_response = requests.get(image_url, timeout=30)
                image_response.raise_for_status()

                with open(output_path, "wb") as f:
                    f.write(image_response.content)

                return True, output_path

            return False, None

        except Exception as e:
            print(f"  OpenAI error: {e}")
            return False, None

    def _get_aspect_ratio(self, width: int, height: int) -> str:
        """Convert dimensions to Gemini aspect ratio string."""
        ratio = width / height
        if ratio > 1.7:
            return "16:9"
        elif ratio > 1.3:
            return "3:2"
        elif ratio > 0.9:
            return "1:1"
        elif ratio > 0.6:
            return "2:3"
        else:
            return "9:16"

    def _get_dalle_size(self, width: int, height: int) -> str:
        """Map dimensions to DALL-E supported size."""
        ratio = width / height
        if ratio > 1.3:
            return "1792x1024"
        elif ratio < 0.7:
            return "1024x1792"
        else:
            return "1024x1024"


class NewsletterParser:
    """Parse newsletter markdown files to extract content for images."""

    def parse(self, filepath: Path) -> Optional[NewsletterData]:
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()

            frontmatter, body = self._split_frontmatter(content)
            sections = self._extract_sections(body)
            takeaways = self._extract_takeaways(body)

            return NewsletterData(
                title=frontmatter.get('title', frontmatter.get('email_subject', filepath.stem)),
                description=frontmatter.get('description', frontmatter.get('email_preview', '')),
                slug=frontmatter.get('slug', filepath.stem),
                sections=sections,
                key_takeaways=takeaways
            )
        except Exception as e:
            print(f"Error parsing newsletter: {e}")
            return None

    def _split_frontmatter(self, content: str) -> Tuple[Dict, str]:
        if not content.startswith('---'):
            return {}, content

        parts = content.split('---', 2)
        if len(parts) < 3:
            return {}, content

        try:
            frontmatter = yaml.safe_load(parts[1])
            body = parts[2].strip()
            return frontmatter or {}, body
        except:
            return {}, content

    def _extract_sections(self, body: str) -> List[Dict[str, str]]:
        sections = []
        h2_pattern = r'^## (.+)$'

        lines = body.split('\n')
        current_section = None
        current_content = []

        for line in lines:
            h2_match = re.match(h2_pattern, line)
            if h2_match:
                if current_section:
                    sections.append({
                        'heading': current_section,
                        'content': '\n'.join(current_content).strip()
                    })
                current_section = h2_match.group(1)
                current_content = []
            elif current_section:
                current_content.append(line)

        if current_section:
            sections.append({
                'heading': current_section,
                'content': '\n'.join(current_content).strip()
            })

        return sections

    def _extract_takeaways(self, body: str) -> List[str]:
        takeaways = []
        bullet_pattern = r'^\s*[-*]\s+(.+)$'

        for line in body.split('\n'):
            match = re.match(bullet_pattern, line)
            if match:
                text = match.group(1).strip()
                if 20 < len(text) < 300:
                    takeaways.append(text)

        return takeaways[:10]

    def extract_slides(self, data: NewsletterData, num_slides: Optional[int] = None) -> List[SlideContent]:
        """Extract slide content - auto-detect count or use specified."""
        slides = []

        # Slide 1: Title
        slides.append(SlideContent(
            slide_num=1,
            type="title",
            heading=data.title,
            body=data.description[:200] if data.description else ""
        ))

        # Takeaway slides
        takeaways = data.key_takeaways[:4]
        for i, takeaway in enumerate(takeaways, start=2):
            slides.append(SlideContent(
                slide_num=i,
                type="takeaway",
                heading=f"Key Takeaway #{i-1}",
                body=takeaway[:250]
            ))

        # Section/insight slides
        for i, section in enumerate(data.sections[:3], start=len(slides)+1):
            slides.append(SlideContent(
                slide_num=i,
                type="insight",
                heading=section['heading'],
                body=section['content'][:400]
            ))

        # CTA slide
        slides.append(SlideContent(
            slide_num=len(slides)+1,
            type="cta",
            heading="Subscribe",
            body=f"Get more insights like this. Subscribe to the newsletter."
        ))

        # Limit to requested slides if specified
        if num_slides:
            slides = slides[:num_slides]
            # Ensure CTA is last
            if slides[-1].type != "cta":
                slides[-1] = SlideContent(
                    slide_num=num_slides,
                    type="cta",
                    heading="Subscribe",
                    body="Get more insights like this. Subscribe to the newsletter."
                )

        return slides


class CarouselAssembler:
    """Assemble carousel images into PDF."""

    def create_pdf(self, image_paths: List[Path], output_path: Path, title: str) -> bool:
        try:
            from PIL import Image
            from reportlab.lib.pagesizes import letter
            from reportlab.pdfgen import canvas
            from reportlab.lib.utils import ImageReader

            # Create PDF with 1080x1080 pages
            c = canvas.Canvas(str(output_path), pagesize=(1080, 1080))

            for img_path in image_paths:
                if img_path.exists():
                    img = Image.open(img_path)
                    c.drawImage(ImageReader(img), 0, 0, width=1080, height=1080)
                    c.showPage()

            c.save()
            return True

        except ImportError:
            print("  Error: reportlab or PIL not installed. Run: pip install reportlab pillow")
            return False
        except Exception as e:
            print(f"  PDF assembly error: {e}")
            return False


def create_image_prompt(newsletter_data: NewsletterData, preset: str) -> str:
    """Create an AI prompt for image generation based on newsletter content."""

    title = newsletter_data.title
    description = newsletter_data.description or ""

    if preset == "carousel":
        return f"Professional minimalist slide design for '{title}'. Clean typography, modern gradient background, subtle tech elements. No text overlay needed - image only."
    else:
        return f"Professional blog header image for article titled '{title}'. {description[:100]}. Modern, clean design with subtle abstract elements representing the topic. Professional quality, suitable for social media sharing."


def create_slide_prompt(slide: SlideContent, slide_total: int) -> str:
    """Create AI prompt for a carousel slide."""

    if slide.type == "title":
        return f"Professional carousel title slide. Modern gradient background, clean and minimal. Text to display: '{slide.heading}'. Subtitle: '{slide.body[:100]}'. LinkedIn carousel style, 1080x1080."

    elif slide.type == "takeaway":
        return f"Professional carousel slide for key insight. Clean design with accent color. Heading: '{slide.heading}'. Main text: '{slide.body[:150]}'. Slide {slide.slide_num} of {slide_total}. LinkedIn carousel style."

    elif slide.type == "insight":
        return f"Professional carousel content slide. Modern design. Section title: '{slide.heading}'. Content hint: '{slide.body[:100]}'. LinkedIn carousel style, readable typography."

    elif slide.type == "cta":
        return f"Professional carousel CTA slide. Call to action design with engaging colors. Text: 'Subscribe for more insights'. Clean, professional, inviting design."

    return f"Professional slide design for '{slide.heading}'. Clean, modern, LinkedIn carousel style."


def main():
    parser = argparse.ArgumentParser(
        description="Generate images for newsletters and social media",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Presets:
  beehiiv    Featured image (1200x630 PNG)
  carousel   LinkedIn carousel (1080x1080 PDF, variable slides)
  twitter    Twitter/X card (1200x628 PNG)
  facebook   Facebook post (1200x630 PNG)
  linkedin   LinkedIn post (1200x627 PNG)
  og         Open Graph generic (1200x630 PNG)

Examples:
  python3 generate-image.py newsletter.md --preset beehiiv
  python3 generate-image.py newsletter.md --preset carousel --slides 5
  python3 generate-image.py newsletter.md --size 1200x630 --format png
  python3 generate-image.py newsletter.md --preset carousel --preview
        """
    )

    parser.add_argument("input", type=Path, help="Newsletter markdown file")
    parser.add_argument("--preset", choices=list(PRESETS.keys()), default="beehiiv",
                        help="Image preset (default: beehiiv)")
    parser.add_argument("--size", help="Custom size WIDTHxHEIGHT (e.g., 1200x630)")
    parser.add_argument("--format", choices=["png", "jpg", "pdf"], help="Output format")
    parser.add_argument("--slides", type=int, help="Number of carousel slides (carousel preset only)")
    parser.add_argument("--output", type=Path, help="Output directory")
    parser.add_argument("--preview", action="store_true", help="Preview content without generating (free)")
    parser.add_argument("--model", choices=["gemini", "openai"], help="Force specific AI model")
    parser.add_argument("--prompt", help="Custom prompt (overrides auto-generated)")
    parser.add_argument(
        "--logo-overlay",
        nargs="?",
        const="default",
        metavar="PATH",
        help="Composite BuildProven logo bottom-right after generation. "
             "Omit PATH to use default (buildproven-dark-400w.png).",
    )

    args = parser.parse_args()

    if not args.input.exists():
        print(f"Error: {args.input} does not exist")
        sys.exit(1)

    # Parse newsletter
    parser_obj = NewsletterParser()
    newsletter_data = parser_obj.parse(args.input)

    if not newsletter_data:
        print("Error: Could not parse newsletter file")
        sys.exit(1)

    print(f"\n{'='*60}")
    print(f"Newsletter: {newsletter_data.title}")
    print(f"Preset: {args.preset}")
    print(f"{'='*60}\n")

    # Get preset config
    preset_config = PRESETS[args.preset]

    # Override with custom size if provided
    if args.size:
        try:
            width, height = map(int, args.size.split('x'))
            preset_config = {**preset_config, "width": width, "height": height}
        except:
            print(f"Error: Invalid size format '{args.size}'. Use WIDTHxHEIGHT")
            sys.exit(1)

    if args.format:
        preset_config = {**preset_config, "format": args.format}

    # Set output directory
    output_dir = args.output or args.input.parent / "images"
    output_dir.mkdir(parents=True, exist_ok=True)

    # Handle carousel preset
    if args.preset == "carousel":
        slides = parser_obj.extract_slides(newsletter_data, args.slides)

        print(f"Slides to generate: {len(slides)}")
        for slide in slides:
            print(f"  {slide.slide_num}. [{slide.type}] {slide.heading[:40]}...")

        if args.preview:
            print(f"\n{'='*60}")
            print("Preview complete (no images generated)")
            print(f"{'='*60}\n")
            sys.exit(0)

        # Generate carousel images
        generator = ImageGenerator()
        temp_dir = output_dir / "temp" / newsletter_data.slug
        temp_dir.mkdir(parents=True, exist_ok=True)

        image_paths = []
        for slide in slides:
            print(f"\nGenerating slide {slide.slide_num}/{len(slides)}...")
            prompt = args.prompt or create_slide_prompt(slide, len(slides))
            output_path = temp_dir / f"slide_{slide.slide_num:02d}.png"

            success, path = generator.generate_image(
                prompt,
                preset_config["width"],
                preset_config["height"],
                output_path,
                args.model
            )

            if success:
                print(f"  Slide {slide.slide_num} generated")
                image_paths.append(path)
            else:
                print(f"  Slide {slide.slide_num} failed")

            time.sleep(1)  # Rate limiting

        if len(image_paths) < len(slides) * 0.7:
            print(f"\nError: Too many slides failed ({len(image_paths)}/{len(slides)})")
            sys.exit(1)

        # Assemble PDF
        pdf_output = output_dir / f"{newsletter_data.slug}-carousel.pdf"
        assembler = CarouselAssembler()

        print(f"\nAssembling PDF...")
        if assembler.create_pdf(image_paths, pdf_output, newsletter_data.title):
            print(f"\n{'='*60}")
            print(f"Carousel generated successfully!")
            print(f"  Output: {pdf_output}")
            print(f"  Slides: {len(image_paths)}")
            print(f"{'='*60}\n")
        else:
            print("\nError: Failed to create PDF")
            sys.exit(1)

    else:
        # Single image generation
        if args.preview:
            prompt = args.prompt or create_image_prompt(newsletter_data, args.preset)
            print(f"Prompt: {prompt[:200]}...")
            print(f"Size: {preset_config['width']}x{preset_config['height']}")
            print(f"Format: {preset_config['format']}")
            print(f"\n{'='*60}")
            print("Preview complete (no image generated)")
            print(f"{'='*60}\n")
            sys.exit(0)

        generator = ImageGenerator()

        ext = preset_config["format"]
        output_path = output_dir / f"{newsletter_data.slug}-{args.preset}.{ext}"

        prompt = args.prompt or create_image_prompt(newsletter_data, args.preset)

        print(f"Generating {args.preset} image...")
        print(f"  Size: {preset_config['width']}x{preset_config['height']}")
        print(f"  Format: {preset_config['format']}")

        success, path = generator.generate_image(
            prompt,
            preset_config["width"],
            preset_config["height"],
            output_path,
            args.model
        )

        if success and path is not None:
            if args.logo_overlay:
                if args.logo_overlay != "default":
                    logo_path: Optional[Path] = Path(args.logo_overlay)
                else:
                    preset_logo_name = PRESET_LOGOS.get(args.preset)
                    logo_path = (
                        LOGOS_DIR / preset_logo_name
                        if preset_logo_name
                        else DEFAULT_LOGO_PATH
                    )
                apply_logo_overlay(path, logo_path)

            print(f"\n{'='*60}")
            print(f"Image generated successfully!")
            print(f"  Output: {path}")
            print(f"{'='*60}\n")
        else:
            print("\nError: Failed to generate image")
            sys.exit(1)


if __name__ == "__main__":
    main()
