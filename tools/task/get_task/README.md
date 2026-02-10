# get_task

## Description

Get a specific task definition by ID. Searches both space-specific and global locations with hierarchical fallback (space → global). Can optionally specify the agent to narrow the search.

## Purpose and Use Cases

- **Primary use**: Get a specific task definition by ID. Searches both space-specific and global locations with hierarchical fallback (space → global). Can optionally specify the agent to narrow the search.
- **Integration**: Works with task category tools
- **Requirements**: Needs dataDir, globalDir

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `task_id` | string | Task ID (e.g., 'create-budget', 'track-expense') |


### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `agent` | string | - | Optional: Agent ID to narrow the search (e.g., 'budget_tracker') |
| `target_space` | string | - | Optional: Target a specific named space (e.g., 'creative', 'education'). Defaults to current space. |
| `search_global` | boolean | true | Whether to search in global data as fallback (default: true) |
| `search_space` | boolean | true | Whether to search in space-specific data first (default: true) |


## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import getTask from './implementation'

const result = await getTask(
  {
    // Add parameters here
  },
  dataDir,
  globalDir
)

console.log(result)
```



## Error Handling

The function returns structured error responses when issues occur.

## Related Tools

- See other task category tools
