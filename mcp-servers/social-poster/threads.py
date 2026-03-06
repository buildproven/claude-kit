"""Twitter thread splitting functionality."""

import re
from typing import Optional
from platforms import extract_urls, extract_hashtags


def split_into_thread(
    text: str,
    max_chars: int = 280,
    preserve_hashtags: bool = True,
    number_format: str = "({n}/{total})"
) -> list[str]:
    """
    Split long text into a Twitter thread.

    Args:
        text: The full text to split
        max_chars: Maximum characters per tweet (default 280)
        preserve_hashtags: If True, put hashtags only on last tweet
        number_format: Format for tweet numbering, e.g. "({n}/{total})" or "{n}/"

    Returns:
        List of tweet strings, numbered appropriately
    """
    if len(text) <= max_chars:
        return [text]

    # Extract hashtags if we need to preserve them for the end
    hashtags = []
    clean_text = text
    if preserve_hashtags:
        hashtags = extract_hashtags(text)
        # Remove hashtags from text (we'll add to last tweet)
        for tag in hashtags:
            clean_text = clean_text.replace(tag, "").strip()
        clean_text = re.sub(r'\s+', ' ', clean_text).strip()

    # Extract URLs to handle specially (count as 23 chars)
    urls = extract_urls(clean_text)

    # Calculate space needed for numbering (estimate max 99 tweets)
    # e.g., "(1/10)" = 6 chars, "(10/10)" = 7 chars
    numbering_space = 10  # Conservative estimate
    effective_max = max_chars - numbering_space - 1  # -1 for space before number

    # Split into sentences first for natural breaks
    sentences = re.split(r'(?<=[.!?])\s+', clean_text)

    tweets = []
    current_tweet = ""

    for sentence in sentences:
        # Calculate what the length would be with this sentence
        test_text = f"{current_tweet} {sentence}".strip() if current_tweet else sentence

        # Account for URL shortening in length calculation
        test_length = len(test_text)
        for url in urls:
            if url in test_text:
                test_length = test_length - len(url) + 23

        if test_length <= effective_max:
            current_tweet = test_text
        else:
            # Current tweet is full, save it and start new one
            if current_tweet:
                tweets.append(current_tweet)

            # If single sentence is too long, split by words
            if len(sentence) > effective_max:
                words = sentence.split()
                current_tweet = ""
                for word in words:
                    test_text = f"{current_tweet} {word}".strip() if current_tweet else word
                    if len(test_text) <= effective_max:
                        current_tweet = test_text
                    else:
                        if current_tweet:
                            tweets.append(current_tweet)
                        current_tweet = word
            else:
                current_tweet = sentence

    # Don't forget the last tweet
    if current_tweet:
        tweets.append(current_tweet)

    # Add hashtags to the last tweet if they fit
    if preserve_hashtags and hashtags:
        hashtag_str = " " + " ".join(hashtags[:3])  # Max 3 hashtags
        last_tweet = tweets[-1]

        # Check if hashtags fit
        last_length = len(last_tweet) + len(hashtag_str) + numbering_space
        if last_length <= max_chars:
            tweets[-1] = last_tweet + hashtag_str
        else:
            # Add hashtags as a new final tweet if they don't fit
            if len(hashtag_str.strip()) + numbering_space <= max_chars:
                tweets.append(hashtag_str.strip())

    # Add numbering
    total = len(tweets)
    numbered_tweets = []
    for i, tweet in enumerate(tweets, 1):
        number = number_format.format(n=i, total=total)
        numbered_tweets.append(f"{tweet} {number}")

    return numbered_tweets


def needs_thread(text: str, max_chars: int = 280) -> bool:
    """Check if text needs to be split into a thread."""
    # Account for URL shortening
    urls = extract_urls(text)
    effective_length = len(text)
    for url in urls:
        effective_length = effective_length - len(url) + 23

    return effective_length > max_chars


def format_thread_preview(tweets: list[str]) -> str:
    """Format a thread for preview display."""
    preview = f"TWITTER THREAD ({len(tweets)} tweets)\n"
    preview += "=" * 50 + "\n"

    for i, tweet in enumerate(tweets, 1):
        # Calculate effective length (accounting for t.co)
        urls = extract_urls(tweet)
        effective_length = len(tweet)
        for url in urls:
            effective_length = effective_length - len(url) + 23

        status = "OK" if effective_length <= 280 else "OVER"
        preview += f"\n[Tweet {i}] ({effective_length}/280) {status}\n"
        preview += "-" * 40 + "\n"
        preview += tweet + "\n"

    return preview
