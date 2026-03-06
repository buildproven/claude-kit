from mcp.server.fastmcp import FastMCP
from manager import Manager
from typing import Any

mcp = FastMCP("ThreadsMCP")
manager = Manager()


@mcp.tool()
def post_to_threads(text: str, link_attachment: str = None) -> dict[str, Any]:
    """Post a text message to Threads.
    Input: text (str), optional link_attachment (str) for link previews
    Output: dict with thread ID and status
    """
    return manager.post_to_threads(text, link_attachment=link_attachment)


@mcp.tool()
def reply_to_thread(thread_id: str, text: str) -> dict[str, Any]:
    """Reply to an existing thread post.
    Input: thread_id (str), text (str)
    Output: dict with reply ID and status
    """
    return manager.reply_to_thread(thread_id, text)


@mcp.tool()
def get_recent_threads(limit: int = 25) -> dict[str, Any]:
    """Fetch recent threads from the account.
    Input: limit (int, default 25)
    Output: dict with list of thread objects
    """
    return manager.get_recent_threads(limit)


@mcp.tool()
def get_thread_details(thread_id: str) -> dict[str, Any]:
    """Get details of a specific thread post.
    Input: thread_id (str)
    Output: dict with thread details (text, timestamp, permalink)
    """
    return manager.get_thread_details(thread_id)


@mcp.tool()
def delete_thread(thread_id: str) -> dict[str, Any]:
    """Delete a specific thread post.
    Input: thread_id (str)
    Output: dict with deletion result
    """
    return manager.delete_thread(thread_id)


@mcp.tool()
def get_thread_replies(thread_id: str) -> dict[str, Any]:
    """Get replies to a thread post.
    Input: thread_id (str)
    Output: dict with reply objects
    """
    return manager.get_thread_replies(thread_id)


@mcp.tool()
def get_thread_insights(thread_id: str) -> dict[str, Any]:
    """Get engagement metrics (views, likes, replies, reposts, quotes) for a thread.
    Input: thread_id (str)
    Output: dict with metric values
    """
    return manager.get_thread_insights(thread_id)


@mcp.tool()
def get_threads_profile() -> dict[str, Any]:
    """Get the authenticated Threads profile info.
    Input: None
    Output: dict with username, bio, profile picture
    """
    return manager.get_profile()


if __name__ == "__main__":
    mcp.run()
