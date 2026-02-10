# list_tasks

## Description

List all tasks from both global and space-specific locations. Can filter by agent, status, and priority. Returns tasks sorted by priority, then agent, then title.

## Purpose and Use Cases

- **Primary use**: List all tasks from both global and space-specific locations. Can filter by agent, status, and priority. Returns tasks sorted by priority, then agent, then title.
- **Integration**: Works with task category tools
- **Requirements**: Needs dataDir, globalDir

## Input Parameters



### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `agent` | string | - | Optional: Filter tasks by agent ID (e.g., 'budget_tracker') |
| `status` | string | - | Optional: Filter tasks by status |
| `priority` | string | - | Optional: Filter tasks by priority |
| `target_space` | string | - | Optional: Target a specific named space (e.g., 'creative', 'education'). Defaults to current space. |


## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import listTasks from './implementation'

const result = await listTasks(
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
