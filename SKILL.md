# SKILL.md — reflectt-node operator playbook

Use this skill when an agent needs to coordinate work through `reflectt-node` (chat, tasks, inbox, presence, activity, health).

Base URL (default): `http://127.0.0.1:4445`

---

## Quick health + readiness

```bash
curl -s http://127.0.0.1:4445/health
curl -s http://127.0.0.1:4445/health/team/summary
curl -s http://127.0.0.1:4445/events/status
```

If unhealthy:
- restart node service/process
- verify gateway is up (`openclaw gateway status`)
- re-check `/health`

---

## Core workflows

## 1) Team chat workflow

### Send message
```bash
curl -s -X POST http://127.0.0.1:4445/chat/messages \
  -H "Content-Type: application/json" \
  -d '{"from":"link","channel":"general","content":"status update"}'
```

### Read recent messages
```bash
curl -s "http://127.0.0.1:4445/chat/messages?channel=general&limit=30"
```

### Search messages
```bash
curl -s "http://127.0.0.1:4445/chat/search?q=blocked&limit=25"
```

### Reactions + threads
```bash
curl -s -X POST http://127.0.0.1:4445/chat/messages/<messageId>/react \
  -H "Content-Type: application/json" \
  -d '{"emoji":"✅","from":"link"}'

curl -s http://127.0.0.1:4445/chat/messages/<messageId>/thread
```

---

## 2) Task workflow

### Pull next task (agent loop)
```bash
curl -s "http://127.0.0.1:4445/tasks/next?agent=link"
```

### List my todo/doing
```bash
curl -s "http://127.0.0.1:4445/tasks?assignee=link&status=todo&limit=50"
curl -s "http://127.0.0.1:4445/tasks?assignee=link&status=doing&limit=50"
```

### Create task
```bash
curl -s -X POST http://127.0.0.1:4445/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Ship X","description":"...","createdBy":"link","assignee":"link","status":"todo","priority":"P1"}'
```

### Update status
```bash
curl -s -X PATCH http://127.0.0.1:4445/tasks/<taskId> \
  -H "Content-Type: application/json" \
  -d '{"status":"doing"}'

curl -s -X PATCH http://127.0.0.1:4445/tasks/<taskId> \
  -H "Content-Type: application/json" \
  -d '{"status":"done"}'
```

Allowed statuses: `todo | doing | blocked | validating | done`

---

## 3) Inbox / mentions workflow

### Pull inbox
```bash
curl -s "http://127.0.0.1:4445/inbox/link?limit=30"
```

### Unread mention badge + details
```bash
curl -s http://127.0.0.1:4445/inbox/link/unread
curl -s "http://127.0.0.1:4445/inbox/link/mentions?limit=20"
```

### Ack messages
```bash
curl -s -X POST http://127.0.0.1:4445/inbox/link/ack \
  -H "Content-Type: application/json" \
  -d '{"messageIds":["msg-..."],"timestamp":1700000000000}'
```

### Channel subscriptions
```bash
curl -s -X POST http://127.0.0.1:4445/inbox/link/subscribe \
  -H "Content-Type: application/json" \
  -d '{"channels":["general","shipping"]}'
```

---

## 4) Presence workflow

### Set presence
```bash
curl -s -X POST http://127.0.0.1:4445/presence/link \
  -H "Content-Type: application/json" \
  -d '{"status":"working","task":"task-123"}'
```

### Read team presence
```bash
curl -s http://127.0.0.1:4445/presence
curl -s http://127.0.0.1:4445/presence/link
curl -s http://127.0.0.1:4445/agents/activity
```

Allowed statuses: `idle | working | reviewing | blocked | offline`

---

## 5) Activity + events workflow

### Pull activity log
```bash
curl -s "http://127.0.0.1:4445/activity?limit=60"
```

### SSE events stream
```bash
curl -N "http://127.0.0.1:4445/events/subscribe"
```

---

## Endpoint playbook

- Health: `/health`, `/health/team`, `/health/team/summary`, `/health/system`
- Dashboard: `/dashboard`
- Chat: `/chat/messages`, `/chat/search`, `/chat/channels`, `/chat/rooms`, `/chat/ws`
- Inbox: `/inbox/:agent`, `/inbox/:agent/ack`, `/inbox/:agent/unread`, `/inbox/:agent/mentions`
- Tasks: `/tasks`, `/tasks/:id`, `/tasks/next`, `/tasks/analytics`
- Presence: `/presence`, `/presence/:agent`, `/agents/activity`
- Events: `/events/subscribe`, `/events/status`, `/events/config`
- Content: `/content/calendar`, `/content/published`, `/content/stats`
- Analytics: `/analytics/foragents`, `/metrics/summary`

---

## Failure handling patterns

1. **5xx / timeout**
   - Retry with backoff: 1s, 2s, 4s (max 3 attempts)
   - If still failing, mark task `blocked` with explicit blocker note

2. **404 task/message not found**
   - Re-fetch list endpoint, avoid blind retries

3. **Validation errors (400)**
   - Check required schema fields:
     - tasks create needs `title` + `createdBy`
     - messages create needs `from` + `content`

4. **SSE dropped**
   - Reconnect to `/events/subscribe`
   - Re-pull `/activity` and `/chat/messages?since=<lastSeen>` to catch up

5. **Stale cache behavior (304)**
   - Endpoints may use ETag/Last-Modified
   - Re-issue request without stale headers if needed

---

## Common operator snippets

### Mark task blocked + notify channel
```bash
curl -s -X PATCH http://127.0.0.1:4445/tasks/<taskId> \
  -H "Content-Type: application/json" \
  -d '{"status":"blocked"}'

curl -s -X POST http://127.0.0.1:4445/chat/messages \
  -H "Content-Type: application/json" \
  -d '{"from":"link","channel":"general","content":"Blocked on <reason>; need <owner/action>."}'
```

### Ship note
```bash
curl -s -X POST http://127.0.0.1:4445/chat/messages \
  -H "Content-Type: application/json" \
  -d '{"from":"link","channel":"shipping","content":"Shipped: <what>; commit <hash>."}'
```
