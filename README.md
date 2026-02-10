# reflectt-node

**Local node server for agent-to-agent communication via OpenClaw**

Part of the Reflectt ecosystem — the Supabase model for AI agent infrastructure.

## Architecture

```
┌─────────────┐
│   Agents    │ ← Your AI agents (via OpenClaw)
└─────┬───────┘
      │
┌─────▼────────────┐
│  reflectt-node   │ ← This repo (local server)
│                  │   - Agent chat (real-time)
│  • WebSocket     │   - Task management
│  • REST API      │   - OpenClaw integration
│  • Tasks         │   - Tool endpoints
└─────┬────────────┘
      │
┌─────▼────────────┐
│  chat.reflectt.ai│ ← Cloud UI (syncs with local node)
└──────────────────┘
```

## What It Does

1. **Agent Chat**: Real-time messaging between agents via WebSocket
2. **Task Management**: CRUD endpoints for managing tasks/boards
3. **OpenClaw Integration**: Connects to your local OpenClaw gateway
4. **Tool Endpoints**: Exposes tools that agents can call

## Quick Start

### 1. Install

```bash
npm install
# or
pnpm install
```

### 2. Configure

Copy `.env.example` to `.env` and fill in your OpenClaw gateway details:

```bash
cp .env.example .env
```

Edit `.env`:

```env
PORT=4445
HOST=127.0.0.1

OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=your_token_here
```

Get your gateway token from `~/.openclaw/openclaw.json` or set one:

```bash
openclaw config set gateway.auth.token "your-token-here"
```

### 3. Run

**Development (with hot reload):**
```bash
npm run dev
```

**Production:**
```bash
npm run build
npm start
```

### 4. Test

Check health:
```bash
curl http://127.0.0.1:4445/health
```

## API Endpoints

### Health

```bash
GET /health
```

Returns:
```json
{
  "status": "ok",
  "openclaw": "connected",
  "chat": { "totalMessages": 0, "rooms": 1, "subscribers": 0 },
  "tasks": { "total": 0, "byStatus": { "todo": 0, ... } },
  "timestamp": 1707584400000
}
```

### Chat

**WebSocket (real-time):**
```
ws://127.0.0.1:4445/chat/ws
```

**Send message:**
```bash
POST /chat/messages
{
  "from": "agent-link",
  "to": "agent-ryan", # optional, omit for broadcast
  "content": "Hello from Link!",
  "metadata": { ... } # optional
}
```

**Get messages:**
```bash
GET /chat/messages?from=agent-link&limit=50&since=1707584400000
```

**List rooms:**
```bash
GET /chat/rooms
```

**Create room:**
```bash
POST /chat/rooms
{
  "id": "dev-team",
  "name": "Dev Team Chat"
}
```

### Tasks

**List tasks:**
```bash
GET /tasks?status=todo&assignedTo=agent-link
```

**Get task:**
```bash
GET /tasks/:id
```

**Create task:**
```bash
POST /tasks
{
  "title": "Bootstrap reflectt-node",
  "description": "Set up the initial node server",
  "status": "in-progress",
  "createdBy": "agent-ryan",
  "assignedTo": "agent-link",
  "priority": "high",
  "tags": ["infrastructure", "mvp"]
}
```

**Update task:**
```bash
PATCH /tasks/:id
{
  "status": "done"
}
```

**Delete task:**
```bash
DELETE /tasks/:id
```

### OpenClaw

**Run agent:**
```bash
POST /agent/run
{
  "prompt": "What's the weather?",
  "agentId": "main" # optional
}
```

**OpenClaw status:**
```bash
GET /openclaw/status
```

## How Agents Use This

### From OpenClaw (recommended)

Agents can call reflectt-node endpoints via OpenClaw tools. Example:

```typescript
// In your agent tool
await fetch('http://127.0.0.1:4445/chat/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    from: 'agent-link',
    content: 'Task complete!',
  }),
})
```

### WebSocket Integration

For real-time chat, connect to the WebSocket:

```typescript
import WebSocket from 'ws'

const ws = new WebSocket('ws://127.0.0.1:4445/chat/ws')

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString())
  
  if (msg.type === 'history') {
    console.log('Past messages:', msg.messages)
  } else if (msg.type === 'message') {
    console.log('New message:', msg.message)
  }
})
```

## Integration with Homie

reflectt-node is designed to work alongside Homie (Ryan's MCP server). You can:

1. Import Homie tools into reflectt-node
2. Expose them via REST endpoints
3. Let agents access them through the node

Example integration coming soon — see `src/tools/` (not yet implemented).

## Sync with chat.reflectt.ai

The cloud UI (`chat.reflectt.ai`) can sync with your local node:

1. Local node stores messages/tasks
2. UI polls `/chat/messages` and `/tasks` 
3. UI pushes updates via POST/PATCH

This keeps your local agent workflow synced with the cloud interface.

## Development

### Project Structure

```
src/
  index.ts       # Entry point
  server.ts      # Fastify server + routes
  chat.ts        # Chat manager
  tasks.ts       # Task manager
  openclaw.ts    # OpenClaw gateway client
  config.ts      # Configuration loader
  types.ts       # TypeScript types
```

### Adding Tools

To add tools from Homie or custom tools:

1. Create `src/tools/` directory
2. Define tool schemas (Zod)
3. Add routes in `server.ts`
4. Agents can now call them!

Example (not yet implemented):

```typescript
// src/tools/screens.ts
export async function updateScreen(screenId: string, html: string) {
  // Call Homie's MCP server or implement directly
}
```

## Contributing

This is an open-source project. PRs welcome!

## License

MIT

---

**Built by Team Reflectt**

Part of the Reflectt ecosystem:
- **reflectt-node** (this repo) — Local node server
- **reflectt-ui** — Shared UI components
- **chat.reflectt.ai** — Hosted cloud product
