#!/usr/bin/env python3
"""Standalone LinkedIn posting CLI for AI agents and scripts.

Usage:
  linkedin-post.py text "Post content here"
  linkedin-post.py link "Post content" --url https://example.com --title "Title"
  linkedin-post.py image "Post content" --image /path/to/image.jpg --alt "Alt text"
  linkedin-post.py images "Post content" --images /path/1.jpg /path/2.jpg
  linkedin-post.py carousel "Post content" --document /path/to/slides.pdf --title "Carousel Title"

Environment variables required:
  LINKEDIN_ACCESS_TOKEN, LINKEDIN_PERSON_URN

Optional (for auto-refresh):
  LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, LINKEDIN_REFRESH_TOKEN, LINKEDIN_TOKEN_EXPIRES_AT
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import requests

API_BASE_URL = "https://api.linkedin.com/v2"
REST_API_URL = "https://api.linkedin.com/rest"
LINKEDIN_VERSION = "202503"
TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken"
REFRESH_BUFFER_SECONDS = 86400


class LinkedInClient:
    def __init__(self):
        self.access_token = os.environ.get("LINKEDIN_ACCESS_TOKEN")
        self.person_urn = os.environ.get("LINKEDIN_PERSON_URN")
        self.client_id = os.environ.get("LINKEDIN_CLIENT_ID")
        self.client_secret = os.environ.get("LINKEDIN_CLIENT_SECRET")
        self.refresh_token = os.environ.get("LINKEDIN_REFRESH_TOKEN")
        expires = os.environ.get("LINKEDIN_TOKEN_EXPIRES_AT")
        self.token_expires_at = float(expires) if expires else None

        if not self.access_token or not self.person_urn:
            print("Error: LINKEDIN_ACCESS_TOKEN and LINKEDIN_PERSON_URN required", file=sys.stderr)
            sys.exit(1)

    def _can_refresh(self):
        return all([self.client_id, self.client_secret, self.refresh_token])

    def _refresh_token(self):
        if not self._can_refresh():
            return False
        resp = requests.post(TOKEN_URL, data={
            "grant_type": "refresh_token",
            "refresh_token": self.refresh_token,
            "client_id": self.client_id,
            "client_secret": self.client_secret,
        })
        if resp.status_code != 200:
            print(f"Token refresh failed: {resp.status_code} {resp.text}", file=sys.stderr)
            return False
        data = resp.json()
        self.access_token = data["access_token"]
        self.token_expires_at = time.time() + data.get("expires_in", 5184000)
        if data.get("refresh_token"):
            self.refresh_token = data["refresh_token"]
        return True

    def _ensure_token(self):
        if not self._can_refresh():
            return
        if self.token_expires_at and time.time() >= (self.token_expires_at - REFRESH_BUFFER_SECONDS):
            self._refresh_token()

    def _v2_headers(self):
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
            "X-Restli-Protocol-Version": "2.0.0",
        }

    def _rest_headers(self):
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
            "LinkedIn-Version": LINKEDIN_VERSION,
            "X-Restli-Protocol-Version": "2.0.0",
        }

    def _request(self, method, url, headers, **kwargs):
        self._ensure_token()
        headers["Authorization"] = f"Bearer {self.access_token}"
        resp = requests.request(method, url, headers=headers, **kwargs)
        if resp.status_code == 401 and self._can_refresh():
            if self._refresh_token():
                headers["Authorization"] = f"Bearer {self.access_token}"
                resp = requests.request(method, url, headers=headers, **kwargs)
        return resp

    def _get_author(self, org_id=None):
        return f"urn:li:organization:{org_id}" if org_id else self.person_urn

    # --- Legacy v2 posts (text, link) ---

    def post_text(self, text, org_id=None):
        data = {
            "author": self._get_author(org_id),
            "lifecycleState": "PUBLISHED",
            "specificContent": {
                "com.linkedin.ugc.ShareContent": {
                    "shareCommentary": {"text": text},
                    "shareMediaCategory": "NONE",
                }
            },
            "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
        }
        resp = self._request("POST", f"{API_BASE_URL}/ugcPosts", self._v2_headers(), json=data)
        return self._handle_response(resp)

    def post_link(self, text, url, title="", description="", org_id=None):
        data = {
            "author": self._get_author(org_id),
            "lifecycleState": "PUBLISHED",
            "specificContent": {
                "com.linkedin.ugc.ShareContent": {
                    "shareCommentary": {"text": text},
                    "shareMediaCategory": "ARTICLE",
                    "media": [{
                        "status": "READY",
                        "originalUrl": url,
                        "title": {"text": title},
                        "description": {"text": description},
                    }],
                }
            },
            "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
        }
        resp = self._request("POST", f"{API_BASE_URL}/ugcPosts", self._v2_headers(), json=data)
        return self._handle_response(resp)

    # --- REST API posts (image, multi-image, carousel) ---

    def _upload_image(self, image_path, owner):
        resp = self._request(
            "POST",
            f"{REST_API_URL}/images?action=initializeUpload",
            self._rest_headers(),
            json={"initializeUploadRequest": {"owner": owner}},
        )
        if resp.status_code not in [200, 201]:
            return None, f"Image init failed: {resp.status_code} {resp.text}"

        value = resp.json().get("value", {})
        upload_url = value.get("uploadUrl")
        image_urn = value.get("image")
        if not upload_url or not image_urn:
            return None, f"Missing upload URL or image URN: {value}"

        self._ensure_token()
        with open(image_path, "rb") as f:
            up_resp = requests.put(upload_url, data=f, headers={
                "Authorization": f"Bearer {self.access_token}",
                "Content-Type": "application/octet-stream",
            })
        if up_resp.status_code not in [200, 201]:
            return None, f"Image upload failed: {up_resp.status_code} {up_resp.text}"

        return image_urn, None

    def _upload_document(self, doc_path, owner):
        resp = self._request(
            "POST",
            f"{REST_API_URL}/documents?action=initializeUpload",
            self._rest_headers(),
            json={"initializeUploadRequest": {"owner": owner}},
        )
        if resp.status_code not in [200, 201]:
            return None, f"Document init failed: {resp.status_code} {resp.text}"

        value = resp.json().get("value", {})
        upload_url = value.get("uploadUrl")
        doc_urn = value.get("document")
        if not upload_url or not doc_urn:
            return None, f"Missing upload URL or document URN: {value}"

        self._ensure_token()
        with open(doc_path, "rb") as f:
            up_resp = requests.put(upload_url, data=f, headers={
                "Authorization": f"Bearer {self.access_token}",
                "Content-Type": "application/octet-stream",
            })
        if up_resp.status_code not in [200, 201]:
            return None, f"Document upload failed: {up_resp.status_code} {up_resp.text}"

        return doc_urn, None

    def _create_rest_post(self, text, content, owner):
        data = {
            "author": owner,
            "commentary": text,
            "visibility": "PUBLIC",
            "distribution": {
                "feedDistribution": "MAIN_FEED",
                "targetEntities": [],
                "thirdPartyDistributionChannels": [],
            },
            "lifecycleState": "PUBLISHED",
            "isReshareDisabledByAuthor": False,
            "content": content,
        }
        resp = self._request("POST", f"{REST_API_URL}/posts", self._rest_headers(), json=data)
        return self._handle_response(resp)

    def post_image(self, text, image_path, alt_text="", org_id=None):
        owner = self._get_author(org_id)
        image_urn, err = self._upload_image(image_path, owner)
        if err:
            return {"success": False, "error": err}

        content = {"media": {"title": Path(image_path).stem, "id": image_urn}}
        if alt_text:
            content["media"]["altText"] = alt_text
        return self._create_rest_post(text, content, owner)

    def post_images(self, text, image_paths, alt_texts=None, org_id=None):
        owner = self._get_author(org_id)
        images = []
        for i, path in enumerate(image_paths):
            urn, err = self._upload_image(path, owner)
            if err:
                return {"success": False, "error": f"Failed {path}: {err}"}
            img = {"id": urn}
            if alt_texts and i < len(alt_texts):
                img["altText"] = alt_texts[i]
            images.append(img)

        content = {"multiImage": {"images": images}}
        return self._create_rest_post(text, content, owner)

    def post_carousel(self, text, doc_path, title="", org_id=None):
        owner = self._get_author(org_id)
        doc_urn, err = self._upload_document(doc_path, owner)
        if err:
            return {"success": False, "error": err}

        content = {"media": {"title": title or Path(doc_path).stem, "id": doc_urn}}
        return self._create_rest_post(text, content, owner)

    def _handle_response(self, resp):
        if resp.status_code in [200, 201]:
            post_id = resp.headers.get("x-restli-id", "created")
            return {"success": True, "post_id": post_id}
        return {"success": False, "error": resp.text, "status": resp.status_code}


def main():
    parser = argparse.ArgumentParser(description="Post to LinkedIn")
    sub = parser.add_subparsers(dest="command", required=True)

    # text
    p_text = sub.add_parser("text", help="Post text update")
    p_text.add_argument("content", help="Post text")
    p_text.add_argument("--org", help="Organization ID")

    # link
    p_link = sub.add_parser("link", help="Post with link")
    p_link.add_argument("content", help="Post text")
    p_link.add_argument("--url", required=True)
    p_link.add_argument("--title", default="")
    p_link.add_argument("--description", default="")
    p_link.add_argument("--org", help="Organization ID")

    # image
    p_img = sub.add_parser("image", help="Post with single image")
    p_img.add_argument("content", help="Post text")
    p_img.add_argument("--image", required=True, help="Path to image file")
    p_img.add_argument("--alt", default="", help="Alt text")
    p_img.add_argument("--org", help="Organization ID")

    # images
    p_imgs = sub.add_parser("images", help="Post with multiple images")
    p_imgs.add_argument("content", help="Post text")
    p_imgs.add_argument("--images", nargs="+", required=True, help="Paths to image files")
    p_imgs.add_argument("--alts", nargs="*", help="Alt texts")
    p_imgs.add_argument("--org", help="Organization ID")

    # carousel
    p_car = sub.add_parser("carousel", help="Post carousel (PDF)")
    p_car.add_argument("content", help="Post text")
    p_car.add_argument("--document", required=True, help="Path to PDF")
    p_car.add_argument("--title", default="", help="Carousel title")
    p_car.add_argument("--org", help="Organization ID")

    args = parser.parse_args()
    client = LinkedInClient()

    if args.command == "text":
        result = client.post_text(args.content, args.org)
    elif args.command == "link":
        result = client.post_link(args.content, args.url, args.title, args.description, args.org)
    elif args.command == "image":
        result = client.post_image(args.content, args.image, args.alt, args.org)
    elif args.command == "images":
        result = client.post_images(args.content, args.images, args.alts, args.org)
    elif args.command == "carousel":
        result = client.post_carousel(args.content, args.document, args.title, args.org)

    print(json.dumps(result, indent=2))
    sys.exit(0 if result.get("success") else 1)


if __name__ == "__main__":
    main()
