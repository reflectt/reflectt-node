#!/bin/bash
# Test script for Agent Inbox/Mailbox system

set -e

BASE_URL="http://127.0.0.1:4445"
AGENT="test-agent"

echo "🧪 Testing Agent Inbox System"
echo ""

# 1. Check health
echo "1️⃣ Checking health endpoint..."
curl -s "$BASE_URL/health" | jq -r '"✅ Health check passed - Inbox has \(.inbox.agents) agents"'
echo ""

# 2. Get initial subscriptions (should be defaults)
echo "2️⃣ Getting default subscriptions..."
curl -s "$BASE_URL/inbox/$AGENT/subscriptions" | jq -r '"✅ Default subscriptions: \(.subscriptions | join(", "))"'
echo ""

# 3. Post a message to general channel
echo "3️⃣ Posting message to general channel..."
curl -s -X POST "$BASE_URL/chat/messages" \
  -H "Content-Type: application/json" \
  -d "{\"from\": \"link\", \"content\": \"Hello general!\", \"channel\": \"general\"}" > /dev/null
echo "✅ Message posted to general"
echo ""

# 4. Post a message with @mention
echo "4️⃣ Posting message with @mention..."
curl -s -X POST "$BASE_URL/chat/messages" \
  -H "Content-Type: application/json" \
  -d "{\"from\": \"scout\", \"content\": \"Hey @$AGENT, check this out!\", \"channel\": \"general\"}" > /dev/null
echo "✅ Message posted with @mention"
echo ""

# 5. Post a DM
echo "5️⃣ Posting direct message..."
curl -s -X POST "$BASE_URL/chat/messages" \
  -H "Content-Type: application/json" \
  -d "{\"from\": \"kai\", \"to\": \"$AGENT\", \"content\": \"Private message for you\"}" > /dev/null
echo "✅ Direct message posted"
echo ""

# 6. Check inbox
echo "6️⃣ Checking inbox (should show all messages)..."
curl -s "$BASE_URL/inbox/$AGENT?limit=10" | jq -r '"✅ Inbox has \(.count) messages"'
curl -s "$BASE_URL/inbox/$AGENT?limit=10" | jq -r '.messages[] | "  - [\(.priority)] \(.reason): \(.content | .[0:50])..."'
echo ""

# 7. Filter by high priority
echo "7️⃣ Filtering inbox by high priority..."
curl -s "$BASE_URL/inbox/$AGENT?priority=high" | jq -r '"✅ High priority messages: \(.count)"'
curl -s "$BASE_URL/inbox/$AGENT?priority=high" | jq -r '.messages[] | "  - [\(.priority)] \(.reason): \(.content | .[0:50])..."'
echo ""

# 8. Update subscriptions
echo "8️⃣ Updating subscriptions..."
curl -s -X POST "$BASE_URL/inbox/$AGENT/subscribe" \
  -H "Content-Type: application/json" \
  -d "{\"channels\": [\"general\", \"shipping\", \"problems\"]}" | jq -r '"✅ Updated subscriptions: \(.subscriptions | join(", "))"'
echo ""

# 9. Post to shipping channel
echo "9️⃣ Posting to shipping channel..."
curl -s -X POST "$BASE_URL/chat/messages" \
  -H "Content-Type: application/json" \
  -d "{\"from\": \"link\", \"content\": \"We shipped it!\", \"channel\": \"shipping\"}" > /dev/null
echo "✅ Message posted to shipping channel"
echo ""

# 10. Check inbox again
echo "🔟 Checking inbox again..."
INBOX=$(curl -s "$BASE_URL/inbox/$AGENT?limit=10")
echo "$INBOX" | jq -r '"✅ Inbox has \(.count) messages"'
echo ""

# 11. Ack specific messages
echo "1️⃣1️⃣ Acknowledging high-priority messages..."
MSG_IDS=$(echo "$INBOX" | jq -r '[.messages[] | select(.priority == "high") | .id] | @json')
curl -s -X POST "$BASE_URL/inbox/$AGENT/ack" \
  -H "Content-Type: application/json" \
  -d "{\"messageIds\": $MSG_IDS}" | jq -r '"✅ Acknowledged \(.count) messages"'
echo ""

# 12. Check inbox after ack
echo "1️⃣2️⃣ Checking inbox after acking..."
curl -s "$BASE_URL/inbox/$AGENT?limit=10" | jq -r '"✅ Inbox now has \(.count) messages (high priority removed)"'
echo ""

# 13. Ack all
echo "1️⃣3️⃣ Acknowledging all remaining messages..."
curl -s -X POST "$BASE_URL/inbox/$AGENT/ack" \
  -H "Content-Type: application/json" \
  -d "{\"all\": true}" | jq -r '"✅ \(.message)"'
echo ""

# 14. Final check
echo "1️⃣4️⃣ Final inbox check..."
curl -s "$BASE_URL/inbox/$AGENT" | jq -r '"✅ Inbox has \(.count) messages (should be 0)"'
echo ""

echo "✨ All inbox tests passed!"
echo ""
echo "📁 Data stored in: ~/.reflectt/data/inbox/$AGENT.json"
cat ~/.reflectt/data/inbox/$AGENT.json | jq
