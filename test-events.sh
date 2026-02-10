#!/bin/bash
# Test script for SSE Event Bus

echo "=== Testing SSE Event Bus ==="
echo ""

# Test 1: Check status (should show 0 connections)
echo "1. Checking initial status..."
curl -s http://127.0.0.1:4445/events/status | jq -r '"Connected clients: \(.connected)"'
echo ""

# Test 2: Subscribe to events in background
echo "2. Opening SSE connection..."
curl -N 'http://127.0.0.1:4445/events/subscribe?agent=test' > /tmp/sse-events.log 2>&1 &
SSE_PID=$!
sleep 2

# Test 3: Check status again (should show 1 connection)
echo "3. Checking status with active connection..."
curl -s http://127.0.0.1:4445/events/status | jq -r '"Connected clients: \(.connected)"'
echo ""

# Test 4: Post a message
echo "4. Posting a test message..."
curl -s -X POST http://127.0.0.1:4445/chat/messages \
  -H 'Content-Type: application/json' \
  -d '{"from":"test-script","content":"Event bus test message"}' | jq -r '.message.id'
sleep 1

# Test 5: Create a task
echo "5. Creating a test task..."
curl -s -X POST http://127.0.0.1:4445/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Event bus test task","createdBy":"test-script","priority":"P2"}' | jq -r '.task.id'
sleep 1

# Test 6: Show received events
echo ""
echo "6. Events received via SSE:"
echo "---"
grep -E "^(event|data):" /tmp/sse-events.log | tail -20
echo "---"

# Cleanup
kill $SSE_PID 2>/dev/null
rm -f /tmp/sse-events.log

echo ""
echo "✅ SSE Event Bus test complete!"
