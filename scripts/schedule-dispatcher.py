#!/usr/bin/env python3
"""Schedule dispatcher for social media posts.

Reads data/schedule-queue.json, posts any due items via platform APIs,
and updates the queue with results. Designed to run via GitHub Actions
cron hourly during business hours (7am-6pm CST, weekdays).

Note: During CDT (daylight saving, Mar-Nov), the window shifts to
8am-7pm CDT since the cron is UTC-based.
"""

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
import tweepy

QUEUE_PATH = Path(__file__).parent.parent / "data" / "schedule-queue.json"
MAX_RETRIES = 3
DEFAULT_GRACE_MINUTES = 120
FACEBOOK_API_VERSION = "v21.0"
DEFAULT_CTA_URL = ""  # Set your own CTA URL here or pass via --cta-url argument

PLATFORM_ENV_VARS = {
    "twitter": [
        "TWITTER_API_KEY",
        "TWITTER_API_SECRET",
        "TWITTER_ACCESS_TOKEN",
        "TWITTER_ACCESS_TOKEN_SECRET",
    ],
    "linkedin": ["LINKEDIN_ACCESS_TOKEN"],
    "facebook": ["FACEBOOK_PAGE_ID", "FACEBOOK_PAGE_ACCESS_TOKEN"],
}


def load_queue():
    with QUEUE_PATH.open() as f:
        return json.load(f)


def save_queue(queue):
    with QUEUE_PATH.open("w") as f:
        json.dump(queue, f, indent=2)
        f.write("\n")


def check_env_vars(platforms):
    missing = {}
    for platform in platforms:
        required = PLATFORM_ENV_VARS.get(platform, [])
        absent = [k for k in required if k not in os.environ]
        if absent:
            missing[platform] = absent
    if missing:
        parts = [f"  {p}: {', '.join(vs)}" for p, vs in missing.items()]
        raise OSError("Missing required env vars:\n" + "\n".join(parts))


def post_to_twitter(text, cta_url=None):
    client = tweepy.Client(
        consumer_key=os.environ["TWITTER_API_KEY"],
        consumer_secret=os.environ["TWITTER_API_SECRET"],
        access_token=os.environ["TWITTER_ACCESS_TOKEN"],
        access_token_secret=os.environ["TWITTER_ACCESS_TOKEN_SECRET"],
    )

    tweets = split_into_thread(text) if len(text) > 280 else [text]

    # Append CTA as final tweet in thread (keeps link out of main tweet)
    if cta_url:
        tweets.append(f"Subscribe for more \u2192 {cta_url}")

    if len(tweets) == 1:
        response = client.create_tweet(text=tweets[0])
        return {"tweet_id": str(response.data["id"])}

    # Post as thread
    reply_to = None
    tweet_ids = []
    for tweet_text in tweets:
        response = client.create_tweet(text=tweet_text, in_reply_to_tweet_id=reply_to)
        tweet_id = str(response.data["id"])
        tweet_ids.append(tweet_id)
        reply_to = tweet_id

    return {"tweet_ids": tweet_ids, "thread_length": len(tweet_ids)}


def split_into_thread(text, max_len=270):
    paragraphs = text.split("\n\n")
    tweets = []
    current = ""

    for para in paragraphs:
        candidate = f"{current}\n\n{para}".strip() if current else para
        if len(candidate) <= max_len:
            current = candidate
        else:
            if current:
                tweets.append(current)
            # Split long paragraphs at word boundaries
            while len(para) > max_len:
                split_at = para[:max_len].rfind(" ")
                if split_at <= 0:
                    split_at = max_len
                tweets.append(para[:split_at].rstrip())
                para = para[split_at:].lstrip()
            current = para

    if current:
        tweets.append(current)

    return tweets if tweets else [text[:max_len]]


def post_to_linkedin(text, cta_url=None):
    access_token = os.environ["LINKEDIN_ACCESS_TOKEN"]

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "LinkedIn-Version": "202503",
        "X-Restli-Protocol-Version": "2.0.0",
    }

    # Get user profile URN via OpenID Connect
    profile_resp = requests.get(
        "https://api.linkedin.com/v2/userinfo",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=30,
    )
    profile_resp.raise_for_status()
    user_sub = profile_resp.json()["sub"]
    author_urn = f"urn:li:person:{user_sub}"

    payload = {
        "author": author_urn,
        "commentary": text,
        "visibility": "PUBLIC",
        "distribution": {
            "feedDistribution": "MAIN_FEED",
            "targetEntities": [],
            "thirdPartyDistributionChannels": [],
        },
        "lifecycleState": "PUBLISHED",
    }

    # Attach link as article share (renders as link preview card)
    if cta_url:
        payload["content"] = {
            "article": {
                "source": cta_url,
                "title": "Subscribe for more",
            }
        }

    resp = requests.post(
        "https://api.linkedin.com/rest/posts",
        headers=headers,
        json=payload,
        timeout=30,
    )
    resp.raise_for_status()
    post_id = resp.headers.get("x-restli-id", resp.json().get("id", "unknown"))
    return {"post_id": post_id}


def post_to_facebook(text, cta_url=None):
    page_id = os.environ["FACEBOOK_PAGE_ID"]
    access_token = os.environ["FACEBOOK_PAGE_ACCESS_TOKEN"]

    data = {"message": text, "access_token": access_token}
    # Facebook has minimal link penalty — include inline if provided
    if cta_url:
        data["link"] = cta_url

    resp = requests.post(
        f"https://graph.facebook.com/{FACEBOOK_API_VERSION}/{page_id}/feed",
        data=data,
        timeout=30,
    )
    resp.raise_for_status()
    return {"post_id": resp.json().get("id", "unknown")}


PLATFORM_POSTERS = {
    "twitter": post_to_twitter,
    "linkedin": post_to_linkedin,
    "facebook": post_to_facebook,
}


def process_post(post):
    now = datetime.now(timezone.utc)
    scheduled_at = datetime.fromisoformat(post["scheduled_at"])
    grace_minutes = post.get("grace_minutes", DEFAULT_GRACE_MINUTES)

    if scheduled_at > now:
        return False  # not due yet

    if now > scheduled_at + timedelta(minutes=grace_minutes):
        post["status"] = "expired"
        post["expired_at"] = now.isoformat()
        print(f"  EXPIRED: {post['id']} (past {grace_minutes}min grace window)")
        return True

    # Validate env vars for target platforms before attempting
    try:
        check_env_vars(post["platforms"])
    except OSError as e:
        post["status"] = "failed"
        post["failed_at"] = now.isoformat()
        post["results"] = post.get("results", {})
        post["results"]["_error"] = str(e)
        print(f"  FAILED: {post['id']} - {e}")
        return True

    results = post.get("results", {})
    all_succeeded = True
    had_failure = False

    for platform in post["platforms"]:
        if platform in results and results[platform].get("status") == "posted":
            continue

        content = post["content"].get(platform, "")
        if not content:
            results[platform] = {"status": "failed", "error": "No content for platform"}
            all_succeeded = False
            had_failure = True
            continue

        poster = PLATFORM_POSTERS.get(platform)
        if not poster:
            results[platform] = {
                "status": "failed",
                "error": f"Unknown platform: {platform}",
            }
            all_succeeded = False
            had_failure = True
            continue

        cta_url = post.get("cta_url", DEFAULT_CTA_URL)

        try:
            result = poster(content, cta_url=cta_url)
            results[platform] = {
                "status": "posted",
                "posted_at": now.isoformat(),
                **result,
            }
            print(f"  POSTED to {platform}: {post['id']}")
        except Exception as e:
            error_msg = str(e)[:200]
            results[platform] = {"status": "failed", "error": error_msg}
            print(f"  FAILED {platform}: {post['id']} - {error_msg}")
            all_succeeded = False
            had_failure = True

    post["results"] = results

    # Increment attempts once per dispatch run (not per platform)
    if had_failure:
        post["attempts"] = post.get("attempts", 0) + 1

    if all_succeeded:
        post["status"] = "posted"
        post["posted_at"] = now.isoformat()
    elif post.get("attempts", 0) >= MAX_RETRIES:
        post["status"] = "failed"
        post["failed_at"] = now.isoformat()
        print(f"  GAVE UP: {post['id']} after {MAX_RETRIES} attempts")

    return True


def main():
    if not QUEUE_PATH.exists():
        print("No queue file found. Nothing to do.")
        return

    queue = load_queue()
    posts = queue.get("posts", [])
    pending = [p for p in posts if p.get("status") == "pending"]

    if not pending:
        print("No pending posts.")
        return

    print(f"Processing {len(pending)} pending post(s)...")
    modified = False

    for post in pending:
        changed = process_post(post)
        if changed:
            modified = True

    if modified:
        save_queue(queue)
        print("Queue updated.")

    statuses = {}
    for p in posts:
        s = p.get("status", "unknown")
        statuses[s] = statuses.get(s, 0) + 1
    print(f"Queue summary: {statuses}")


if __name__ == "__main__":
    main()
