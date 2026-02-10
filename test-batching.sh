#!/bin/bash

# Start listening to events in background
(curl -N http://localhost:4445/events/subscribe 2>/dev/null | head -20) &
CURL_PID=$!

# Wait for connection
sleep 1

# Send 3 messages quickly (within 500ms window)
curl -s -X POST http://localhost:4445/chat/messages \
  -H "Content-Type: application/json" \
  -d '{"from": "batch-test-1", "content": "Message 1"}' > /dev/null

curl -s -X POST http://localhost:4445/chat/messages \
  -H "Content-Type: application/json" \
  -d '{"from": "batch-test-2", "content": "Message 2"}' > /dev/null

curl -s -X POST http://localhost:4445/chat/messages \
  -H "Content-Type: application/json" \
  -d '{"from": "batch-test-3", "content": "Message 3"}' > /dev/null

echo "Sent 3 messages quickly..."

# Wait for batch to be sent (500ms window + processing time)
sleep 2

# Kill the curl listener
kill $CURL_PID 2>/dev/null

echo "Done!"
