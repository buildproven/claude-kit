import requests
from typing import Any
from config import THREADS_API_BASE_URL, THREADS_USER_ID, THREADS_ACCESS_TOKEN


class ThreadsAPI:
    """Wrapper for the Meta Threads API (graph.threads.net).
    
    Posting is a two-step process:
    1. Create a media container (draft)
    2. Publish the container
    """

    def _request(self, method: str, endpoint: str, params: dict[str, Any] = None, json: dict[str, Any] = None) -> dict[str, Any]:
        url = f"{THREADS_API_BASE_URL}/{endpoint}"
        if params is None:
            params = {}
        params["access_token"] = THREADS_ACCESS_TOKEN
        response = requests.request(method, url, params=params, json=json)
        return response.json()

    def create_container(self, text: str, media_type: str = "TEXT", link_attachment: str = None) -> dict[str, Any]:
        """Step 1: Create a media container (draft post)."""
        params = {
            "media_type": media_type,
            "text": text,
        }
        if link_attachment:
            params["link_attachment"] = link_attachment
        return self._request("POST", f"{THREADS_USER_ID}/threads", params)

    def publish(self, creation_id: str) -> dict[str, Any]:
        """Step 2: Publish a previously created container."""
        params = {
            "creation_id": creation_id,
        }
        return self._request("POST", f"{THREADS_USER_ID}/threads_publish", params)

    def post_text(self, text: str, link_attachment: str = None) -> dict[str, Any]:
        """Convenience: create + publish a text post in one call."""
        container = self.create_container(text, link_attachment=link_attachment)
        if "id" not in container:
            return {"error": "Failed to create container", "details": container}
        return self.publish(container["id"])

    def get_threads(self, limit: int = 25) -> dict[str, Any]:
        """Fetch recent threads for the user."""
        params = {
            "fields": "id,text,timestamp,media_type,permalink,is_quote_post",
            "limit": limit,
        }
        return self._request("GET", f"{THREADS_USER_ID}/threads", params)

    def get_thread(self, thread_id: str) -> dict[str, Any]:
        """Get details of a specific thread."""
        params = {
            "fields": "id,text,timestamp,media_type,permalink,is_quote_post",
        }
        return self._request("GET", f"{thread_id}", params)

    def delete_thread(self, thread_id: str) -> dict[str, Any]:
        """Delete a specific thread."""
        return self._request("DELETE", f"{thread_id}")

    def get_replies(self, thread_id: str) -> dict[str, Any]:
        """Get replies to a thread."""
        params = {
            "fields": "id,text,timestamp,username",
        }
        return self._request("GET", f"{thread_id}/replies", params)

    def reply_to_thread(self, thread_id: str, text: str) -> dict[str, Any]:
        """Reply to an existing thread."""
        params = {
            "media_type": "TEXT",
            "text": text,
            "reply_to_id": thread_id,
        }
        container = self._request("POST", f"{THREADS_USER_ID}/threads", params)
        if "id" not in container:
            return {"error": "Failed to create reply container", "details": container}
        return self.publish(container["id"])

    def get_insights(self, thread_id: str) -> dict[str, Any]:
        """Get insights for a specific thread."""
        params = {
            "metric": "views,likes,replies,reposts,quotes",
        }
        return self._request("GET", f"{thread_id}/insights", params)

    def get_profile(self) -> dict[str, Any]:
        """Get the authenticated user's profile."""
        params = {
            "fields": "id,username,threads_profile_picture_url,threads_biography",
        }
        return self._request("GET", "me", params)
