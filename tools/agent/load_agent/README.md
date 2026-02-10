# Load Agent

## Description

Load an agent definition by name with hierarchical search (space → global). Use this to inspect agent configurations, load sub-agents, or prepare agents for execution.

## Purpose and Use Cases

- **Hierarchical discovery**: Search space first, then global
- **Agent inspection**: Load and examine agent configurations
- **Override pattern**: Space-specific agents override global ones
- **Dynamic agent loading**: Load agents at runtime by name
- **Flexible matching**: Match by name, ID, or slug

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `agent_name` | string | Name, slug, or ID (e.g., "student_tutor", "education:tutor") |

### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `search_space` | boolean | `true` | Search in current space first |
| `search_global` | boolean | `true` | Search in global as fallback |

## Output Format

```typescript
{
  agent?: {
    id: string
    slug: string
    provider: string
    model: string
    maxOutputTokens: number
    temperature: number
    tools?: any
    metadata?: any
    version: number
    prompt_file: string | null
    system_prompt?: string  // Loaded from prompt_file
  }
  found_in?: 'space' | 'global'
  error?: string
}
```

## Example Usage

### Example 1: Load from Space or Global (Default)

```typescript
import loadAgent from './implementation'

const result = await loadAgent(
  {
    agent_name: 'student_tutor'
  },
  '/path/to/dataDir',
  '/path/to/globalDir'
)

if (result.agent) {
  console.log(`Loaded from: ${result.found_in}`)
  console.log(`System prompt: ${result.agent.system_prompt}`)
}
```

### Example 2: Load Only from Global

```typescript
const result = await loadAgent(
  {
    agent_name: 'system_builder',
    search_space: false,
    search_global: true
  },
  '/path/to/dataDir',
  '/path/to/globalDir'
)
```

### Example 3: Load Space-Specific Override

```typescript
const result = await loadAgent(
  {
    agent_name: 'custom_tutor',
    search_space: true,
    search_global: false
  },
  '/path/to/dataDir',
  '/path/to/globalDir'
)
```

### Example 4: Load by Slug

```typescript
const result = await loadAgent(
  {
    agent_name: 'education:student_tutor'
  },
  '/path/to/dataDir',
  '/path/to/globalDir'
)
```

## Search Algorithm

### Search Order (Default)

1. **Space agents** (if `search_space !== false`)
   - Searches all domains in `{dataDir}/agents/`
   - Matches by: filename, id, slug, or slug suffix
2. **Global agents** (if `search_global !== false`)
   - Searches all domains in `{globalDir}/agents/`
   - Same matching rules

### Matching Rules

An agent matches if ANY of these are true:
- Filename contains `agent_name`
- `agent.id === agent_name`
- `agent.slug === agent_name`
- `agent.slug.endsWith(':' + agent_name)`

Examples:
- `agent_name: "tutor"` matches `education:tutor` (slug suffix)
- `agent_name: "student_tutor"` matches `student_tutor.json` (filename)
- `agent_name: "education:tutor"` matches exact slug

## System Prompt Loading

If agent has `prompt_file` field, the function automatically loads it:

```typescript
// Agent JSON
{
  "prompt_file": "data/prompts/education/tutor.md"
}
```

The function:
1. Resolves path relative to `globalDir`
2. Reads file content
3. Extracts from markdown if available:
   ```markdown
   ## System Prompt
   ```
   You are a helpful tutor...
   ```
   ```
4. Falls back to raw content if no markdown section
5. Adds to `agent.system_prompt` field

## Override Pattern

Space agents override global agents:

```
data-global/agents/education/tutor.json  (base)
data/agents/education/tutor.json         (override)
```

With `search_space: true, search_global: true`:
- Space version is returned if it exists
- Global version only used as fallback

## Error Handling

```typescript
// Agent not found
{
  error: 'Agent "nonexistent" not found'
}

// Prompt file not found
// Silently ignores, system_prompt not added

// Invalid JSON
{
  error: 'Unexpected token ...'
}
```

## Related Tools

- **upsert_agent**: Create or update agents
- **get_agent**: Get agent metadata
- **list_agents**: List all agents
- **execute_agent_task**: Execute with loaded agent
- **delete_agent**: Remove an agent
