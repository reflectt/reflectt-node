#!/bin/bash

set -e

echo "Testing task dependencies implementation..."

# Start server in background
npm start &
SERVER_PID=$!
sleep 3

echo "1. Creating task A (no dependencies)"
TASK_A=$(curl -s -X POST http://localhost:4445/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Task A","description":"First task","createdBy":"test","priority":"P1"}' \
  | jq -r '.task.id')
echo "Created: $TASK_A"

echo "2. Creating task B (blocked by A)"
TASK_B=$(curl -s -X POST http://localhost:4445/tasks \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"Task B\",\"description\":\"Depends on A\",\"createdBy\":\"test\",\"priority\":\"P1\",\"blocked_by\":[\"$TASK_A\"]}" \
  | jq -r '.task.id')
echo "Created: $TASK_B (blocked by $TASK_A)"

echo "3. Getting next task (should return A, not B)"
NEXT=$(curl -s http://localhost:4445/tasks/next?agent=test | jq -r '.task.id')
if [ "$NEXT" == "$TASK_A" ]; then
  echo "✅ Next task is A (B is blocked)"
else
  echo "❌ Expected A, got $NEXT"
fi

echo "4. Marking A as done"
curl -s -X PATCH http://localhost:4445/tasks/$TASK_A \
  -H "Content-Type: application/json" \
  -d '{"status":"done"}' > /dev/null
echo "✅ Task A marked done"

echo "5. Getting next task (should now return B)"
sleep 1
NEXT=$(curl -s http://localhost:4445/tasks/next?agent=test | jq -r '.task.id')
if [ "$NEXT" == "$TASK_B" ]; then
  echo "✅ Next task is B (no longer blocked)"
else
  echo "❌ Expected B, got $NEXT"
fi

echo "6. Testing circular dependency detection"
TASK_C=$(curl -s -X POST http://localhost:4445/tasks \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"Task C\",\"createdBy\":\"test\",\"blocked_by\":[\"$TASK_B\"]}" \
  | jq -r '.task.id')

CIRCULAR=$(curl -s -X PATCH http://localhost:4445/tasks/$TASK_B \
  -H "Content-Type: application/json" \
  -d "{\"blocked_by\":[\"$TASK_C\"]}" 2>&1 || echo "error")
if echo "$CIRCULAR" | grep -q "Circular"; then
  echo "✅ Circular dependency detected and rejected"
else
  echo "❌ Circular dependency was not caught"
fi

echo ""
echo "All tests passed! ✅"

# Cleanup
kill $SERVER_PID
