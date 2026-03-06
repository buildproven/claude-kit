"""Post history logging and management."""

import json
import os
from datetime import datetime
from typing import Optional, Any
from pathlib import Path


# Default history file location
DEFAULT_HISTORY_PATH = os.path.expanduser("~/.claude/social-post-history.json")


class PostHistory:
    """Manage social media post history."""

    def __init__(self, history_path: str = DEFAULT_HISTORY_PATH):
        self.history_path = Path(history_path)
        self._ensure_file_exists()

    def _ensure_file_exists(self):
        """Create history file if it doesn't exist."""
        if not self.history_path.exists():
            self.history_path.parent.mkdir(parents=True, exist_ok=True)
            self._save([])

    def _load(self) -> list[dict]:
        """Load history from file."""
        try:
            with open(self.history_path, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, FileNotFoundError):
            return []

    def _save(self, history: list[dict]):
        """Save history to file."""
        with open(self.history_path, "w") as f:
            json.dump(history, f, indent=2, default=str)

    def add_entry(
        self,
        platforms: list[str],
        content: dict[str, str],
        status: str = "posted",
        thread: bool = False,
        image_prompt: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> dict:
        """
        Add a new entry to the history.

        Args:
            platforms: List of platforms posted to
            content: Dict of platform -> post content
            status: "posted", "failed", "preview"
            thread: Whether this was a thread
            image_prompt: AI image generation prompt if used
            metadata: Additional metadata (post IDs, etc)

        Returns:
            The created history entry
        """
        entry = {
            "id": datetime.now().strftime("%Y%m%d%H%M%S%f"),
            "timestamp": datetime.now().isoformat(),
            "platforms": platforms,
            "content": content,
            "status": status,
            "thread": thread,
            "image_prompt": image_prompt,
            "metadata": metadata or {},
        }

        history = self._load()
        history.append(entry)
        self._save(history)

        return entry

    def get_recent(self, count: int = 10) -> list[dict]:
        """Get the most recent history entries."""
        history = self._load()
        return history[-count:][::-1]  # Most recent first

    def get_by_platform(self, platform: str, count: int = 10) -> list[dict]:
        """Get recent posts for a specific platform."""
        history = self._load()
        filtered = [
            entry for entry in history
            if platform in entry.get("platforms", [])
        ]
        return filtered[-count:][::-1]

    def get_by_date_range(
        self,
        start_date: datetime,
        end_date: Optional[datetime] = None
    ) -> list[dict]:
        """Get posts within a date range."""
        end_date = end_date or datetime.now()
        history = self._load()

        filtered = []
        for entry in history:
            try:
                entry_date = datetime.fromisoformat(entry["timestamp"])
                if start_date <= entry_date <= end_date:
                    filtered.append(entry)
            except (KeyError, ValueError):
                continue

        return filtered

    def search_content(self, query: str) -> list[dict]:
        """Search posts by content."""
        history = self._load()
        query_lower = query.lower()

        results = []
        for entry in history:
            content = entry.get("content", {})
            for platform_content in content.values():
                if query_lower in platform_content.lower():
                    results.append(entry)
                    break

        return results

    def get_stats(self) -> dict:
        """Get posting statistics."""
        history = self._load()

        if not history:
            return {
                "total_posts": 0,
                "by_platform": {},
                "by_status": {},
                "threads": 0,
                "with_images": 0,
            }

        by_platform: dict[str, int] = {}
        by_status: dict[str, int] = {}
        threads = 0
        with_images = 0

        for entry in history:
            # Count by platform
            for platform in entry.get("platforms", []):
                by_platform[platform] = by_platform.get(platform, 0) + 1

            # Count by status
            status = entry.get("status", "unknown")
            by_status[status] = by_status.get(status, 0) + 1

            # Count threads
            if entry.get("thread"):
                threads += 1

            # Count posts with images
            if entry.get("image_prompt"):
                with_images += 1

        return {
            "total_posts": len(history),
            "by_platform": by_platform,
            "by_status": by_status,
            "threads": threads,
            "with_images": with_images,
        }

    def clear_history(self) -> int:
        """Clear all history. Returns count of deleted entries."""
        history = self._load()
        count = len(history)
        self._save([])
        return count


# Global instance
post_history = PostHistory()
