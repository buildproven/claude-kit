# Threads MCP Server

Post and manage Meta Threads content via the Threads API.

## Setup

### 1. Get Threads API Access

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Use your existing Meta App (same one as Facebook) or create a new one
3. Add the **Threads API** product to your app
4. Under Threads API > Settings, generate a **Threads access token**
5. Required permissions: `threads_basic`, `threads_content_publish`, `threads_manage_replies`, `threads_read_replies`

### 2. Get Your Threads User ID

```bash
curl "https://graph.threads.net/v1.0/me?fields=id,username&access_token=YOUR_TOKEN"
```

### 3. Add to .env

Add these to your `claude-setup/.env`:

```
THREADS_ACCESS_TOKEN=your_long_lived_token
THREADS_USER_ID=your_threads_user_id
```

### 4. Run

```bash
uv run server.py
```

## Tools

- `post_to_threads` — Post text (with optional link attachment)
- `reply_to_thread` — Reply to an existing thread
- `get_recent_threads` — Fetch recent posts
- `get_thread_details` — Get a specific thread
- `delete_thread` — Delete a thread
- `get_thread_replies` — Get replies to a thread
- `get_thread_insights` — Get engagement metrics
- `get_threads_profile` — Get profile info

## Notes

- Threads API uses a two-step post process (create container → publish)
- Text posts have a 500 character limit
- Link attachments generate previews automatically
- Rate limits: 250 API calls per user per hour
