import img2pdf
from pathlib import Path
from typing import List, Optional, Dict
from datetime import datetime


class CarouselPDFAssembler:
    LINKEDIN_MAX_SIZE_MB = 10

    def __init__(self):
        pass

    def create_carousel_pdf(
        self,
        slide_images: List[Path],
        output_path: Path,
        metadata: Optional[Dict[str, str]] = None
    ) -> bool:
        try:
            if not slide_images:
                print("⚠ No slide images provided")
                return False

            missing_slides = [img for img in slide_images if not img.exists()]
            if missing_slides:
                print(f"⚠ Missing slide images: {missing_slides}")
                return False

            output_path.parent.mkdir(parents=True, exist_ok=True)

            pdf_metadata = {
                "producer": "LinkedIn Carousel Generator",
                "creationdate": datetime.now(),
            }

            if metadata:
                if "title" in metadata:
                    pdf_metadata["title"] = metadata["title"]
                if "author" in metadata:
                    pdf_metadata["author"] = metadata["author"]
                if "keywords" in metadata:
                    pdf_metadata["keywords"] = metadata["keywords"]

            with open(output_path, "wb") as f:
                f.write(img2pdf.convert(
                    [str(img) for img in slide_images],
                    **pdf_metadata
                ))

            file_size_mb = output_path.stat().st_size / (1024 * 1024)

            if file_size_mb > self.LINKEDIN_MAX_SIZE_MB:
                print(f"⚠ PDF size ({file_size_mb:.2f}MB) exceeds LinkedIn limit ({self.LINKEDIN_MAX_SIZE_MB}MB)")
                return False

            print(f"✓ PDF created: {output_path} ({file_size_mb:.2f}MB)")
            return True

        except Exception as e:
            print(f"Error creating PDF: {e}")
            return False

    def verify_slide_count(self, slide_images: List[Path], expected: int = 7) -> bool:
        if len(slide_images) != expected:
            print(f"⚠ Expected {expected} slides, got {len(slide_images)}")
            return False
        return True
