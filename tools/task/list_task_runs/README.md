# List Task Runs

## Description

List task runs with optional filtering by status. Returns runs sorted by newest first with optional limit.

## Purpose and Use Cases

- **Primary use**: List task runs with optional filtering by status. Returns runs sorted by newest first with optional limit.
- **Integration**: Works with task category tools
- **Requirements**: Needs dataDir

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `agent_name` | string | Name of the agent that executes the task |
| `task_id` | string | ID of the task to list runs for |


### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | string | - | Optional filter by status |
| `limit` | number | - | Optional limit on number of runs to return |


## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import listTaskRuns from './implementation'

const result = await listTaskRuns(
  {
    // Add parameters here
  },
  dataDir
)

console.log(result)
```


## Examples


### Example 1: List last 10 completed runs

```typescript
const result = await listTaskRuns(
  {
  "agent_name": "tutor",
  "task_id": "generate_lesson_plan",
  "status": "completed",
  "limit": 10
},
  dataDir
)

// Expected: Returns array of 10 most recent completed runs
```


### Example 2: List all failed runs for debugging

```typescript
const result = await listTaskRuns(
  {
  "agent_name": "doc_generator",
  "task_id": "generate_api_docs",
  "status": "failed"
},
  dataDir
)

// Expected: Returns all failed runs sorted by newest first
```



## Error Handling

The function returns structured error responses when issues occur.

## Related Tools

- See other task category tools
