#!/usr/bin/env python3
"""
Twitter OAuth 1.0a Helper
Generates proper OAuth 1.0a authorization header for Twitter API
"""
import os
import sys
import json
import time
import hmac
import hashlib
import base64
import urllib.parse
import secrets

def generate_oauth_header(api_key, api_secret, access_token, access_secret, url, method, params=None):
    """Generate OAuth 1.0a authorization header"""

    # OAuth parameters
    oauth_params = {
        'oauth_consumer_key': api_key,
        'oauth_nonce': secrets.token_hex(16),
        'oauth_signature_method': 'HMAC-SHA1',
        'oauth_timestamp': str(int(time.time())),
        'oauth_token': access_token,
        'oauth_version': '1.0'
    }

    # Combine OAuth params with any additional params
    all_params = oauth_params.copy()
    if params:
        all_params.update(params)

    # Create parameter string (sorted by key)
    param_string = '&'.join([f"{urllib.parse.quote_plus(str(k))}={urllib.parse.quote_plus(str(v))}"
                           for k, v in sorted(all_params.items())])

    # Create signature base string
    signature_base = (f"{method.upper()}&"
                     f"{urllib.parse.quote_plus(url)}&"
                     f"{urllib.parse.quote_plus(param_string)}")

    # Create signing key
    signing_key = f"{urllib.parse.quote_plus(api_secret)}&{urllib.parse.quote_plus(access_secret)}"

    # Generate signature
    signature = base64.b64encode(
        hmac.new(signing_key.encode(), signature_base.encode(), hashlib.sha1).digest()
    ).decode()

    # Create authorization header
    oauth_params['oauth_signature'] = signature
    auth_header = 'OAuth ' + ', '.join([f'{k}="{urllib.parse.quote_plus(str(v))}"'
                                       for k, v in sorted(oauth_params.items())])

    return auth_header

def post_tweet(api_key, api_secret, access_token, access_secret, text):
    """Post a tweet using OAuth 1.0a"""
    import subprocess

    url = "https://api.twitter.com/2/tweets"
    method = "POST"

    # Generate OAuth header
    auth_header = generate_oauth_header(api_key, api_secret, access_token, access_secret, url, method)

    # Create JSON payload
    payload = json.dumps({"text": text})

    # Make the request using curl
    cmd = [
        'curl', '-s', '-X', 'POST', url,
        '-H', f'Authorization: {auth_header}',
        '-H', 'Content-Type: application/json',
        '-d', payload
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        return result.stdout
    except Exception as e:
        return json.dumps({"error": str(e)})

if __name__ == "__main__":
    if len(sys.argv) != 6:
        print("Usage: twitter-oauth-helper.py <api_key> <api_secret> <access_token> <access_secret> <tweet_text>")
        sys.exit(1)

    api_key = sys.argv[1]
    api_secret = sys.argv[2]
    access_token = sys.argv[3]
    access_secret = sys.argv[4]
    tweet_text = sys.argv[5]

    response = post_tweet(api_key, api_secret, access_token, access_secret, tweet_text)
    print(response)