# Search Conversations

Search conversations by various criteria including date range, agent, type, cost, and more.

## Parameters

All parameters are optional:

- `user_id` (string): Filter by user ID (defaults to current user)
- `conversation_type` (string): Filter by type (user_chat, agent_to_agent, task_execution, workflow_execution)
- `agent_slug` (string): Filter by primary agent
- `task_id` (string): Filter by task ID
- `date_from` (string): ISO date - conversations after this date
- `date_to` (string): ISO date - conversations before this date
- `min_cost` (number): Minimum cost in USD
- `max_cost` (number): Maximum cost in USD
- `status` (string): Filter by status (active, completed, failed, cancelled)
- `limit` (number): Maximum results (default: 20)
- `offset` (number): Pagination offset (default: 0)

## Returns

```typescript
{
  success: boolean
  conversations?: ConversationSummary[]
  total?: number
  error?: string
}
```

## Examples

### Find expensive conversations

```typescript
const result = await context.executeTool('search_conversations', {
  min_cost: 0.05,
  limit: 10
})

console.log(`Found ${result.total} expensive conversations`)
result.conversations.forEach(conv => {
  console.log(`${conv.id}: $${conv.total_cost_usd} - ${conv.agent_slug}`)
})
```

### Find task executions

```typescript
const result = await context.executeTool('search_conversations', {
  conversation_type: 'task_execution',
  date_from: '2025-10-01',
  limit: 20
})
```

### Find agent-to-agent conversations

```typescript
const result = await context.executeTool('search_conversations', {
  conversation_type: 'agent_to_agent',
  agent_slug: 'bootstrap:system_builder'
})
```

## Use Cases

1. **Cost Analysis**: Find expensive conversations to optimize prompts
2. **Debugging**: Find failed conversations to investigate errors
3. **Learning**: Find successful conversations for pattern extraction
4. **Audit**: Review all conversations for a specific task or agent
