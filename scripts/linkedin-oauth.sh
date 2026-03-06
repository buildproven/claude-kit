#!/bin/bash
# LinkedIn OAuth Token Exchange Script

set -euo pipefail

# Load credentials
CREDS_FILE="$HOME/.claude/social-credentials.env"
if [[ ! -f "$CREDS_FILE" ]]; then
    echo "❌ No social credentials file found. Run setup first:"
    echo "   ./scripts/setup-social-autoposting.sh"
    exit 1
fi

source "$CREDS_FILE"

# Get authorization code from command line
AUTH_CODE="${1:-}"
if [[ -z "$AUTH_CODE" ]]; then
    echo "❌ Authorization code required"
    echo "Usage: $0 <authorization-code>"
    echo ""
    echo "Get authorization code from:"
    echo "https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=$LINKEDIN_CLIENT_ID&redirect_uri=http://localhost:8080/callback&scope=w_member_social"
    exit 1
fi

echo "🔐 Exchanging LinkedIn authorization code for access token..."

# Exchange authorization code for access token
RESPONSE=$(curl -s -X POST "https://www.linkedin.com/oauth/v2/accessToken" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=authorization_code" \
    -d "code=$AUTH_CODE" \
    -d "redirect_uri=http://localhost:8080/callback" \
    -d "client_id=$LINKEDIN_CLIENT_ID" \
    -d "client_secret=$LINKEDIN_CLIENT_SECRET")

# Check if we got an access token
if echo "$RESPONSE" | jq -e '.access_token' > /dev/null; then
    ACCESS_TOKEN=$(echo "$RESPONSE" | jq -r '.access_token')
    echo "✅ LinkedIn access token obtained!"

    # Update credentials file
    if grep -q "LINKEDIN_ACCESS_TOKEN=" "$CREDS_FILE"; then
        # Update existing line
        sed -i.bak "s/export LINKEDIN_ACCESS_TOKEN=.*/export LINKEDIN_ACCESS_TOKEN=\"$ACCESS_TOKEN\"/" "$CREDS_FILE"
    else
        # Add new line
        echo "export LINKEDIN_ACCESS_TOKEN=\"$ACCESS_TOKEN\"" >> "$CREDS_FILE"
    fi

    echo "💾 Access token saved to $CREDS_FILE"

    # Test the token
    echo "🧪 Testing LinkedIn API access..."
    TEST_RESPONSE=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
        "https://api.linkedin.com/v2/people/~")

    if echo "$TEST_RESPONSE" | jq -e '.id' > /dev/null; then
        echo "✅ LinkedIn API test successful!"
        echo "🎉 LinkedIn auto-posting is now enabled!"
        echo ""
        echo "You can now use:"
        echo "  /socials --auto-post linkedin"
        echo "  /socials --auto-post facebook,linkedin"
    else
        echo "❌ LinkedIn API test failed:"
        echo "$TEST_RESPONSE"
    fi

else
    echo "❌ Failed to get LinkedIn access token:"
    echo "$RESPONSE"
    exit 1
fi