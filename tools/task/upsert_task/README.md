# Upsert Task

## Description

Create or update a task with validated schema. Ensures consistent task structure. Use this to define what an agent can do.

## Purpose and Use Cases

- **Primary use**: Create or update a task with validated schema. Ensures consistent task structure. Use this to define what an agent can do.
- **Integration**: Works with task category tools
- **Requirements**: Needs dataDir, globalDir

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Task ID (lowercase, numbers, underscores, hyphens) |
| `agent` | string | Agent ID this task belongs to (e.g., "finance_tracker") |
| `title` | string | Human-readable task title |
| `description` | string | What this task does |


### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `prompt_file` | string | - | Path to prompt file for this task (optional) |
| `status` | string | active | Task status |
| `priority` | string | medium | Task priority |
| `context` | object | - | Additional context data for the task |
| `target_space` | string | - | Optional: Write to a specific named space (e.g., 'creative', 'education'). Overrides current space. |


## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import upsertTask from './implementation'

const result = await upsertTask(
  {
    // Add parameters here
  },
  dataDir,
  globalDir
)

console.log(result)
```


## Examples


### Example 1: Create a budget analysis task

```typescript
const result = await upsertTask(
  {
  "id": "analyze-budget",
  "agent": "finance_tracker",
  "title": "Analyze Budget",
  "description": "Analyze monthly budget and provide insights"
},
  dataDir,
  globalDir
)

// Expected: Task is created or updated with validated configuration
```



## Error Handling

The function returns structured error responses when issues occur.

## Related Tools

- See other task category tools
