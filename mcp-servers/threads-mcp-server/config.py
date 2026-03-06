import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from central claude-setup directory
env_path = Path(__file__).parent.parent.parent / ".env"
load_dotenv(env_path)

# Threads API setup (uses graph.threads.net)
THREADS_API_VERSION = "v1.0"
THREADS_ACCESS_TOKEN = os.getenv("THREADS_ACCESS_TOKEN") or os.getenv("THREADS_TOKEN")
THREADS_USER_ID = os.getenv("THREADS_USER_ID")
THREADS_API_BASE_URL = f"https://graph.threads.net/{THREADS_API_VERSION}"
