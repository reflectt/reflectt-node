# Get Conversation Statistics

Get usage statistics and cost analysis for conversations including totals, averages, trends, and top agents.

## Parameters

All parameters are optional:

- `user_id` (string): User ID (defaults to current user)
- `date_from` (string): ISO date - stats from this date
- `date_to` (string): ISO date - stats until this date
- `group_by` (string): Group by period (day, week, month, agent, type) - default: day

## Returns

```typescript
{
  success: boolean
  stats?: {
    total_conversations: number
    total_messages: number
    total_input_tokens: number
    total_output_tokens: number
    total_cost_usd: number
    avg_tokens_per_conversation: number
    avg_cost_per_conversation: number
    breakdown: Array<{period: string, conversations: number, cost: number}>
    top_agents: Array<{agent_slug: string, conversation_count: number, total_cost: number}>
    cost_trend: Array<{period: string, conversations: number, cost: number}>
  }
  error?: string
}
```

## Examples

### Get overall statistics

```typescript
const result = await context.executeTool('get_conversation_stats', {
  date_from: '2025-10-01'
})

if (result.success) {
  console.log('Total conversations:', result.stats.total_conversations)
  console.log('Total cost:', `$${result.stats.total_cost_usd.toFixed(4)}`)
  console.log('Average cost per conversation:', `$${result.stats.avg_cost_per_conversation.toFixed(4)}`)
}
```

### Group by agent

```typescript
const result = await context.executeTool('get_conversation_stats', {
  group_by: 'agent',
  date_from: '2025-10-01'
})

console.log('Top agents:')
result.stats.top_agents.forEach(agent => {
  console.log(`${agent.agent_slug}: ${agent.conversation_count} conversations, $${agent.total_cost.toFixed(4)}`)
})
```

### Weekly cost trend

```typescript
const result = await context.executeTool('get_conversation_stats', {
  group_by: 'week',
  date_from: '2025-09-01',
  date_to: '2025-10-01'
})

console.log('Weekly trend:')
result.stats.cost_trend.forEach(week => {
  console.log(`${week.period}: ${week.conversations} conversations, $${week.cost.toFixed(4)}`)
})
```

## Use Cases

1. **Budget Tracking**: Monitor AI spending over time
2. **Cost Optimization**: Identify expensive agents or conversation types
3. **Usage Analytics**: Understand conversation patterns
4. **Forecasting**: Predict future costs based on trends
