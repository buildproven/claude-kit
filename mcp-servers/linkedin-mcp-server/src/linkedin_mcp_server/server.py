import asyncio
import os
import sys
import logging
import time
from pathlib import Path
import requests
from mcp.server.models import InitializationOptions
import mcp.types as types
from mcp.server import NotificationOptions, Server
import mcp.server.stdio
from typing import Any
from dotenv import load_dotenv, set_key

# Load .env from central claude-setup directory
env_path = Path(__file__).parent.parent.parent.parent.parent / ".env"
load_dotenv(env_path)

if sys.platform == "win32" and os.environ.get('PYTHONIOENCODING') is None:
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

logger = logging.getLogger('linkedin_mcp_server')

# LinkedIn API credentials
ACCESS_TOKEN = os.environ.get("LINKEDIN_ACCESS_TOKEN")
PERSON_URN = os.environ.get("LINKEDIN_PERSON_URN")  # Format: urn:li:person:XXXXXXXX
CLIENT_ID = os.environ.get("LINKEDIN_CLIENT_ID")
CLIENT_SECRET = os.environ.get("LINKEDIN_CLIENT_SECRET")
REFRESH_TOKEN = os.environ.get("LINKEDIN_REFRESH_TOKEN")
TOKEN_EXPIRES_AT = os.environ.get("LINKEDIN_TOKEN_EXPIRES_AT")

API_BASE_URL = "https://api.linkedin.com/v2"
TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken"
REFRESH_BUFFER_SECONDS = 86400  # Refresh 1 day before expiry


class LinkedInManager:
    def __init__(self):
        self.access_token = ACCESS_TOKEN
        self.refresh_token = REFRESH_TOKEN
        self.client_id = CLIENT_ID
        self.client_secret = CLIENT_SECRET
        self.token_expires_at = float(TOKEN_EXPIRES_AT) if TOKEN_EXPIRES_AT else None
        self.headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
            "X-Restli-Protocol-Version": "2.0.0"
        }

    def _can_refresh(self) -> bool:
        return all([self.client_id, self.client_secret, self.refresh_token])

    def refresh_access_token(self) -> bool:
        if not self._can_refresh():
            logger.warning("Missing credentials for token refresh (need client_id, client_secret, refresh_token)")
            return False

        try:
            response = requests.post(TOKEN_URL, data={
                "grant_type": "refresh_token",
                "refresh_token": self.refresh_token,
                "client_id": self.client_id,
                "client_secret": self.client_secret,
            })

            if response.status_code != 200:
                logger.error(f"Token refresh failed: {response.status_code} {response.text}")
                return False

            data = response.json()
            self.access_token = data["access_token"]
            expires_in = data.get("expires_in", 5184000)  # Default 60 days
            self.token_expires_at = time.time() + expires_in
            self.headers["Authorization"] = f"Bearer {self.access_token}"

            if data.get("refresh_token"):
                self.refresh_token = data["refresh_token"]

            self._save_tokens_to_env()
            logger.info("LinkedIn access token refreshed successfully")
            return True
        except Exception as e:
            logger.error(f"Token refresh error: {e}")
            return False

    def _save_tokens_to_env(self):
        try:
            env_file = str(env_path)
            set_key(env_file, "LINKEDIN_ACCESS_TOKEN", self.access_token)
            set_key(env_file, "LINKEDIN_TOKEN_EXPIRES_AT", str(int(self.token_expires_at)))
            if self.refresh_token:
                set_key(env_file, "LINKEDIN_REFRESH_TOKEN", self.refresh_token)
        except Exception as e:
            logger.error(f"Failed to save tokens to .env: {e}")

    def ensure_valid_token(self):
        if not self._can_refresh():
            return
        if self.token_expires_at and time.time() >= (self.token_expires_at - REFRESH_BUFFER_SECONDS):
            logger.info("Token expired or near expiry, refreshing...")
            self.refresh_access_token()

    def _request(self, method: str, url: str, **kwargs) -> requests.Response:
        self.ensure_valid_token()
        response = requests.request(method, url, headers=self.headers, **kwargs)
        if response.status_code == 401 and self._can_refresh():
            logger.info("Got 401, attempting token refresh...")
            if self.refresh_access_token():
                response = requests.request(method, url, headers=self.headers, **kwargs)
        return response

    def get_profile(self) -> dict[str, Any]:
        """Gets the authenticated user's LinkedIn profile."""
        try:
            response = self._request("GET", f"{API_BASE_URL}/userinfo")
            if response.status_code == 200:
                data = response.json()
                return {
                    "success": True,
                    "id": data.get("sub"),
                    "name": data.get("name"),
                    "email": data.get("email")
                }
            return {"success": False, "error": response.text}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_organization_acls(self) -> dict[str, Any]:
        """Lists organizations the authenticated user is an admin of."""
        try:
            response = self._request(
                "GET",
                f"{API_BASE_URL}/organizationalEntityAcls?q=roleAssignee&role=ADMINISTRATOR&projection=(elements*(organizationalTarget~(localizedName,vanityName,id)))"
            )
            if response.status_code == 200:
                data = response.json()
                orgs = []
                for element in data.get("elements", []):
                    org_urn = element.get("organizationalTarget", "")
                    org_info = element.get("organizationalTarget~", {})
                    org_id = org_urn.split(":")[-1] if org_urn else None
                    orgs.append({
                        "organization_id": org_id,
                        "urn": org_urn,
                        "name": org_info.get("localizedName", ""),
                        "vanity_name": org_info.get("vanityName", ""),
                    })
                return {"success": True, "organizations": orgs}
            return {"success": False, "error": response.text, "status": response.status_code}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _get_author(self, organization_id: str | None = None) -> str:
        """Returns the author URN - organization if org_id provided, else person."""
        if organization_id:
            return f"urn:li:organization:{organization_id}"
        return PERSON_URN

    def post_text(self, text: str, organization_id: str | None = None) -> dict[str, Any]:
        """Posts a text update to LinkedIn."""
        try:
            post_data = {
                "author": self._get_author(organization_id),
                "lifecycleState": "PUBLISHED",
                "specificContent": {
                    "com.linkedin.ugc.ShareContent": {
                        "shareCommentary": {
                            "text": text
                        },
                        "shareMediaCategory": "NONE"
                    }
                },
                "visibility": {
                    "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
                }
            }

            response = self._request("POST", f"{API_BASE_URL}/ugcPosts", json=post_data)

            if response.status_code in [200, 201]:
                return {
                    "success": True,
                    "post_id": response.headers.get("x-restli-id", "created"),
                    "text": text
                }
            return {"success": False, "error": response.text, "status": response.status_code}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def post_with_link(self, text: str, url: str, title: str = "", description: str = "", organization_id: str | None = None) -> dict[str, Any]:
        """Posts an update with a link to LinkedIn."""
        try:
            post_data = {
                "author": self._get_author(organization_id),
                "lifecycleState": "PUBLISHED",
                "specificContent": {
                    "com.linkedin.ugc.ShareContent": {
                        "shareCommentary": {
                            "text": text
                        },
                        "shareMediaCategory": "ARTICLE",
                        "media": [
                            {
                                "status": "READY",
                                "originalUrl": url,
                                "title": {
                                    "text": title
                                },
                                "description": {
                                    "text": description
                                }
                            }
                        ]
                    }
                },
                "visibility": {
                    "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
                }
            }

            response = self._request("POST", f"{API_BASE_URL}/ugcPosts", json=post_data)

            if response.status_code in [200, 201]:
                return {
                    "success": True,
                    "post_id": response.headers.get("x-restli-id", "created"),
                    "text": text,
                    "url": url
                }
            return {"success": False, "error": response.text, "status": response.status_code}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def delete_post(self, post_urn: str) -> dict[str, Any]:
        """Deletes a LinkedIn post."""
        try:
            response = self._request("DELETE", f"{API_BASE_URL}/ugcPosts/{post_urn}")
            if response.status_code in [200, 204]:
                return {"success": True, "deleted": post_urn}
            return {"success": False, "error": response.text}
        except Exception as e:
            return {"success": False, "error": str(e)}


async def run_server():
    logger.info("Starting LinkedIn MCP Server")

    linkedin = LinkedInManager()
    server = Server("linkedin-manager")

    @server.list_tools()
    async def handle_list_tools() -> list[types.Tool]:
        return [
            types.Tool(
                name="post_to_linkedin",
                description="Posts a text update to LinkedIn. Optionally post as an organization page.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "text": {"type": "string", "description": "Post text content"},
                        "organization_id": {"type": "string", "description": "Organization/company page ID to post as (optional, defaults to personal profile)"},
                    },
                    "required": ["text"],
                },
            ),
            types.Tool(
                name="post_with_link",
                description="Posts an update with a link to LinkedIn. Optionally post as an organization page.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "text": {"type": "string", "description": "Post text content"},
                        "url": {"type": "string", "description": "URL to share"},
                        "title": {"type": "string", "description": "Link title (optional)"},
                        "description": {"type": "string", "description": "Link description (optional)"},
                        "organization_id": {"type": "string", "description": "Organization/company page ID to post as (optional, defaults to personal profile)"},
                    },
                    "required": ["text", "url"],
                },
            ),
            types.Tool(
                name="delete_post",
                description="Deletes a LinkedIn post by URN",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "post_urn": {"type": "string", "description": "URN of post to delete"},
                    },
                    "required": ["post_urn"],
                },
            ),
            types.Tool(
                name="get_profile",
                description="Gets the authenticated LinkedIn user's profile",
                inputSchema={"type": "object", "properties": {}},
            ),
            types.Tool(
                name="get_organizations",
                description="Lists LinkedIn organizations/company pages the authenticated user is an admin of. Use this to find organization_id for posting as a company page.",
                inputSchema={"type": "object", "properties": {}},
            ),
        ]

    @server.call_tool()
    async def handle_call_tool(name: str, arguments: dict[str, Any] | None) -> list[types.TextContent]:
        try:
            if name == "post_to_linkedin":
                result = linkedin.post_text(arguments["text"], arguments.get("organization_id"))
            elif name == "post_with_link":
                result = linkedin.post_with_link(
                    arguments["text"],
                    arguments["url"],
                    arguments.get("title", ""),
                    arguments.get("description", ""),
                    arguments.get("organization_id")
                )
            elif name == "delete_post":
                result = linkedin.delete_post(arguments["post_urn"])
            elif name == "get_profile":
                result = linkedin.get_profile()
            elif name == "get_organizations":
                result = linkedin.get_organization_acls()
            else:
                raise ValueError(f"Unknown tool: {name}")

            return [types.TextContent(type="text", text=str(result))]
        except Exception as e:
            return [types.TextContent(type="text", text=f"Error: {str(e)}")]

    async with mcp.server.stdio.stdio_server() as (read_stream, write_stream):
        logger.info("Server running with stdio transport")
        await server.run(
            read_stream,
            write_stream,
            InitializationOptions(
                server_name="linkedin",
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
