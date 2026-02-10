# Upsert Agent

## Description

Create or update an agent with validated schema. All required fields enforced. Use this to define new agents or modify existing ones.

## Purpose and Use Cases

- **Define new AI agents**: Create agents with specific capabilities, models, and prompts
- **Update existing agents**: Modify agent configurations, models, or parameters
- **Multi-tenant support**: Create agents in specific spaces (space-scoped) or globally (shared across all spaces)
- **Domain organization**: Organize agents by domain (e.g., finance, inventory, support)

## Input Parameters

### Required Parameters

| Parameter | Type | Description | Pattern |
|-----------|------|-------------|---------|
| `id` | string | Agent ID (lowercase, underscores only) | `^[a-z_]+$` |
| `slug` | string | Agent slug in format domain:agent_name | `^[a-z]+:[a-z_]+$` |
| `name` | string | Human-readable agent name | - |
| `domain` | string | Domain this agent belongs to | - |
| `provider` | string | AI provider (always "claude_agents") | enum: `["claude_agents"]` |
| `model` | string | AI model to use | enum: `["claude-sonnet-4-20250514", "claude-sonnet-4.5-20250402", "claude-opus-4-20250514"]` |
| `prompt_file` | string | Path to prompt markdown file | - |

### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `role` | string | `name` | Agent role/purpose |
| `description` | string | `role` or `name` | Detailed description of what the agent does |
| `capabilities` | string[] | `[]` | List of capabilities this agent has |
| `temperature` | number | `0.3` | Temperature for AI responses (0-1) |
| `maxOutputTokens` | number | `4096` | Maximum output tokens (1024-8192) |
| `scope` | string | `'space'` | Where to create the agent: 'space' or 'global' |
| `target_space` | string | - | Write to a specific named space (overrides scope) |

## Output Format

```typescript
{
  success: boolean
  path?: string              // Relative path to saved agent file
  message?: string          // Success message
  error?: string            // Error message if failed
}
```

**Success Example:**
```json
{
  "success": true,
  "path": "agents/finance/budget_tracker.json",
  "message": "Agent finance:budget_tracker created/updated successfully"
}
```

**Error Example:**
```json
{
  "success": false,
  "error": "ENOENT: no such file or directory"
}
```

## Example Usage

### Example 1: Create a Finance Tracker Agent

```typescript
import upsertAgent from './implementation'

const result = await upsertAgent(
  {
    id: 'budget_tracker',
    slug: 'finance:budget_tracker',
    name: 'Budget Tracker',
    domain: 'finance',
    provider: 'claude_agents',
    model: 'claude-sonnet-4-20250514',
    prompt_file: 'data/prompts/finance/budget-tracker.md',
    role: 'Financial Planning Assistant',
    description: 'Helps users track expenses and manage budgets',
    capabilities: ['expense_tracking', 'budget_planning', 'financial_analysis'],
    temperature: 0.3,
    maxOutputTokens: 4096,
    scope: 'space'
  },
  '/path/to/dataDir',
  '/path/to/globalDir'
)

console.log(result)
// {
//   success: true,
//   path: 'agents/finance/budget_tracker.json',
//   message: 'Agent finance:budget_tracker created/updated successfully'
// }
```

### Example 2: Create a Global Agent (Shared Across Spaces)

```typescript
const result = await upsertAgent(
  {
    id: 'general_assistant',
    slug: 'support:general_assistant',
    name: 'General Assistant',
    domain: 'support',
    provider: 'claude_agents',
    model: 'claude-sonnet-4.5-20250402',
    prompt_file: 'data/prompts/support/general.md',
    scope: 'global'  // Available to all spaces
  },
  '/path/to/dataDir',
  '/path/to/globalDir'
)
```

### Example 3: Create Agent in Specific Named Space

```typescript
const result = await upsertAgent(
  {
    id: 'story_writer',
    slug: 'creative:story_writer',
    name: 'Story Writer',
    domain: 'creative',
    provider: 'claude_agents',
    model: 'claude-opus-4-20250514',
    prompt_file: 'data/prompts/creative/story-writer.md',
    target_space: 'creative'  // Write to 'creative' space
  },
  '/path/to/dataDir',
  '/path/to/globalDir'
)
```

## Error Handling

The function catches all errors and returns them in the output:

```typescript
// Missing required fields
{
  success: false,
  error: "Missing required parameter: slug"
}

// Invalid directory permissions
{
  success: false,
  error: "EACCES: permission denied, mkdir '/readonly/agents/finance'"
}

// File system errors
{
  success: false,
  error: "ENOENT: no such file or directory, open '/invalid/path/prompt.md'"
}
```

## File Structure

The agent is saved to:
```
{baseDir}/agents/{domain}/{id}.json
```

Where `baseDir` is determined by:
- `target_space`: `{globalDir}/../spaces/{target_space}/`
- `scope: 'global'`: `{globalDir}/`
- `scope: 'space'` (default): `{dataDir}/`

Example saved agent file (`agents/finance/budget_tracker.json`):
```json
{
  "id": "budget_tracker",
  "slug": "finance:budget_tracker",
  "name": "Budget Tracker",
  "domain": "finance",
  "role": "Financial Planning Assistant",
  "description": "Helps users track expenses and manage budgets",
  "capabilities": ["expense_tracking", "budget_planning", "financial_analysis"],
  "provider": "claude_agents",
  "model": "claude-sonnet-4-20250514",
  "maxOutputTokens": 4096,
  "temperature": 0.3,
  "tools": null,
  "metadata": {
    "domain": "finance",
    "capability": "expense_tracking"
  },
  "version": 1,
  "prompt_file": "data/prompts/finance/budget-tracker.md",
  "exported_at": "2025-10-17T12:34:56.789Z"
}
```

## Related Tools

- **get_agent**: Retrieve an agent configuration by ID or slug
- **list_agents**: List all agents in a domain or across all domains
- **delete_agent**: Delete an agent
- **load_agent**: Load and execute an agent
- **execute_agent_task**: Run a task using a specific agent
