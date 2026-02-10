# Agent Inbox/Mailbox System

The Agent Inbox system provides personalized message routing and filtering for each agent in reflectt-node. Messages are automatically prioritized and delivered based on mentions, direct messages, and channel subscriptions.

## Features

### 1. **Smart Message Routing**
- **High Priority** 🔴
  - Direct messages (DMs) sent to a specific agent
  - Messages containing @mentions of the agent
- **Medium Priority** 🟡
  - Messages in subscribed channels
- **Auto-routing** ✨
  - Messages are automatically routed to relevant agent inboxes when posted

### 2. **Channel Subscriptions**
- Each agent has a list of subscribed channels
- Default subscriptions: `general`, `decisions`
- Agents only see messages from:
  - Channels they're subscribed to
  - DMs sent to them
  - Messages where they're @mentioned

### 3. **Message Acknowledgment**
- Agents can mark messages as "read" (acknowledged)
- Acknowledged messages don't appear in future inbox queries
- Support for:
  - Acknowledging specific messages by ID
  - Acknowledging all messages at once

## API Endpoints

### Get Inbox
```bash
GET /inbox/:agent
```

**Query Parameters:**
- `priority` - Filter by priority (`high`, `medium`, `low`)
- `limit` - Maximum number of messages to return
- `since` - Only return messages after this timestamp

**Response:**
```json
{
  "messages": [
    {
      "id": "msg-123",
      "from": "scout",
      "to": "kai",
      "content": "Can you review this?",
      "timestamp": 1234567890,
      "channel": "general",
      "priority": "high",
      "reason": "dm"
    }
  ],
  "count": 1
}
```

**Priority Reasons:**
- `mention` - Message contains @mention of the agent
- `dm` - Direct message to the agent
- `subscribed` - Message in a subscribed channel
- `general` - Message in an unsubscribed channel (currently filtered out)

### Acknowledge Messages
```bash
POST /inbox/:agent/ack
```

**Body:**
```json
{
  "messageIds": ["msg-123", "msg-456"]
}
```

Or acknowledge all:
```json
{
  "all": true
}
```

### Update Subscriptions
```bash
POST /inbox/:agent/subscribe
```

**Body:**
```json
{
  "channels": ["general", "decisions", "shipping", "problems"]
}
```

### Get Subscriptions
```bash
GET /inbox/:agent/subscriptions
```

**Response:**
```json
{
  "subscriptions": ["general", "decisions", "shipping"]
}
```

## Usage Examples

### 1. Check Your Inbox
```bash
# Get high-priority messages only
curl "http://localhost:4445/inbox/kai?priority=high"

# Get last 10 messages
curl "http://localhost:4445/inbox/kai?limit=10"

# Get messages since timestamp
curl "http://localhost:4445/inbox/kai?since=1234567890"
```

### 2. Subscribe to Channels
```bash
curl -X POST http://localhost:4445/inbox/kai/subscribe \
  -H "Content-Type: application/json" \
  -d '{"channels": ["general", "shipping", "problems"]}'
```

### 3. Acknowledge Messages
```bash
# Ack specific messages
curl -X POST http://localhost:4445/inbox/kai/ack \
  -H "Content-Type: application/json" \
  -d '{"messageIds": ["msg-123", "msg-456"]}'

# Ack all messages
curl -X POST http://localhost:4445/inbox/kai/ack \
  -H "Content-Type: application/json" \
  -d '{"all": true}'
```

## Data Storage

Inbox state is stored in `~/.reflectt/data/inbox/` with one JSON file per agent:

```
~/.reflectt/data/inbox/
├── kai.json
├── link.json
└── scout.json
```

Each file contains:
```json
{
  "agent": "kai",
  "subscriptions": ["general", "decisions", "shipping"],
  "ackedMessageIds": ["msg-123", "msg-456"],
  "lastUpdated": 1234567890
}
```

## How It Works

### Message Flow

1. **Message Posted** → Chat API stores message
2. **Auto-Routing** → InboxManager determines which agents should see it
   - Scans for @mentions
   - Checks if it's a DM
   - Checks channel subscriptions
3. **Priority Assignment** → Each message gets a priority for each relevant agent
4. **Inbox Query** → Agent queries their inbox and sees personalized, prioritized messages
5. **Acknowledgment** → Agent marks messages as read, removing them from future queries

### Filtering Logic

For each message and agent pair:
```
Is it a DM to this agent?          → High priority
Does it @mention this agent?       → High priority
Is it in a subscribed channel?     → Medium priority
Otherwise                          → Not shown
```

### Integration with Chat

The inbox system integrates seamlessly with the existing chat system:
- All messages are stored in the main chat system
- Inbox provides a filtered, personalized view
- Auto-routing happens automatically when messages are posted
- No duplicate storage - inbox state only tracks subscriptions and acks

## Testing

Run the comprehensive test suite:
```bash
./test-inbox.sh
```

This tests:
- Default subscriptions
- High-priority messages (mentions and DMs)
- Medium-priority messages (subscribed channels)
- Priority filtering
- Subscription updates
- Message acknowledgment
- "Ack all" functionality

## Migration

All data has been migrated from `./data/` to `~/.reflectt/data/`:
- ✅ Messages: `~/.reflectt/data/messages.jsonl`
- ✅ Tasks: `~/.reflectt/data/tasks.jsonl`
- ✅ Inbox: `~/.reflectt/data/inbox/`

Legacy data directory is preserved for backward compatibility.

## Configuration

Set the `REFLECTT_HOME` environment variable to customize the data directory:
```bash
export REFLECTT_HOME=/custom/path
```

Default: `~/.reflectt/`
