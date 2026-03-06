#!/usr/bin/env python3
"""Hourly scheduler: post any pending Twitter tweets/threads whose post_at has passed."""

import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import tweepy
from dotenv import load_dotenv

env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[
        logging.FileHandler(Path(__file__).parent.parent / "logs" / "twitter-scheduler.log"),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("twitter-scheduler")

SCHEDULE_FILE = Path(__file__).parent.parent / "mcp-servers/twitter-mcp-server/.twitter_schedule.json"
CACHE_FILE = Path(__file__).parent.parent / "mcp-servers/twitter-mcp-server/.twitter_rate_limit_cache"
DAILY_LIMIT = 15


def load_schedule() -> list[dict]:
    if not SCHEDULE_FILE.exists():
        return []
    try:
        return json.loads(SCHEDULE_FILE.read_text())
    except (json.JSONDecodeError, TypeError):
        return []


def save_schedule(items: list[dict]) -> None:
    SCHEDULE_FILE.write_text(json.dumps(items, indent=2))


def get_post_count() -> tuple[int, float]:
    if not CACHE_FILE.exists():
        return 0, time.time()
    try:
        data = json.loads(CACHE_FILE.read_text())
        count = data.get("count", 0)
        reset = data.get("reset", time.time())
        # Reset if 24h has passed
        if time.time() - reset > 86400:
            return 0, time.time()
        return count, reset
    except (json.JSONDecodeError, TypeError):
        return 0, time.time()


def save_post_count(count: int, reset: float) -> None:
    CACHE_FILE.write_text(json.dumps({"count": count, "reset": reset}))


def make_client() -> tweepy.Client:
    return tweepy.Client(
        consumer_key=os.environ["TWITTER_API_KEY"],
        consumer_secret=os.environ["TWITTER_API_SECRET"],
        access_token=os.environ["TWITTER_ACCESS_TOKEN"],
        access_token_secret=os.environ["TWITTER_ACCESS_TOKEN_SECRET"],
    )


def post_thread(client: tweepy.Client, tweets: list[str]) -> list[str]:
    """Post a thread, return list of tweet IDs."""
    ids = []
    reply_to = None
    for text in tweets:
        if reply_to:
            resp = client.create_tweet(text=text, in_reply_to_tweet_id=reply_to)
        else:
            resp = client.create_tweet(text=text)
        reply_to = resp.data["id"]
        ids.append(reply_to)
    return ids


def main() -> None:
    # Ensure logs dir exists
    (Path(__file__).parent.parent / "logs").mkdir(exist_ok=True)

    items = load_schedule()
    pending = [i for i in items if i["status"] == "pending"]

    if not pending:
        logger.info("No pending scheduled posts.")
        return

    now = datetime.now(timezone.utc)
    due = [i for i in pending if datetime.fromisoformat(i["post_at"]) <= now]

    if not due:
        next_post = min(pending, key=lambda i: i["post_at"])
        logger.info("No posts due yet. Next: %s at %s", next_post["id"][:8], next_post["post_at"])
        return

    post_count, reset_time = get_post_count()
    client = make_client()

    for item in due:
        tweets = item["tweets"]
        needed = len(tweets)

        if post_count + needed > DAILY_LIMIT:
            remaining = DAILY_LIMIT - post_count
            logger.warning(
                "Skipping %s (%s tweets): only %d quota remaining today.",
                item["id"][:8], needed, remaining,
            )
            continue

        try:
            ids = post_thread(client, tweets)
            post_count += needed
            save_post_count(post_count, reset_time)

            item["status"] = "posted"
            item["posted_at"] = now.isoformat()
            item["tweet_ids"] = ids
            logger.info("Posted %s (%d tweets). IDs: %s", item["id"][:8], needed, ids)
        except Exception as e:
            item["status"] = "failed"
            item["error"] = str(e)
            logger.error("Failed to post %s: %s", item["id"][:8], e)

    save_schedule(items)


if __name__ == "__main__":
    main()
