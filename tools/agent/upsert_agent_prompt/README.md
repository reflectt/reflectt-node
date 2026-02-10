# upsert_agent_prompt

Create or update the prompt file for a specific agent.

## Description

This tool writes or updates the `prompt.md` file in an agent's directory. The agent directory must already exist before you can set its prompt.

## Input

- `agent_id` (required): The agent identifier (e.g., 'market_researcher')
- `category` (required): The agent category (e.g., 'research', 'intelligence')
- `prompt` (required): The prompt content in markdown format
- `scope` (optional): Either 'global' or 'space' (default: 'global')
- `space_id` (optional): Required if scope is 'space'

## Output

Returns an object with:
- `success`: Boolean indicating if the operation succeeded
- `message`: Success message
- `error`: Error message (if failed)
- `metadata`: Additional information about the operation

## Examples

### Create a prompt for a global agent

```json
{
  "agent_id": "market_researcher",
  "category": "research",
  "prompt": "# Market Researcher\n\nYou are an expert market researcher..."
}
```

### Update a space-specific agent prompt

```json
{
  "agent_id": "custom_agent",
  "category": "custom",
  "scope": "space",
  "space_id": "workrocket",
  "prompt": "# Custom Agent\n\nYou are a specialized agent for WorkRocket..."
}
```

## Prerequisites

- The agent directory must already exist at:
  - `data/global/agents/{category}/{agent_id}/` for global agents
  - `data/spaces/{space_id}/agents/{category}/{agent_id}/` for space agents
- If the directory doesn't exist, create the agent first using the appropriate tool

## File Structure

Prompts are written to:

```
data/global/agents/{category}/{agent_id}/prompt.md
data/spaces/{space_id}/agents/{category}/{agent_id}/prompt.md
```

## Best Practices

1. **Use Markdown**: Format prompts in markdown for better readability
2. **Be Specific**: Clearly define the agent's role, capabilities, and constraints
3. **Include Examples**: Add examples of desired outputs when appropriate
4. **Version Control**: Document significant changes in git commits
5. **Test Thoroughly**: Verify the prompt works as expected before deploying

## Related Tools

- `get_agent_prompt`: Retrieve the current prompt
- `load_agent`: Load complete agent definition including prompt
- `list_agents`: List all available agents
