#!/usr/bin/env python3
"""
LinkedIn OAuth Setup Script

Obtains initial access + refresh tokens via browser OAuth flow.
Saves credentials to claude-setup/.env

Usage:
    1. Create a LinkedIn app at https://www.linkedin.com/developers/apps
    2. Set redirect URI to http://localhost:8585/callback
    3. Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in .env (or pass as args)
    4. Run: python scripts/oauth-setup.py
    5. Browser opens, authorize the app
    6. Tokens are saved to .env automatically
"""

import http.server
import os
import sys
import time
import urllib.parse
import webbrowser
from pathlib import Path
from threading import Event

import requests
from dotenv import load_dotenv, set_key

REDIRECT_PORT = 8585
REDIRECT_URI = f"http://localhost:{REDIRECT_PORT}/callback"
SCOPES = "openid profile email w_member_social"

env_path = Path(__file__).parent.parent.parent.parent / ".env"
load_dotenv(env_path)

CLIENT_ID = os.environ.get("LINKEDIN_CLIENT_ID")
CLIENT_SECRET = os.environ.get("LINKEDIN_CLIENT_SECRET")

auth_code_received = Event()
auth_code = None


class OAuthCallbackHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        global auth_code
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)

        if "code" in params:
            auth_code = params["code"][0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"<h1>Authorization successful!</h1><p>You can close this tab.</p>")
            auth_code_received.set()
        elif "error" in params:
            error = params.get("error_description", params["error"])[0]
            self.send_response(400)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(f"<h1>Authorization failed</h1><p>{error}</p>".encode())
            auth_code_received.set()
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass


def main():
    if not CLIENT_ID or not CLIENT_SECRET:
        print("Error: LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET must be set in .env")
        print(f"  .env path: {env_path}")
        sys.exit(1)

    auth_url = (
        "https://www.linkedin.com/oauth/v2/authorization?"
        + urllib.parse.urlencode({
            "response_type": "code",
            "client_id": CLIENT_ID,
            "redirect_uri": REDIRECT_URI,
            "scope": SCOPES,
        })
    )

    server = http.server.HTTPServer(("localhost", REDIRECT_PORT), OAuthCallbackHandler)
    server.timeout = 120

    print(f"Opening browser for LinkedIn authorization...")
    print(f"If browser doesn't open, visit:\n{auth_url}\n")
    webbrowser.open(auth_url)

    print("Waiting for authorization callback...")
    while not auth_code_received.is_set():
        server.handle_request()

    server.server_close()

    if not auth_code:
        print("Authorization failed - no code received")
        sys.exit(1)

    print("Exchanging auth code for tokens...")
    response = requests.post("https://www.linkedin.com/oauth/v2/accessToken", data={
        "grant_type": "authorization_code",
        "code": auth_code,
        "redirect_uri": REDIRECT_URI,
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
    })

    if response.status_code != 200:
        print(f"Token exchange failed: {response.status_code} {response.text}")
        sys.exit(1)

    data = response.json()
    access_token = data["access_token"]
    refresh_token = data.get("refresh_token", "")
    expires_in = data.get("expires_in", 5184000)
    expires_at = int(time.time() + expires_in)

    env_file = str(env_path)
    set_key(env_file, "LINKEDIN_ACCESS_TOKEN", access_token)
    set_key(env_file, "LINKEDIN_TOKEN_EXPIRES_AT", str(expires_at))
    if refresh_token:
        set_key(env_file, "LINKEDIN_REFRESH_TOKEN", refresh_token)

    print(f"\nTokens saved to {env_path}")
    print(f"  Access token expires: {expires_in // 86400} days")
    if refresh_token:
        print(f"  Refresh token obtained (valid ~365 days)")
    else:
        print(f"  No refresh token received (app may need refresh token enabled)")

    # Fetch profile to confirm
    profile_resp = requests.get("https://api.linkedin.com/v2/userinfo", headers={
        "Authorization": f"Bearer {access_token}"
    })
    if profile_resp.status_code == 200:
        profile = profile_resp.json()
        print(f"\nAuthenticated as: {profile.get('name', 'Unknown')}")
        person_urn = f"urn:li:person:{profile.get('sub', '')}"
        set_key(env_file, "LINKEDIN_PERSON_URN", person_urn)
        print(f"  Person URN saved: {person_urn}")


if __name__ == "__main__":
    main()
