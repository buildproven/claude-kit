from typing import List
from .content_parser import SlideContent


class SlideDesigner:
    BRAND_COLORS = {
        "background": "#1a1a2e",
        "text": "#ffffff",
        "accent": "#00d4aa"
    }

    DIMENSIONS = {
        "width": 1080,
        "height": 1080
    }

    TYPOGRAPHY = {
        "heading": 48,
        "body": 36,
        "slide_number": 24
    }

    def __init__(self):
        pass

    def create_slide_prompt(self, content: SlideContent) -> str:
        if content.type == "title":
            return self._create_title_prompt(content)
        elif content.type == "takeaway":
            return self._create_takeaway_prompt(content)
        elif content.type == "insight":
            return self._create_insight_prompt(content)
        elif content.type == "cta":
            return self._create_cta_prompt(content)
        else:
            return self._create_default_prompt(content)

    def _create_title_prompt(self, content: SlideContent) -> str:
        return f"""Create a professional LinkedIn carousel title slide (1080x1080px):

BACKGROUND: Solid dark blue ({self.BRAND_COLORS['background']})

TOP SECTION:
- Text: "{content.heading}"
- Font: Bold, {self.TYPOGRAPHY['heading']}px
- Color: White ({self.BRAND_COLORS['text']})
- Alignment: Centered
- Position: Upper third of image

CENTER SECTION:
- Text: "{content.body}"
- Font: Regular, {self.TYPOGRAPHY['body']}px
- Color: White ({self.BRAND_COLORS['text']})
- Alignment: Centered
- Line height: 1.5

BOTTOM:
- Teal accent bar ({self.BRAND_COLORS['accent']}, 8px height, full width)
- Slide number "1/7" in bottom-right corner (24px, white)

CRITICAL REQUIREMENTS:
- All text must be crystal clear and highly legible
- High contrast between text and background
- Professional, minimal, modern tech presentation style
- No decorative elements, focus on readability
- Ensure text fits comfortably with adequate spacing"""

    def _create_takeaway_prompt(self, content: SlideContent) -> str:
        return f"""Create a professional LinkedIn carousel takeaway slide (1080x1080px):

BACKGROUND: Solid dark blue ({self.BRAND_COLORS['background']})

TOP SECTION:
- Text: "{content.heading}"
- Font: Bold, {self.TYPOGRAPHY['heading']}px
- Color: White ({self.BRAND_COLORS['text']})
- Alignment: Left (with 60px margin)
- Position: Top 20% of image

CENTER SECTION:
- Text: "{content.body}"
- Font: Regular, {self.TYPOGRAPHY['body']}px
- Color: White ({self.BRAND_COLORS['text']})
- Alignment: Centered
- Line height: 1.6
- Max width: 80% of image width

BOTTOM:
- Teal accent bar ({self.BRAND_COLORS['accent']}, 8px height, full width)
- Slide number "{content.slide_num}/7" in bottom-right corner (24px, white, 40px margin)

CRITICAL REQUIREMENTS:
- All text must be crystal clear and highly legible
- High contrast
- Professional, minimal design
- Adequate spacing around all text
- No decorative elements"""

    def _create_insight_prompt(self, content: SlideContent) -> str:
        return f"""Create a professional LinkedIn carousel insight slide (1080x1080px):

BACKGROUND: Solid dark blue ({self.BRAND_COLORS['background']})

TOP SECTION:
- Text: "{content.heading}"
- Font: Bold, {self.TYPOGRAPHY['heading']}px
- Color: Teal ({self.BRAND_COLORS['accent']})
- Alignment: Left (with 60px margin)
- Position: Top 15% of image

CENTER SECTION:
- Text: "{content.body}"
- Font: Regular, {self.TYPOGRAPHY['body']}px
- Color: White ({self.BRAND_COLORS['text']})
- Alignment: Left-aligned with good margins (60px)
- Line height: 1.7
- Max width: 85% of image width

BOTTOM:
- Teal accent bar ({self.BRAND_COLORS['accent']}, 8px height, full width)
- Slide number "{content.slide_num}/7" in bottom-right corner (24px, white, 40px margin)

CRITICAL REQUIREMENTS:
- All text must be crystal clear and highly legible
- High contrast
- Professional, minimal design
- Ensure longer text is readable (may need slightly smaller font if needed)
- Adequate line spacing for readability"""

    def _create_cta_prompt(self, content: SlideContent) -> str:
        return f"""Create a professional LinkedIn carousel call-to-action slide (1080x1080px):

BACKGROUND: Solid dark blue ({self.BRAND_COLORS['background']})

TOP SECTION:
- Text: "{content.heading}"
- Font: Bold, 56px
- Color: Teal ({self.BRAND_COLORS['accent']})
- Alignment: Centered
- Position: Upper third

CENTER SECTION:
- Text: "{content.body}"
- Font: Regular, 40px
- Color: White ({self.BRAND_COLORS['text']})
- Alignment: Centered
- Line height: 1.8

BOTTOM:
- Teal accent bar ({self.BRAND_COLORS['accent']}, 12px height, full width)
- Slide number "7/7" in bottom-right corner (24px, white, 40px margin)

CRITICAL REQUIREMENTS:
- All text must be crystal clear and highly legible
- High contrast
- Welcoming, inviting design
- Professional presentation
- Strong visual hierarchy (heading stands out)"""

    def _create_default_prompt(self, content: SlideContent) -> str:
        return f"""Create a professional LinkedIn carousel slide (1080x1080px):

BACKGROUND: Solid dark blue ({self.BRAND_COLORS['background']})

TOP: "{content.heading}" (Bold, 48px, white, centered)
CENTER: "{content.body}" (Regular, 36px, white, centered)
BOTTOM: Teal bar ({self.BRAND_COLORS['accent']}, 8px) + "{content.slide_num}/7" (24px, white, right)

CRITICAL: All text must be crystal clear and legible. High contrast.
Style: Professional, minimal, modern tech presentation."""

    def create_all_prompts(self, slides: List[SlideContent]) -> List[str]:
        return [self.create_slide_prompt(slide) for slide in slides]

    def validate_text_length(self, content: SlideContent) -> bool:
        if len(content.body) > content.max_chars:
            print(f"⚠ Slide {content.slide_num} body exceeds {content.max_chars} chars: {len(content.body)}")
            return False
        if len(content.heading) > 100:
            print(f"⚠ Slide {content.slide_num} heading too long: {len(content.heading)}")
            return False
        return True
