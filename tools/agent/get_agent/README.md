# Get Agent

## Description

Get a specific agent configuration by ID or slug. Searches both space-specific and global locations with hierarchical fallback (space → global). Returns the agent configuration with source information.

## Purpose and Use Cases

- **Load agent configurations**: Retrieve complete agent settings for execution
- **Hierarchical search**: Automatically searches space-specific agents first, then falls back to global agents
- **Multi-space support**: Target specific named spaces or use current space
- **Agent discovery**: Find agents by ID (searches all domains) or by slug (direct lookup)

## Input Parameters

### Optional Parameters (at least one required)

| Parameter | Type | Description | Pattern |
|-----------|------|-------------|---------|
| `agent_id` | string | Agent ID (e.g., 'budget_tracker'). Searches all domains if slug not provided. | `^[a-z_]+$` |
| `slug` | string | Agent slug in format domain:agent_id (e.g., 'finance:budget_tracker'). Takes precedence over agent_id. | `^[a-z]+:[a-z_]+$` |
| `target_space` | string | Target a specific named space (e.g., 'creative', 'education'). Defaults to current space. | - |
| `search_global` | boolean | Whether to search in global data as fallback (default: true) | - |
| `search_space` | boolean | Whether to search in space-specific data first (default: true) | - |

**Note:** Either `agent_id` or `slug` must be provided.

## Output Format

```typescript
{
  agent: Agent
  found_in: 'global' | 'space'
}

interface Agent {
  id: string
  slug: string
  name: string
  domain: string
  role?: string
  description?: string
  capabilities?: string[]
  provider: string
  model: string
  temperature?: number
  maxOutputTokens?: number
  prompt_file?: string
  source?: 'global' | 'space'
  path?: string
}
```

**Success Example:**
```json
{
  "agent": {
    "id": "budget_tracker",
    "slug": "finance:budget_tracker",
    "name": "Budget Tracker",
    "domain": "finance",
    "role": "Financial Planning Assistant",
    "description": "Helps users track expenses and manage budgets",
    "capabilities": ["expense_tracking", "budget_planning"],
    "provider": "claude_agents",
    "model": "claude-sonnet-4-20250514",
    "temperature": 0.3,
    "maxOutputTokens": 4096,
    "prompt_file": "data/prompts/finance/budget-tracker.md",
    "source": "space",
    "path": "/full/path/to/agents/finance/budget_tracker.json"
  },
  "found_in": "space"
}
```

**Error Example:**
```typescript
// Throws error if not found
throw new Error('Agent not found: finance:budget_tracker')
```

## Example Usage

### Example 1: Get Agent by Slug (Recommended)

```typescript
import getAgent from './implementation'

// Get agent by slug (fastest, most specific)
const result = await getAgent(
  {
    slug: 'finance:budget_tracker'
  },
  '/path/to/dataDir',
  '/path/to/globalDir'
)

console.log(result.agent.name)  // "Budget Tracker"
console.log(result.found_in)    // "space" or "global"
```

### Example 2: Get Agent by ID (Searches All Domains)

```typescript
// Get agent by ID (searches all domains)
const result = await getAgent(
  {
    agent_id: 'budget_tracker'
  },
  '/path/to/dataDir',
  '/path/to/globalDir'
)

// Will find 'finance:budget_tracker' even without domain specified
console.log(result.agent.slug)  // "finance:budget_tracker"
```

### Example 3: Target Specific Space

```typescript
// Get agent from a specific named space
const result = await getAgent(
  {
    slug: 'creative:story_writer',
    target_space: 'creative'  // Look in 'creative' space
  },
  '/path/to/dataDir',
  '/path/to/globalDir'
)

console.log(result.agent.name)  // "Story Writer"
```

### Example 4: Search Global Only (Skip Space)

```typescript
// Only search global agents, skip space-specific
const result = await getAgent(
  {
    slug: 'support:general_assistant',
    search_space: false,    // Don't search space
    search_global: true     // Only search global
  },
  '/path/to/dataDir',
  '/path/to/globalDir'
)

console.log(result.found_in)  // "global"
```

### Example 5: Search Space Only (Skip Global)

```typescript
// Only search current space, don't fall back to global
try {
  const result = await getAgent(
    {
      slug: 'finance:budget_tracker',
      search_space: true,     // Search space
      search_global: false    // Don't fall back to global
    },
    '/path/to/dataDir',
    '/path/to/globalDir'
  )

  console.log('Found in space:', result.agent.name)
} catch (error) {
  console.log('Not found in space, and global search disabled')
}
```

## Error Handling

The function throws errors for invalid inputs or when agent is not found:

```typescript
// Missing both agent_id and slug
throw new Error('Either agent_id or slug must be provided')

// Invalid slug format
throw new Error('Invalid slug format. Expected format: domain:agent_id (e.g., "finance:budget_tracker")')

// Agent not found
throw new Error('Agent not found: finance:budget_tracker')

// File read errors
// Logged to console, continues searching other locations
```

**Handling Not Found:**

```typescript
try {
  const result = await getAgent({ slug: 'unknown:agent' }, dataDir, globalDir)
} catch (error) {
  if (error instanceof Error && error.message.startsWith('Agent not found')) {
    console.log('Agent does not exist')
  } else {
    console.error('Unexpected error:', error)
  }
}
```

## Search Hierarchy

The function searches in this order:

1. **Space-specific** (if `search_space: true`, default)
   - Path: `{dataDir}/agents/{domain}/{id}.json`
   - Or: `{cwd}/data/{target_space}/agents/{domain}/{id}.json`

2. **Global** (if `search_global: true`, default, and not found in space)
   - Path: `{cwd}/data-global/agents/{domain}/{id}.json`

3. **Not found** → Throws error

### Search by Slug (with domain)

```
slug: 'finance:budget_tracker'
→ Search: agents/finance/budget_tracker.json
```

### Search by ID (without domain)

```
agent_id: 'budget_tracker'
→ Search all domains:
  - agents/finance/budget_tracker.json
  - agents/support/budget_tracker.json
  - agents/creative/budget_tracker.json
  - ... (first match wins)
```

## Agent Source Information

The returned agent includes source metadata:

```typescript
{
  agent: {
    // ... agent fields ...
    source: 'space',  // 'space' or 'global'
    path: '/full/path/to/agent.json'
  },
  found_in: 'space'  // Same as agent.source
}
```

Use this to understand where the agent was loaded from:
- **'space'**: Agent is specific to current/target space
- **'global'**: Agent is shared across all spaces

## Performance Notes

- **Slug search** is faster (direct file lookup)
- **ID search** is slower (scans all domains)
- Use slug when you know the domain
- Use ID for discovery or when domain is unknown

## Related Tools

- **upsert_agent**: Create or update an agent
- **list_agents**: List all agents in a domain or across all domains
- **delete_agent**: Delete an agent
- **load_agent**: Load and execute an agent
- **execute_agent_task**: Run a task using a specific agent
