# Delete Agent

## Description

Delete an agent from the file system. Can optionally delete all associated tasks. Supports both space-specific and global scopes.

## Purpose and Use Cases

- **Remove deprecated agents**: Clean up agents that are no longer needed
- **Clean up test agents**: Delete agents created during development/testing
- **Task cleanup**: Optionally remove all tasks associated with an agent
- **Multi-scope support**: Delete from space-specific or global directories
- **Cross-space deletion**: Target specific named spaces for deletion

## Input Parameters

### Optional Parameters (At least one required)

| Parameter | Type | Description | Pattern |
|-----------|------|-------------|---------|
| `agent_id` | string | Agent ID (searches all domains) | `^[a-z_]+$` |
| `slug` | string | Agent slug (domain:id format, takes precedence) | `^[a-z]+:[a-z_]+$` |
| `target_space` | string | Target specific named space | - |
| `scope` | string | Where to delete from: 'space' or 'global' | enum: `["space", "global"]` |
| `delete_tasks` | boolean | Also delete associated tasks | default: `false` |

## Output Format

```typescript
{
  success: boolean
  deleted_from: 'global' | 'space'
  agent_path: string
  tasks_deleted?: number
  message: string
}
```

**Success Example:**
```json
{
  "success": true,
  "deleted_from": "space",
  "agent_path": "/path/to/data/agents/finance/budget_tracker.json",
  "message": "Successfully deleted agent budget_tracker from space"
}
```

**Success with Tasks Example:**
```json
{
  "success": true,
  "deleted_from": "global",
  "agent_path": "/path/to/data-global/agents/support/helper.json",
  "tasks_deleted": 3,
  "message": "Successfully deleted agent helper from global and 3 associated task(s)"
}
```

**Error Example:**
```json
{
  "success": false,
  "error": "Agent not found: budget_tracker in space"
}
```

## Example Usage

### Example 1: Delete Agent by Slug

```typescript
import deleteAgent from './implementation'

const result = await deleteAgent(
  {
    slug: 'finance:budget_tracker'
  },
  '/path/to/dataDir',
  '/path/to/globalDir'
)

console.log(result)
// {
//   success: true,
//   deleted_from: 'space',
//   agent_path: '/path/to/data/agents/finance/budget_tracker.json',
//   message: 'Successfully deleted agent budget_tracker from space'
// }
```

### Example 2: Delete Agent by ID (Searches All Domains)

```typescript
const result = await deleteAgent(
  {
    agent_id: 'story_writer'
  },
  '/path/to/dataDir',
  '/path/to/globalDir'
)

// Searches all domains for agent with ID 'story_writer'
// Deletes the first match found
```

### Example 3: Delete Agent with Associated Tasks

```typescript
const result = await deleteAgent(
  {
    slug: 'support:helper',
    delete_tasks: true  // Also deletes all tasks
  },
  '/path/to/dataDir',
  '/path/to/globalDir'
)

console.log(result)
// {
//   success: true,
//   deleted_from: 'space',
//   agent_path: '/path/to/data/agents/support/helper.json',
//   tasks_deleted: 5,
//   message: 'Successfully deleted agent helper from space and 5 associated task(s)'
// }
```

### Example 4: Delete from Global Scope

```typescript
const result = await deleteAgent(
  {
    slug: 'system:builder',
    scope: 'global'  // Delete from global directory
  },
  '/path/to/dataDir',
  '/path/to/globalDir'
)
```

### Example 5: Delete from Target Space

```typescript
const result = await deleteAgent(
  {
    slug: 'creative:writer',
    target_space: 'creative'  // Delete from specific space
  },
  '/path/to/dataDir',
  '/path/to/globalDir'
)
```

## Error Handling

The function throws errors for invalid inputs:

```typescript
// Missing both agent_id and slug
// Throws: "Either agent_id or slug must be provided"

// Invalid slug format
{
  slug: 'invalid-slug-format'
}
// Throws: "Invalid slug format. Expected format: domain:agent_id"

// Agent not found
{
  slug: 'finance:nonexistent'
}
// Throws: "Agent not found: finance:nonexistent in space"

// Directory not found
{
  agent_id: 'test',
  scope: 'space'
}
// Throws: "Agents directory not found in space"
```

## Behavior Details

### Slug vs Agent ID Priority

- If both `slug` and `agent_id` are provided, `slug` takes precedence
- `slug` format enables direct path lookup (faster)
- `agent_id` alone triggers domain search (slower, but more flexible)

### Domain Search Algorithm (agent_id only)

1. Reads all directories in `agents/` folder
2. Checks each domain directory for `{agent_id}.json`
3. Returns first match found
4. Throws error if no matches after checking all domains

### Task Deletion Behavior

When `delete_tasks: true`:
1. Looks for tasks in `data/tasks/{agent_id}/` directory
2. Deletes all `.json` files in that directory
3. Attempts to remove the directory if empty
4. Continues even if task directory doesn't exist
5. Returns count of deleted tasks in `tasks_deleted` field

### Scope Resolution

| Configuration | Directory Used |
|--------------|----------------|
| `scope: 'space'` (default) | `{dataDir}/agents/` |
| `scope: 'global'` | `{globalDir}/agents/` |
| `target_space: 'creative'` | `{globalDir}/../spaces/creative/agents/` |

**Note:** `target_space` overrides `scope`

## File Structure

The agent is deleted from:
```
{baseDir}/agents/{domain}/{id}.json
```

Associated tasks (if `delete_tasks: true`) are deleted from:
```
{baseDir}/tasks/{id}/*.json
```

Where `baseDir` is determined by scope/target_space.

## Related Tools

- **upsert_agent**: Create or update an agent
- **get_agent**: Retrieve an agent configuration
- **list_agents**: List all available agents
- **load_agent**: Load and prepare an agent for execution
- **execute_agent_task**: Run a task using an agent
