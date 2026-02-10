# Get Task Run Stats

## Description

Calculate aggregate statistics for all runs of a task. Returns total runs, success rate, average duration, and total cost.

## Purpose and Use Cases

- **Primary use**: Calculate aggregate statistics for all runs of a task. Returns total runs, success rate, average duration, and total cost.
- **Integration**: Works with task category tools
- **Requirements**: Needs dataDir

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `agent_name` | string | Name of the agent that executes the task |
| `task_id` | string | ID of the task to get statistics for |




## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import getTaskRunStats from './implementation'

const result = await getTaskRunStats(
  {
    // Add parameters here
  },
  dataDir
)

console.log(result)
```


## Examples


### Example 1: Get statistics for lesson plan generation task

```typescript
const result = await getTaskRunStats(
  {
  "agent_name": "tutor",
  "task_id": "generate_lesson_plan"
},
  dataDir
)

// Expected: Returns stats: { total_runs: 50, successful_runs: 48, failed_runs: 2, success_rate: 96, avg_duration_ms: 15000, total_cost: 2.50 }
```



## Error Handling

The function returns structured error responses when issues occur.

## Related Tools

- See other task category tools
