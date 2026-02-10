# get_agent_prompt

Retrieves the prompt file content for a specific agent.

## Description

This tool reads the `prompt.md` file from an agent's directory and returns its content. Agents can have custom prompts that define their behavior and capabilities.

## Input

- `agent_id` (required): The agent identifier (e.g., 'market_researcher')
- `category` (required): The agent category (e.g., 'research', 'intelligence')
- `scope` (optional): Either 'global' or 'space' (default: 'global')
- `space_id` (optional): Required if scope is 'space'

## Output

Returns an object with:
- `success`: Boolean indicating if the operation succeeded
- `prompt`: The prompt content (if successful)
- `error`: Error message (if failed)
- `metadata`: Additional information about the prompt file

## Examples

### Get a global agent prompt

```json
{
  "agent_id": "market_researcher",
  "category": "research"
}
```

### Get a space-specific agent prompt

```json
{
  "agent_id": "market_researcher",
  "category": "research",
  "scope": "space",
  "space_id": "workrocket"
}
```

## File Structure

Prompts are stored in the following structure:

```
data/global/agents/{category}/{agent_id}/prompt.md
data/spaces/{space_id}/agents/{category}/{agent_id}/prompt.md
```

## Related Tools

- `upsert_agent_prompt`: Create or update an agent prompt
- `load_agent`: Load complete agent definition including prompt
- `list_agents`: List all available agents
