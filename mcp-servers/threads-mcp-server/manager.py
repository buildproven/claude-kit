from threads_api import ThreadsAPI
from typing import Any


class Manager:
    def __init__(self):
        self.api = ThreadsAPI()

    def post_to_threads(self, text: str, link_attachment: str = None) -> dict[str, Any]:
        """Post a text message to Threads."""
        result = self.api.post_text(text, link_attachment=link_attachment)
        if "id" in result:
            return {"success": True, "thread_id": result["id"], "message": "Posted to Threads"}
        return {"success": False, "error": result}

    def reply_to_thread(self, thread_id: str, text: str) -> dict[str, Any]:
        """Reply to an existing thread."""
        result = self.api.reply_to_thread(thread_id, text)
        if "id" in result:
            return {"success": True, "reply_id": result["id"], "message": "Reply posted"}
        return {"success": False, "error": result}

    def get_recent_threads(self, limit: int = 25) -> dict[str, Any]:
        """Get recent threads."""
        return self.api.get_threads(limit)

    def get_thread_details(self, thread_id: str) -> dict[str, Any]:
        """Get details of a specific thread."""
        return self.api.get_thread(thread_id)

    def delete_thread(self, thread_id: str) -> dict[str, Any]:
        """Delete a thread."""
        result = self.api.delete_thread(thread_id)
        return {"success": True, "result": result}

    def get_thread_replies(self, thread_id: str) -> dict[str, Any]:
        """Get replies to a thread."""
        return self.api.get_replies(thread_id)

    def get_thread_insights(self, thread_id: str) -> dict[str, Any]:
        """Get engagement metrics for a thread."""
        return self.api.get_insights(thread_id)

    def get_profile(self) -> dict[str, Any]:
        """Get the authenticated Threads profile."""
        return self.api.get_profile()
