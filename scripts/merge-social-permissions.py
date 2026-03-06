#!/usr/bin/env python3
"""
Merge social media permissions into Claude Code settings.json
Non-destructive: Only adds missing social permissions, preserves existing config
"""

import json
import os
import sys
from pathlib import Path

def load_json_safe(file_path):
    """Load JSON file safely, return empty dict if file doesn't exist or is invalid"""
    try:
        with open(file_path, 'r') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def save_json_pretty(file_path, data):
    """Save JSON with pretty formatting"""
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    with open(file_path, 'w') as f:
        json.dump(data, f, indent=2)

def merge_social_permissions():
    """Merge social media permissions into existing Claude settings"""

    # Paths
    settings_path = os.path.expanduser("~/.claude/settings.json")
    social_permissions_path = os.path.expanduser("~/Projects/my-claude-setup/config/social-permissions.json")

    # Load existing settings
    settings = load_json_safe(settings_path)

    # Load social permissions
    social_config = load_json_safe(social_permissions_path)
    if not social_config:
        print("❌ Could not load social permissions config")
        return False

    social_perms = social_config.get("social_media_permissions", {})

    # Initialize permissions structure if it doesn't exist
    if "permissions" not in settings:
        settings["permissions"] = {}

    if "allow" not in settings["permissions"]:
        settings["permissions"]["allow"] = []

    # Get permissions to add
    new_bash_perms = social_perms.get("bash_permissions", [])
    new_webfetch_perms = social_perms.get("webfetch_permissions", [])
    new_read_perms = social_perms.get("read_permissions", [])

    all_new_perms = new_bash_perms + new_webfetch_perms + new_read_perms

    # Add missing permissions (avoid duplicates)
    existing_allow = settings["permissions"]["allow"]
    added_count = 0

    for perm in all_new_perms:
        if perm not in existing_allow:
            existing_allow.append(perm)
            added_count += 1

    # Preserve other settings (statusLine, etc.)

    # Save updated settings
    save_json_pretty(settings_path, settings)

    print(f"✅ Added {added_count} social media permissions to Claude settings")
    print(f"📁 Updated: {settings_path}")

    return True

if __name__ == "__main__":
    if merge_social_permissions():
        print("🎉 Social media permissions merged successfully!")
    else:
        print("❌ Failed to merge social media permissions")
        sys.exit(1)