"""Platform-specific rules and validation for social media posts."""

import re
from dataclasses import dataclass
from typing import Optional
from enum import Enum


class Platform(Enum):
    TWITTER = "twitter"
    LINKEDIN = "linkedin"
    FACEBOOK = "facebook"


@dataclass
class PlatformRules:
    """Rules and limits for each platform."""
    name: str
    char_limit: int
    optimal_length: tuple[int, int]  # (min, max) for best engagement
    max_hashtags: int
    link_in_body: bool  # Whether to include links in post body
    link_counts_as: int  # How many chars a link counts as (Twitter shortens to t.co)
    emoji_friendly: bool
    tone: str
    hashtag_position: str  # "end" or "inline"


PLATFORM_RULES: dict[Platform, PlatformRules] = {
    Platform.TWITTER: PlatformRules(
        name="Twitter/X",
        char_limit=280,
        optimal_length=(71, 100),
        max_hashtags=3,
        link_in_body=True,
        link_counts_as=23,  # t.co shortening
        emoji_friendly=True,
        tone="punchy, conversational",
        hashtag_position="end",
    ),
    Platform.LINKEDIN: PlatformRules(
        name="LinkedIn",
        char_limit=3000,
        optimal_length=(150, 200),
        max_hashtags=5,
        link_in_body=False,  # Links kill reach - put in first comment
        link_counts_as=0,  # N/A since we don't put links in body
        emoji_friendly=False,  # Professional, minimal emoji
        tone="professional, insightful",
        hashtag_position="end",
    ),
    Platform.FACEBOOK: PlatformRules(
        name="Facebook",
        char_limit=63206,
        optimal_length=(40, 80),
        max_hashtags=2,
        link_in_body=True,  # Links create preview cards
        link_counts_as=0,  # Full length
        emoji_friendly=True,
        tone="friendly, conversational",
        hashtag_position="end",
    ),
}


def extract_urls(text: str) -> list[str]:
    """Extract all URLs from text."""
    url_pattern = r'https?://[^\s<>"{}|\\^`\[\]]+'
    return re.findall(url_pattern, text)


def extract_hashtags(text: str) -> list[str]:
    """Extract all hashtags from text."""
    return re.findall(r'#\w+', text)


def count_chars(text: str, platform: Platform) -> int:
    """Count characters for a platform, accounting for link shortening."""
    rules = PLATFORM_RULES[platform]

    if platform == Platform.TWITTER:
        # Twitter shortens all URLs to 23 chars
        urls = extract_urls(text)
        char_count = len(text)
        for url in urls:
            # Subtract actual URL length, add t.co length
            char_count = char_count - len(url) + rules.link_counts_as
        return char_count

    return len(text)


def validate_post(text: str, platform: Platform) -> dict:
    """Validate a post against platform rules."""
    rules = PLATFORM_RULES[platform]
    char_count = count_chars(text, platform)
    hashtags = extract_hashtags(text)
    urls = extract_urls(text)

    errors = []
    warnings = []

    # Check character limit
    if char_count > rules.char_limit:
        errors.append(f"Exceeds {rules.char_limit} char limit ({char_count} chars)")

    # Check hashtag count
    if len(hashtags) > rules.max_hashtags:
        warnings.append(f"Too many hashtags ({len(hashtags)}/{rules.max_hashtags} max)")

    # Check for links in LinkedIn posts
    if platform == Platform.LINKEDIN and urls:
        warnings.append("Links in LinkedIn posts reduce reach. Move to first comment.")

    # Check optimal length
    min_opt, max_opt = rules.optimal_length
    if char_count < min_opt:
        warnings.append(f"Below optimal length ({min_opt}-{max_opt} chars)")
    elif char_count > max_opt and char_count <= rules.char_limit:
        warnings.append(f"Above optimal length ({min_opt}-{max_opt} chars)")

    return {
        "valid": len(errors) == 0,
        "char_count": char_count,
        "char_limit": rules.char_limit,
        "hashtag_count": len(hashtags),
        "url_count": len(urls),
        "errors": errors,
        "warnings": warnings,
        "platform": platform.value,
    }


def prepare_linkedin_post(text: str) -> dict:
    """Prepare LinkedIn post by extracting URLs for comment posting."""
    urls = extract_urls(text)

    # Remove URLs from main post
    clean_text = text
    for url in urls:
        clean_text = clean_text.replace(url, "").strip()

    # Clean up double spaces
    clean_text = re.sub(r'\s+', ' ', clean_text).strip()

    return {
        "post_text": clean_text,
        "comment_urls": urls,
        "has_urls": len(urls) > 0,
    }


def generate_hashtags(topic: str, platform: Platform, existing_hashtags: list[str] = None) -> list[str]:
    """Generate platform-appropriate hashtags for a topic."""
    rules = PLATFORM_RULES[platform]
    existing = existing_hashtags or []

    # Common tech hashtags by category
    tech_tags = {
        "ai": ["#AI", "#MachineLearning", "#GenerativeAI", "#LLM"],
        "dev": ["#DevTools", "#Coding", "#WebDev", "#OpenSource"],
        "saas": ["#SaaS", "#Startup", "#TechNews", "#ProductLaunch"],
        "cloud": ["#Cloud", "#AWS", "#DevOps", "#Infrastructure"],
    }

    # Platform-specific tag styles
    if platform == Platform.TWITTER:
        # Twitter: CamelCase, tech-focused
        suggested = ["#AI", "#TechNews", "#DevTools"]
    elif platform == Platform.LINKEDIN:
        # LinkedIn: Professional, industry terms
        suggested = ["#Innovation", "#Technology", "#Leadership", "#StartupLife"]
    else:
        # Facebook: Minimal, broad
        suggested = ["#tech", "#update"]

    # Combine with existing, respecting limits
    all_tags = list(set(existing + suggested))
    return all_tags[:rules.max_hashtags]


def format_post_preview(text: str, platform: Platform) -> str:
    """Format a post for preview display."""
    validation = validate_post(text, platform)
    rules = PLATFORM_RULES[platform]

    status = "OK" if validation["valid"] else "ERROR"
    char_display = f"{validation['char_count']}/{rules.char_limit}"

    preview = f"""
{'=' * 50}
{rules.name} ({char_display}) {status}
{'=' * 50}
{text}
"""

    if validation["warnings"]:
        preview += f"\nWarnings: {', '.join(validation['warnings'])}"
    if validation["errors"]:
        preview += f"\nErrors: {', '.join(validation['errors'])}"

    return preview
