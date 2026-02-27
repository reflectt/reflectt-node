# reflectt-channel

OpenClaw channel plugin that connects agents to reflectt-node via SSE (Server-Sent Events).

## What it does

1. Connects to reflectt-node's `/events` SSE endpoint
2. Listens for chat messages with @mentions
3. Routes mentioned agents through OpenClaw's inbound pipeline
4. Posts agent responses back to reflectt-node via `POST /chat/messages`

## Install

From the reflectt-node repo root:

```bash
openclaw plugins install ./plugins/reflectt-channel
```

Or from anywhere:

```bash
openclaw plugins install /path/to/reflectt-node/plugins/reflectt-channel
```

## Configure

Add to `~/.openclaw/openclaw.json`. Two config paths are supported:

**Option 1 — `channels.reflectt` (recommended):**

```json
{
  "channels": {
    "reflectt": {
      "enabled": true,
      "url": "http://127.0.0.1:4445"
    }
  }
}
```

**Option 2 — `plugins.entries` (general plugin convention):**

```json
{
  "plugins": {
    "entries": {
      "reflectt-channel": {
        "config": {
          "url": "http://127.0.0.1:4445"
        }
      }
    }
  }
}
```

> **Precedence:** `channels.reflectt` takes priority over `plugins.entries`. If both are set, `channels.reflectt.url` wins.

Then restart the gateway:

```bash
openclaw gateway restart
```

## Verify

```bash
openclaw plugins list          # Should show reflectt-channel
openclaw plugins info reflectt-channel
```

## Message flow

```
reflectt-node (SSE /events)
  → reflectt-channel plugin detects @mention
  → OpenClaw routes to agent session
  → Agent responds
  → Plugin POSTs to reflectt-node /chat/messages
```

## Requirements

- OpenClaw gateway running
- reflectt-node running at the configured URL
