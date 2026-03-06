import asyncio
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any

import mcp.server.stdio
import mcp.types as types
import tweepy
from dotenv import load_dotenv
from mcp.server import NotificationOptions, Server
from mcp.server.models import InitializationOptions

# Load .env from central claude-setup directory
env_path = Path(__file__).parent.parent.parent.parent.parent / ".env"
load_dotenv(env_path)

if sys.platform == "win32" and os.environ.get("PYTHONIOENCODING") is None:
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

logger = logging.getLogger("twitter_mcp_server")

# Twitter OAuth 1.0a credentials
API_KEY = os.environ.get("TWITTER_API_KEY")
API_SECRET = os.environ.get("TWITTER_API_SECRET")
ACCESS_TOKEN = os.environ.get("TWITTER_ACCESS_TOKEN")
ACCESS_TOKEN_SECRET = os.environ.get("TWITTER_ACCESS_TOKEN_SECRET")


class TwitterManager:
    def __init__(self):
        self.client = tweepy.Client(
            consumer_key=API_KEY,
            consumer_secret=API_SECRET,
            access_token=ACCESS_TOKEN,
            access_token_secret=ACCESS_TOKEN_SECRET,
        )
        # Rate limit tracking
        self.cache_file = (
            Path(__file__).parent.parent.parent / ".twitter_rate_limit_cache"
        )
        self.DAILY_LIMIT = 15  # Buffer below Twitter's 17/day limit
        self._load_cache()

    def _load_cache(self):
        """Load rate limit cache from disk"""
        if self.cache_file.exists():
            try:
                data = json.loads(self.cache_file.read_text())
                self.post_count = data.get("count", 0)
                self.last_reset = data.get("reset", time.time())
            except (json.JSONDecodeError, KeyError, TypeError):
                self.post_count = 0
                self.last_reset = time.time()
        else:
            self.post_count = 0
            self.last_reset = time.time()

    def _save_cache(self):
        """Save rate limit cache to disk"""
        self.cache_file.write_text(
            json.dumps({"count": self.post_count, "reset": self.last_reset})
        )

    def _check_rate_limit(self):
        """Check if we're within rate limits"""
        now = time.time()
        # Reset counter if 24h passed
        if now - self.last_reset > 86400:
            self.post_count = 0
            self.last_reset = now
            self._save_cache()

        if self.post_count >= self.DAILY_LIMIT:
            reset_time = time.strftime(
                "%Y-%m-%d %H:%M:%S", time.localtime(self.last_reset + 86400)
            )
            limit_msg = (
                f"Twitter daily limit reached "
                f"({self.post_count}/{self.DAILY_LIMIT}). Resets at {reset_time}"
            )
            return {"success": False, "error": limit_msg}
        return None

    def post_tweet(self, text: str) -> dict[str, Any]:
        """Posts a tweet to Twitter/X."""
        if len(text) > 280:
            return {
                "success": False,
                "error": (
                    f"Tweet is {len(text)} chars (max 280). "
                    "Shorten the content before posting."
                ),
            }

        # Check rate limit first
        rate_limit_error = self._check_rate_limit()
        if rate_limit_error:
            return rate_limit_error

        try:
            response = self.client.create_tweet(text=text)
            self.post_count += 1
            self._save_cache()

            # Extract rate limit info from response if available
            rate_limit_info = {}
            if hasattr(response, "headers"):
                rate_limit_info = {
                    "twitter_limit": response.headers.get("x-rate-limit-limit"),
                    "twitter_remaining": response.headers.get("x-rate-limit-remaining"),
                    "twitter_reset": response.headers.get("x-rate-limit-reset"),
                }

            return {
                "success": True,
                "tweet_id": response.data["id"],
                "text": text,
                "rate_limit_remaining": self.DAILY_LIMIT - self.post_count,
                "twitter_rate_limit": rate_limit_info,
            }
        except Exception as e:
            error_msg = str(e)
            # Try to extract rate limit headers from error response
            try:
                resp = getattr(e, "response", None)
                if resp is not None and hasattr(resp, "headers"):
                    error_msg += f" | Headers: {dict(resp.headers)}"
            except (AttributeError, TypeError):
                pass  # Silently ignore if we can't extract headers
            return {"success": False, "error": error_msg}

    def post_thread(self, tweets: list[str]) -> dict[str, Any]:
        """Posts a thread of tweets."""
        # Check if we have enough quota for the entire thread
        rate_limit_error = self._check_rate_limit()
        if rate_limit_error:
            return rate_limit_error

        for i, tweet in enumerate(tweets):
            if len(tweet) > 280:
                return {
                    "success": False,
                    "error": (
                        f"Tweet {i + 1} is {len(tweet)} chars "
                        "(max 280). Shorten it before posting."
                    ),
                }

        if self.post_count + len(tweets) > self.DAILY_LIMIT:
            remaining = self.DAILY_LIMIT - self.post_count
            quota_msg = (
                f"Not enough quota for thread. "
                f"Need {len(tweets)}, have {remaining} remaining"
            )
            return {"success": False, "error": quota_msg}

        try:
            results = []
            reply_to_id = None

            for tweet_text in tweets:
                if reply_to_id:
                    response = self.client.create_tweet(
                        text=tweet_text, in_reply_to_tweet_id=reply_to_id
                    )
                else:
                    response = self.client.create_tweet(text=tweet_text)

                reply_to_id = response.data["id"]
                results.append({"tweet_id": response.data["id"], "text": tweet_text})
                self.post_count += 1

            self._save_cache()
            return {
                "success": True,
                "thread": results,
                "rate_limit_remaining": self.DAILY_LIMIT - self.post_count,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def delete_tweet(self, tweet_id: str) -> dict[str, Any]:
        """Deletes a tweet."""
        try:
            self.client.delete_tweet(tweet_id)
            return {"success": True, "deleted_id": tweet_id}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_me(self) -> dict[str, Any]:
        """Gets the authenticated user's profile."""
        try:
            response = self.client.get_me()
            return {
                "success": True,
                "id": response.data.id,
                "username": response.data.username,
                "name": response.data.name,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_rate_limit_status(self) -> dict[str, Any]:
        """Gets current rate limit status (local tracking)"""
        self._check_rate_limit()  # Reset if needed
        reset_time = time.strftime(
            "%Y-%m-%d %H:%M:%S %Z", time.localtime(self.last_reset + 86400)
        )
        return {
            "success": True,
            "posts_used": self.post_count,
            "posts_remaining": self.DAILY_LIMIT - self.post_count,
            "daily_limit": self.DAILY_LIMIT,
            "resets_at": reset_time,
            "note": "Twitter API headers shown in post responses",
        }


async def run_server():
    logger.info("Starting Twitter MCP Server")

    twitter = TwitterManager()
    server = Server("twitter-manager")

    @server.list_tools()
    async def handle_list_tools() -> list[types.Tool]:
        return [
            types.Tool(
                name="post_tweet",
                description="Posts a tweet to Twitter/X",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "text": {
                            "type": "string",
                            "description": "Tweet text (max 280 chars)",
                        },
                    },
                    "required": ["text"],
                },
            ),
            types.Tool(
                name="post_thread",
                description="Posts a thread of multiple tweets",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "tweets": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Array of tweet texts for the thread",
                        },
                    },
                    "required": ["tweets"],
                },
            ),
            types.Tool(
                name="delete_tweet",
                description="Deletes a tweet by ID",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "tweet_id": {
                            "type": "string",
                            "description": "ID of tweet to delete",
                        },
                    },
                    "required": ["tweet_id"],
                },
            ),
            types.Tool(
                name="get_me",
                description="Gets the authenticated Twitter user's profile",
                inputSchema={"type": "object", "properties": {}},
            ),
            types.Tool(
                name="get_rate_limit_status",
                description="Gets Twitter API rate limit status",
                inputSchema={"type": "object", "properties": {}},
            ),
        ]

    @server.call_tool()
    async def handle_call_tool(
        name: str, arguments: dict[str, Any] | None
    ) -> list[types.TextContent]:
        try:
            if name == "post_tweet":
                result = twitter.post_tweet(arguments["text"])
            elif name == "post_thread":
                result = twitter.post_thread(arguments["tweets"])
            elif name == "delete_tweet":
                result = twitter.delete_tweet(arguments["tweet_id"])
            elif name == "get_me":
                result = twitter.get_me()
            elif name == "get_rate_limit_status":
                result = twitter.get_rate_limit_status()
            else:
                msg = f"Unknown tool: {name}"
                raise ValueError(msg)

            return [types.TextContent(type="text", text=str(result))]
        except Exception as e:
            return [types.TextContent(type="text", text=f"Error: {str(e)}")]

    async with mcp.server.stdio.stdio_server() as (read_stream, write_stream):
        logger.info("Server running with stdio transport")
        await server.run(
            read_stream,
            write_stream,
            InitializationOptions(
                server_name="twitter",
                server_version="0.1.0",
                capabilities=server.get_capabilities(
                    notification_options=NotificationOptions(),
                    experimental_capabilities={},
                ),
            ),
        )


def main():
    asyncio.run(run_server())


if __name__ == "__main__":
    main()
