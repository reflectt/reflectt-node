# List Agents

## Description

List all agents from both global and space-specific locations. Supports filtering by domain and capabilities. Returns agents with source information (global or space).

## Purpose and Use Cases

- **Discover available agents**: See all agents across global and space directories
- **Filter by domain**: Find agents in specific domains (finance, inventory, etc.)
- **Capability search**: Find agents with specific capabilities
- **Multi-space support**: Query agents from different named spaces
- **Agent inventory**: Get complete catalog of available AI agents

## Input Parameters

### Optional Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `domain` | string | Filter agents by domain (e.g., 'finance', 'inventory', 'chat') |
| `capabilities` | string[] | Filter agents that have ALL of these capabilities |
| `target_space` | string | Target a specific named space (e.g., 'creative', 'education') |

## Output Format

```typescript
{
  agents: Agent[]
  total: number
  global_count: number
  space_count: number
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
  source: 'global' | 'space'
}
```

**Success Example:**
```json
{
  "agents": [
    {
      "id": "budget_tracker",
      "slug": "finance:budget_tracker",
      "name": "Budget Tracker",
      "domain": "finance",
      "role": "Financial Planning Assistant",
      "description": "Helps track expenses and manage budgets",
      "capabilities": ["expense_tracking", "budget_planning"],
      "provider": "claude_agents",
      "model": "claude-sonnet-4-20250514",
      "temperature": 0.3,
      "maxOutputTokens": 4096,
      "source": "space"
    },
    {
      "id": "sales_forecaster",
      "slug": "finance:sales_forecaster",
      "name": "Sales Forecaster",
      "domain": "finance",
      "capabilities": ["forecasting", "sales_analysis"],
      "provider": "claude_agents",
      "model": "claude-sonnet-4.5-20250402",
      "source": "global"
    }
  ],
  "total": 2,
  "global_count": 1,
  "space_count": 1
}
```

## Example Usage

### Example 1: List All Agents

```typescript
import listAgents from './implementation'

const result = await listAgents(
  {},  // No filters
  '/path/to/dataDir',
  '/path/to/globalDir'
)

console.log(`Found ${result.total} agents:`)
console.log(`  Global: ${result.global_count}`)
console.log(`  Space: ${result.space_count}`)

result.agents.forEach(agent => {
  console.log(`  - ${agent.name} (${agent.domain}) [${agent.source}]`)
})
```

### Example 2: Filter by Domain

```typescript
const result = await listAgents(
  {
    domain: 'finance'
  },
  '/path/to/dataDir',
  '/path/to/globalDir'
)

// Returns only agents in the 'finance' domain
```

### Example 3: Filter by Capabilities

```typescript
const result = await listAgents(
  {
    capabilities: ['expense_tracking', 'budget_planning']
  },
  '/path/to/dataDir',
  '/path/to/globalDir'
)

// Returns agents that have BOTH capabilities
// Agent must have ALL specified capabilities to match
```

### Example 4: Domain + Capabilities Filter

```typescript
const result = await listAgents(
  {
    domain: 'finance',
    capabilities: ['forecasting']
  },
  '/path/to/dataDir',
  '/path/to/globalDir'
)

// Returns finance agents that can do forecasting
```

### Example 5: List from Specific Space

```typescript
const result = await listAgents(
  {
    target_space: 'creative'
  },
  '/path/to/dataDir',
  '/path/to/globalDir'
)

// Lists agents from the 'creative' space + global agents
```

## Behavior Details

### Search Hierarchy

The function searches both directories:
1. **Global directory** (`{globalDir}/agents/`)
2. **Space directory** (`{dataDir}/agents/` or `{globalDir}/../spaces/{target_space}/agents/`)

Both are combined in results with `source` field indicating origin.

### Capability Filtering Logic

When `capabilities` array is provided:
```typescript
// Agent must have ALL specified capabilities
const hasAllCapabilities = capabilities.every(cap =>
  agentCapabilities.includes(cap)
)
```

Examples:
- Filter: `["a", "b"]` + Agent has: `["a", "b", "c"]` → ✅ Match
- Filter: `["a", "b"]` + Agent has: `["a"]` → ❌ No match
- Filter: `["a"]` + Agent has: `[]` → ❌ No match

### Result Sorting

Results are sorted by:
1. **Domain** (alphabetically)
2. **Name** (alphabetically within domain)

This groups agents by domain for easier browsing.

### Error Handling

The function gracefully handles errors:
```typescript
// Directory doesn't exist
// Returns: { agents: [], total: 0, global_count: 0, space_count: 0 }

// Invalid JSON in agent file
// Skips that agent, continues processing others

// Permission errors
// Logs error, continues with other files
```

## Use Cases

### Use Case 1: Agent Discovery UI

```typescript
const { agents, total } = await listAgents({}, dataDir, globalDir)

// Display in UI
<div>
  <h2>Available Agents ({total})</h2>
  {agents.map(agent => (
    <AgentCard
      key={agent.id}
      name={agent.name}
      description={agent.description}
      domain={agent.domain}
      source={agent.source}
    />
  ))}
</div>
```

### Use Case 2: Find Agents for Task

```typescript
// Need an agent that can do expense tracking
const result = await listAgents({
  capabilities: ['expense_tracking']
}, dataDir, globalDir)

if (result.total === 0) {
  console.log('No agents found with expense tracking capability')
} else {
  console.log(`Found ${result.total} capable agents:`)
  result.agents.forEach(agent => {
    console.log(`  - ${agent.name}`)
  })
}
```

### Use Case 3: Domain Explorer

```typescript
// Get all domains
const allAgents = await listAgents({}, dataDir, globalDir)
const domains = [...new Set(allAgents.agents.map(a => a.domain))]

// For each domain, show agent count
for (const domain of domains) {
  const domainAgents = await listAgents({ domain }, dataDir, globalDir)
  console.log(`${domain}: ${domainAgents.total} agents`)
}
```

### Use Case 4: Global vs Space Analysis

```typescript
const result = await listAgents({}, dataDir, globalDir)

console.log('Agent Distribution:')
console.log(`  Global (shared): ${result.global_count}`)
console.log(`  Space (custom): ${result.space_count}`)

// List space-specific agents
const spaceAgents = result.agents.filter(a => a.source === 'space')
console.log('\nSpace-specific agents:')
spaceAgents.forEach(a => console.log(`  - ${a.name}`))
```

## Output Fields Explained

| Field | Description |
|-------|-------------|
| `agents` | Array of agent objects matching filters |
| `total` | Total number of agents returned |
| `global_count` | Number of agents from global directory |
| `space_count` | Number of agents from space directory |
| `source` | Where agent was loaded from ('global' or 'space') |

## Related Tools

- **get_agent**: Retrieve a specific agent by ID or slug
- **upsert_agent**: Create or update an agent
- **delete_agent**: Remove an agent
- **load_agent**: Load agent for execution
- **execute_agent_task**: Run a task with an agent
