import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from central claude-setup directory
env_path = Path(__file__).parent.parent.parent / ".env"
load_dotenv(env_path)

# Facebook Graph API setup
GRAPH_API_VERSION = "v22.0"
PAGE_ACCESS_TOKEN = os.getenv("FACEBOOK_PAGE_ACCESS_TOKEN") or os.getenv("FACEBOOK_ACCESS_TOKEN") or os.getenv("FACEBOOK_PAGE_TOKEN")
PAGE_ID = os.getenv("FACEBOOK_PAGE_ID")
GRAPH_API_BASE_URL = f"https://graph.facebook.com/{GRAPH_API_VERSION}"
