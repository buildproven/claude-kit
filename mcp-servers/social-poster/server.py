"""
Social Poster MCP Server

A unified social media posting server that enforces platform best practices,
handles Twitter threads, LinkedIn link extraction, and maintains post history.
"""

from mcp.server.fastmcp import FastMCP
from typing import Any, Optional
import json
import httpx
import os
import re
from datetime import datetime

from platforms import (
    Platform,
    PLATFORM_RULES,
    validate_post,
    prepare_linkedin_post,
    count_chars,
    extract_urls,
    extract_hashtags,
    format_post_preview,
)
from threads import split_into_thread, needs_thread, format_thread_preview
from history import post_history


mcp = FastMCP("SocialPoster")


# ============================================================================
# VALIDATION TOOLS
# ============================================================================

@mcp.tool()
def validate_content(content: str, platform: str) -> dict[str, Any]:
    """
    Validate content against platform rules.

    Args:
        content: The post content to validate
        platform: One of 'twitter', 'linkedin', 'facebook'

    Returns:
        Validation result with char count, errors, and warnings
    """
    try:
        plat = Platform(platform.lower())
    except ValueError:
        return {"error": f"Unknown platform: {platform}. Use twitter, linkedin, or facebook."}

    return validate_post(content, plat)


@mcp.tool()
def get_platform_rules(platform: str) -> dict[str, Any]:
    """
    Get the rules and best practices for a platform.

    Args:
        platform: One of 'twitter', 'linkedin', 'facebook'

    Returns:
        Platform rules including char limits, hashtag limits, link handling
    """
    try:
        plat = Platform(platform.lower())
    except ValueError:
        return {"error": f"Unknown platform: {platform}. Use twitter, linkedin, or facebook."}

    rules = PLATFORM_RULES[plat]
    return {
        "platform": platform,
        "name": rules.name,
        "char_limit": rules.char_limit,
        "optimal_length": f"{rules.optimal_length[0]}-{rules.optimal_length[1]} chars",
        "max_hashtags": rules.max_hashtags,
        "link_in_body": rules.link_in_body,
        "link_note": "Links reduce LinkedIn reach - put in first comment" if not rules.link_in_body else "Links OK in body",
        "emoji_friendly": rules.emoji_friendly,
        "tone": rules.tone,
        "hashtag_position": rules.hashtag_position,
    }


# ============================================================================
# CONTENT PREPARATION TOOLS
# ============================================================================

@mcp.tool()
def prepare_posts(
    content: str,
    platforms: list[str],
    auto_thread: bool = True,
    extract_linkedin_urls: bool = True,
) -> dict[str, Any]:
    """
    Prepare content for multiple platforms with best practices applied.

    Args:
        content: The base content to post
        platforms: List of platforms ('twitter', 'linkedin', 'facebook')
        auto_thread: Automatically split Twitter content into threads if needed
        extract_linkedin_urls: Extract URLs from LinkedIn posts for comment

    Returns:
        Prepared content for each platform with validation
    """
    result = {
        "original_content": content,
        "platforms": {},
        "all_valid": True,
    }

    for platform_str in platforms:
        try:
            platform = Platform(platform_str.lower())
        except ValueError:
            result["platforms"][platform_str] = {"error": f"Unknown platform: {platform_str}"}
            result["all_valid"] = False
            continue

        rules = PLATFORM_RULES[platform]
        prepared = {"content": content, "platform": platform_str}

        # Handle LinkedIn URL extraction
        if platform == Platform.LINKEDIN and extract_linkedin_urls:
            linkedin_prep = prepare_linkedin_post(content)
            prepared["content"] = linkedin_prep["post_text"]
            prepared["comment_urls"] = linkedin_prep["comment_urls"]
            prepared["url_note"] = "Post these URLs as first comment for better reach" if linkedin_prep["has_urls"] else None

        # Handle Twitter threading
        if platform == Platform.TWITTER:
            if auto_thread and needs_thread(prepared["content"]):
                tweets = split_into_thread(prepared["content"])
                prepared["is_thread"] = True
                prepared["thread_tweets"] = tweets
                prepared["thread_count"] = len(tweets)
                # Validate each tweet
                prepared["thread_valid"] = all(
                    validate_post(tweet, Platform.TWITTER)["valid"]
                    for tweet in tweets
                )
                if not prepared["thread_valid"]:
                    result["all_valid"] = False
            else:
                prepared["is_thread"] = False

        # Validate the content
        validation = validate_post(prepared["content"], platform)
        prepared["validation"] = validation

        if not validation["valid"]:
            result["all_valid"] = False

        result["platforms"][platform_str] = prepared

    return result


@mcp.tool()
def create_thread(
    content: str,
    max_chars: int = 280,
    number_format: str = "({n}/{total})"
) -> dict[str, Any]:
    """
    Split long content into a Twitter thread.

    Args:
        content: The full text to split
        max_chars: Maximum characters per tweet (default 280)
        number_format: Format for numbering, e.g. "({n}/{total})"

    Returns:
        List of tweets with numbering and validation
    """
    if not needs_thread(content, max_chars):
        return {
            "needs_thread": False,
            "message": "Content fits in a single tweet",
            "content": content,
            "char_count": count_chars(content, Platform.TWITTER),
        }

    tweets = split_into_thread(content, max_chars, number_format=number_format)

    # Validate each tweet
    validations = []
    all_valid = True
    for tweet in tweets:
        val = validate_post(tweet, Platform.TWITTER)
        validations.append(val)
        if not val["valid"]:
            all_valid = False

    return {
        "needs_thread": True,
        "thread_count": len(tweets),
        "tweets": tweets,
        "validations": validations,
        "all_valid": all_valid,
        "preview": format_thread_preview(tweets),
    }


# ============================================================================
# PREVIEW TOOLS
# ============================================================================

@mcp.tool()
def preview_posts(
    twitter_content: Optional[str] = None,
    linkedin_content: Optional[str] = None,
    facebook_content: Optional[str] = None,
) -> dict[str, Any]:
    """
    Generate a formatted preview of posts for all platforms.

    Args:
        twitter_content: Content for Twitter (will auto-thread if needed)
        linkedin_content: Content for LinkedIn
        facebook_content: Content for Facebook

    Returns:
        Formatted preview with character counts and validation
    """
    preview_parts = []
    validations = {}
    all_valid = True

    if twitter_content:
        if needs_thread(twitter_content):
            tweets = split_into_thread(twitter_content)
            preview_parts.append(format_thread_preview(tweets))
            validations["twitter"] = {
                "is_thread": True,
                "tweet_count": len(tweets),
                "all_valid": all(
                    validate_post(t, Platform.TWITTER)["valid"]
                    for t in tweets
                ),
            }
            if not validations["twitter"]["all_valid"]:
                all_valid = False
        else:
            preview_parts.append(format_post_preview(twitter_content, Platform.TWITTER))
            val = validate_post(twitter_content, Platform.TWITTER)
            validations["twitter"] = val
            if not val["valid"]:
                all_valid = False

    if linkedin_content:
        # Check for URLs that should be in comment
        linkedin_prep = prepare_linkedin_post(linkedin_content)
        preview_parts.append(format_post_preview(linkedin_prep["post_text"], Platform.LINKEDIN))
        if linkedin_prep["comment_urls"]:
            preview_parts.append(f"  Link for comment: {linkedin_prep['comment_urls']}")
        val = validate_post(linkedin_prep["post_text"], Platform.LINKEDIN)
        validations["linkedin"] = val
        validations["linkedin"]["extracted_urls"] = linkedin_prep["comment_urls"]
        if not val["valid"]:
            all_valid = False

    if facebook_content:
        preview_parts.append(format_post_preview(facebook_content, Platform.FACEBOOK))
        val = validate_post(facebook_content, Platform.FACEBOOK)
        validations["facebook"] = val
        if not val["valid"]:
            all_valid = False

    return {
        "preview": "\n".join(preview_parts),
        "validations": validations,
        "all_valid": all_valid,
    }


# ============================================================================
# HISTORY TOOLS
# ============================================================================

@mcp.tool()
def log_post(
    platforms: list[str],
    content: dict[str, str],
    status: str = "posted",
    thread: bool = False,
    image_prompt: Optional[str] = None,
    post_ids: Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    """
    Log a posted or attempted post to history.

    Args:
        platforms: List of platforms posted to
        content: Dict mapping platform to content posted
        status: "posted", "failed", or "preview"
        thread: Whether this was a Twitter thread
        image_prompt: AI image generation prompt if used
        post_ids: Dict mapping platform to post ID

    Returns:
        The created history entry
    """
    entry = post_history.add_entry(
        platforms=platforms,
        content=content,
        status=status,
        thread=thread,
        image_prompt=image_prompt,
        metadata={"post_ids": post_ids} if post_ids else None,
    )
    return {"logged": True, "entry": entry}


@mcp.tool()
def get_post_history(count: int = 10, platform: Optional[str] = None) -> dict[str, Any]:
    """
    Get recent post history.

    Args:
        count: Number of entries to return (default 10)
        platform: Optionally filter by platform

    Returns:
        List of recent history entries
    """
    if platform:
        entries = post_history.get_by_platform(platform, count)
    else:
        entries = post_history.get_recent(count)

    return {
        "count": len(entries),
        "entries": entries,
    }


@mcp.tool()
def get_post_stats() -> dict[str, Any]:
    """
    Get posting statistics.

    Returns:
        Statistics including total posts, posts by platform, threads, etc.
    """
    return post_history.get_stats()


# ============================================================================
# HASHTAG TOOLS
# ============================================================================

@mcp.tool()
def suggest_hashtags(
    content: str,
    platform: str,
    max_count: Optional[int] = None,
) -> dict[str, Any]:
    """
    Suggest hashtags for content based on platform best practices.

    Args:
        content: The post content
        platform: Target platform
        max_count: Override platform's max hashtag count

    Returns:
        Suggested hashtags and current hashtag analysis
    """
    try:
        plat = Platform(platform.lower())
    except ValueError:
        return {"error": f"Unknown platform: {platform}"}

    rules = PLATFORM_RULES[plat]
    limit = max_count or rules.max_hashtags

    # Extract existing hashtags
    existing = extract_hashtags(content)

    # Common tech hashtags by category
    suggestions = {
        "ai": ["#AI", "#MachineLearning", "#GenerativeAI", "#LLM", "#AITools"],
        "dev": ["#DevTools", "#Coding", "#WebDev", "#OpenSource", "#Programming"],
        "saas": ["#SaaS", "#Startup", "#TechNews", "#ProductLaunch", "#BuildInPublic"],
        "product": ["#ProductUpdate", "#NewFeature", "#TechNews", "#Innovation"],
    }

    # Detect topic from content
    content_lower = content.lower()
    detected_tags = []

    if any(kw in content_lower for kw in ["ai", "machine learning", "llm", "gpt", "claude"]):
        detected_tags.extend(suggestions["ai"])
    if any(kw in content_lower for kw in ["code", "dev", "build", "ship", "deploy"]):
        detected_tags.extend(suggestions["dev"])
    if any(kw in content_lower for kw in ["launch", "release", "feature", "update"]):
        detected_tags.extend(suggestions["product"])

    # Platform-specific adjustments
    if plat == Platform.LINKEDIN:
        detected_tags = [tag for tag in detected_tags if tag not in ["#LLM", "#GPT"]]
        detected_tags.extend(["#Innovation", "#Leadership", "#TechLeadership"])
    elif plat == Platform.FACEBOOK:
        # Facebook: fewer, broader tags
        detected_tags = detected_tags[:2]

    # Remove duplicates and existing
    detected_tags = list(dict.fromkeys(detected_tags))  # Preserve order, remove dupes
    detected_tags = [tag for tag in detected_tags if tag not in existing]

    return {
        "platform": platform,
        "max_hashtags": limit,
        "existing_hashtags": existing,
        "existing_count": len(existing),
        "suggested_hashtags": detected_tags[:limit],
        "over_limit": len(existing) > limit,
    }


# ============================================================================
# DRY RUN / CONNECTION TEST
# ============================================================================

@mcp.tool()
def test_connections() -> dict[str, Any]:
    """
    Test MCP server connections (dry run).

    Returns:
        Connection status for each platform's MCP server
    """
    # This is a self-test - if this tool runs, this server is working
    return {
        "social_poster": {
            "status": "ready",
            "message": "Social Poster MCP is running",
        },
        "note": "To test Twitter/LinkedIn, use mcp__social-media__get_trending_topics. "
               "To test Facebook, use mcp__facebook__get_page_posts.",
        "instructions": [
            "Call mcp__social-media__get_trending_topics({platform: 'twitter', count: 1})",
            "Call mcp__facebook__get_page_posts()",
        ],
    }


# ============================================================================
# QUICK POST HELPER
# ============================================================================

@mcp.tool()
def quick_post_check(
    content: str,
    platforms: list[str] = ["twitter", "linkedin", "facebook"],
) -> dict[str, Any]:
    """
    Quick check if content is ready to post to all platforms.

    Args:
        content: The content to check
        platforms: Platforms to check against

    Returns:
        Ready status and any issues that need fixing
    """
    issues = []
    ready = True
    platform_status = {}

    for platform_str in platforms:
        try:
            platform = Platform(platform_str.lower())
        except ValueError:
            issues.append(f"Unknown platform: {platform_str}")
            ready = False
            continue

        rules = PLATFORM_RULES[platform]
        val = validate_post(content, platform)

        status = {
            "ready": val["valid"],
            "char_count": f"{val['char_count']}/{rules.char_limit}",
        }

        if platform == Platform.TWITTER and needs_thread(content):
            tweets = split_into_thread(content)
            status["needs_thread"] = True
            status["thread_count"] = len(tweets)
            status["thread_valid"] = all(
                validate_post(t, Platform.TWITTER)["valid"]
                for t in tweets
            )
            if not status["thread_valid"]:
                issues.append("Twitter thread has invalid tweets")
                ready = False

        if platform == Platform.LINKEDIN:
            urls = extract_urls(content)
            if urls:
                status["has_urls"] = True
                status["url_warning"] = "Move URLs to first comment for better reach"
                issues.append("LinkedIn: URLs should be in first comment")

        if not val["valid"]:
            ready = False
            for error in val["errors"]:
                issues.append(f"{platform_str}: {error}")

        for warning in val.get("warnings", []):
            issues.append(f"{platform_str} (warning): {warning}")

        platform_status[platform_str] = status

    return {
        "ready": ready,
        "platforms": platform_status,
        "issues": issues if issues else None,
        "message": "Ready to post!" if ready else "Fix issues before posting",
    }


if __name__ == "__main__":
    mcp.run()
