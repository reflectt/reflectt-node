# Get Conversation

Retrieves full conversation history by ID including all messages, tool use, and costs.

## Parameters

- `conversation_id` (string, required): UUID of conversation to retrieve
- `include_tools` (boolean, optional): Include tool execution details (default: true)

## Returns

```typescript
{
  success: boolean
  conversation?: ConversationFile
  error?: string
}
```

## Example

```typescript
const result = await context.executeTool('get_conversation', {
  conversation_id: 'conv_1697652000000_abc123x',
  include_tools: true
})

if (result.success) {
  console.log('Conversation:', result.conversation)
  console.log('Messages:', result.conversation.messages.length)
  console.log('Tools used:', result.conversation.tools_used.length)
  console.log('Total cost:', result.conversation.total_cost_usd)
}
```

## Use Cases

1. **Debugging**: View full conversation history to debug agent behavior
2. **Learning**: Agents can learn from past successful conversations
3. **Audit**: Review what happened in a specific conversation
4. **Resume**: Continue a previous conversation with full context
