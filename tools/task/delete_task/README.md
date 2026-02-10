# delete_task

## Description

Delete a task from the file system. Can search across all agents or target a specific agent. Supports both space-specific and global scopes.

## Purpose and Use Cases

- **Primary use**: Delete a task from the file system. Can search across all agents or target a specific agent. Supports both space-specific and global scopes.
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
| `agent` | string | - | Optional: Agent ID to narrow the search (e.g., 'budget_tracker'). If not provided, will search all agents. |
| `target_space` | string | - | Optional: Target a specific named space (e.g., 'creative', 'education'). Defaults to current space. |
| `scope` | string | space | Where to delete the task from: 'space' (default) or 'global' |


## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import deleteTask from './implementation'

const result = await deleteTask(
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
