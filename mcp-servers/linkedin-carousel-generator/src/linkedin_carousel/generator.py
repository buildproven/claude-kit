import os
from pathlib import Path
from typing import Optional, List, Dict
from dotenv import load_dotenv

from .content_parser import NewsletterParser, SlideContent
from .slide_designer import SlideDesigner
from .image_client import CarouselImageClient
from .pdf_assembler import CarouselPDFAssembler

# Load .env from central claude-setup directory
_env_path = Path(__file__).parent.parent.parent.parent.parent / ".env"
load_dotenv(_env_path)


class CarouselGenerator:
    def __init__(self, output_dir: Optional[Path] = None):
        self.parser = NewsletterParser()
        self.designer = SlideDesigner()
        self._image_client = None
        self._pdf_assembler = None

        self.output_dir = output_dir or Path(
            os.getenv("CAROUSEL_OUTPUT_DIR", "./output/carousels")
        )
        self.output_dir.mkdir(parents=True, exist_ok=True)

    @property
    def image_client(self):
        if self._image_client is None:
            self._image_client = CarouselImageClient()
        return self._image_client

    @property
    def pdf_assembler(self):
        if self._pdf_assembler is None:
            self._pdf_assembler = CarouselPDFAssembler()
        return self._pdf_assembler

    def generate_carousel(
        self,
        newsletter_file: Path,
        force_model: Optional[str] = None
    ) -> Optional[Path]:
        try:
            print(f"\n{'='*60}")
            print(f"Generating carousel for: {newsletter_file.name}")
            print(f"{'='*60}\n")

            newsletter_data = self.parser.parse_newsletter(newsletter_file)
            if not newsletter_data:
                print("✗ Failed to parse newsletter")
                return None

            print(f"✓ Parsed newsletter: {newsletter_data.title}")

            slides = self.parser.extract_7_key_points(newsletter_data)
            print(f"✓ Extracted {len(slides)} slides")

            for slide in slides:
                if not self.designer.validate_text_length(slide):
                    print(f"⚠ Slide {slide.slide_num} text length warning (continuing...)")

            prompts = self.designer.create_all_prompts(slides)
            print(f"✓ Created {len(prompts)} AI prompts")

            temp_dir = self.output_dir / "temp" / newsletter_data.slug
            temp_dir.mkdir(parents=True, exist_ok=True)

            print(f"\nGenerating images with AI ({force_model or 'auto-fallback'})...")
            results = self.image_client.generate_all_slides(prompts, temp_dir, force_model)

            successful_slides = [
                (slide_num, path) for slide_num, success, path, model in results if success
            ]

            if len(successful_slides) < 5:
                print(f"\n✗ Insufficient slides generated ({len(successful_slides)}/7)")
                return None

            slide_images = [path for _, path in sorted(successful_slides)]

            pdf_output = self.output_dir / f"{newsletter_data.slug}.pdf"
            metadata = {
                "title": newsletter_data.title,
                "author": os.getenv("CAROUSEL_AUTHOR", "Author"),
                "keywords": "linkedin,carousel,newsletter"
            }

            print(f"\nAssembling PDF...")
            if self.pdf_assembler.create_carousel_pdf(slide_images, pdf_output, metadata):
                print(f"\n{'='*60}")
                print(f"✓ Carousel generated successfully!")
                print(f"  Output: {pdf_output}")
                print(f"  Slides: {len(successful_slides)}/7")
                print(f"{'='*60}\n")
                return pdf_output
            else:
                print("\n✗ Failed to create PDF")
                return None

        except Exception as e:
            print(f"\n✗ Error generating carousel: {e}")
            import traceback
            traceback.print_exc()
            return None

    def generate_batch(self, directory: Path) -> List[Dict]:
        results = []

        newsletter_files = list(directory.glob("*.md"))
        if not newsletter_files:
            print(f"No newsletter files found in {directory}")
            return results

        print(f"\nFound {len(newsletter_files)} newsletter files")

        for newsletter_file in newsletter_files:
            pdf_path = self.generate_carousel(newsletter_file)
            results.append({
                "newsletter": newsletter_file.name,
                "success": pdf_path is not None,
                "pdf_path": str(pdf_path) if pdf_path else None
            })

        successful = sum(1 for r in results if r["success"])
        print(f"\n{'='*60}")
        print(f"Batch complete: {successful}/{len(results)} carousels generated")
        print(f"{'='*60}\n")

        return results

    def preview_slides(self, newsletter_file: Path) -> Optional[List[SlideContent]]:
        try:
            newsletter_data = self.parser.parse_newsletter(newsletter_file)
            if not newsletter_data:
                return None

            slides = self.parser.extract_7_key_points(newsletter_data)

            print(f"\n{'='*60}")
            print(f"Preview: {newsletter_data.title}")
            print(f"{'='*60}\n")

            for slide in slides:
                print(f"\nSlide {slide.slide_num}/7 ({slide.type})")
                print(f"Heading: {slide.heading}")
                print(f"Body: {slide.body}")
                print(f"Chars: {len(slide.body)}/{slide.max_chars}")
                print("-" * 40)

            return slides

        except Exception as e:
            print(f"Error previewing slides: {e}")
            return None
