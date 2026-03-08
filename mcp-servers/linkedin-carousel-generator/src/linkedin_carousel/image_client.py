import os
import time
from pathlib import Path
from typing import Tuple, Optional, List
import requests
from dotenv import load_dotenv

# Load .env from central claude-setup directory
_env_path = Path(__file__).parent.parent.parent.parent.parent / ".env"
load_dotenv(_env_path)


class CarouselImageClient:
    def __init__(self):
        self.google_api_key = os.getenv("GOOGLE_GENAI_API_KEY")
        self.openai_api_key = os.getenv("OPENAI_API_KEY")
        self.default_model = os.getenv("CAROUSEL_DEFAULT_MODEL", "gemini")
        self.enable_fallback = os.getenv("CAROUSEL_ENABLE_FALLBACK", "true").lower() == "true"

        self._validate_credentials()

    def _validate_credentials(self):
        if not self.google_api_key and not self.openai_api_key:
            raise ValueError("At least one API key (Google or OpenAI) must be configured")

    def generate_slide_image(
        self,
        prompt: str,
        slide_num: int,
        output_dir: Path,
        force_model: Optional[str] = None
    ) -> Tuple[bool, Optional[Path], Optional[str]]:
        output_dir.mkdir(parents=True, exist_ok=True)

        model_order = [force_model] if force_model else [self.default_model, "gpt-image-1.5"] if self.enable_fallback else [self.default_model]

        for model in model_order:
            if model == "gemini" and self.google_api_key:
                success, path = self._generate_google(prompt, slide_num, output_dir)
                if success:
                    return True, path, "gemini"
                print(f"⚠ Gemini failed for slide {slide_num}, trying fallback...")

            elif model == "gpt-image-1.5" and self.openai_api_key:
                success, path = self._generate_openai(prompt, slide_num, output_dir)
                if success:
                    return True, path, "gpt-image-1.5"
                print(f"⚠ GPT Image 1.5 failed for slide {slide_num}")

        return False, None, None

    def _generate_google(self, prompt: str, slide_num: int, output_dir: Path) -> Tuple[bool, Optional[Path]]:
        try:
            import google.generativeai as genai

            genai.configure(api_key=self.google_api_key)
            model = genai.GenerativeModel('gemini-3-pro-image-preview')

            response = model.generate_content(
                prompt,
                generation_config=genai.types.GenerationConfig(
                    temperature=0.3,
                )
            )

            if not response.parts:
                return False, None

            image_data = response.parts[0].inline_data.data
            output_path = output_dir / f"slide_{slide_num:02d}.png"

            with open(output_path, "wb") as f:
                f.write(image_data)

            time.sleep(1)
            return True, output_path

        except Exception as e:
            print(f"Google API error: {e}")
            return False, None

    def _generate_openai(self, prompt: str, slide_num: int, output_dir: Path) -> Tuple[bool, Optional[Path]]:
        try:
            from openai import OpenAI

            client = OpenAI(api_key=self.openai_api_key)

            response = client.images.generate(
                model="gpt-image-1.5",
                prompt=prompt,
                size="1024x1024",
                quality="hd",
                n=1
            )

            if not response.data or not response.data[0].url:
                return False, None

            image_url = response.data[0].url
            image_response = requests.get(image_url, timeout=30)
            image_response.raise_for_status()

            output_path = output_dir / f"slide_{slide_num:02d}.png"
            with open(output_path, "wb") as f:
                f.write(image_response.content)

            time.sleep(1)
            return True, output_path

        except Exception as e:
            print(f"OpenAI API error: {e}")
            return False, None

    def generate_all_slides(
        self,
        prompts: List[str],
        output_dir: Path,
        force_model: Optional[str] = None
    ) -> List[Tuple[int, bool, Optional[Path], Optional[str]]]:
        results = []

        for i, prompt in enumerate(prompts, start=1):
            print(f"Generating slide {i}/7...")
            success, path, model = self.generate_slide_image(prompt, i, output_dir, force_model)
            results.append((i, success, path, model))

            if success:
                print(f"✓ Slide {i} generated with {model}")
            else:
                print(f"✗ Slide {i} failed")

        return results
