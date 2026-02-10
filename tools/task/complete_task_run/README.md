# Complete Task Run

## Description

Mark a task run as completed successfully. Calculates duration and records result, tokens, and cost.

## Purpose and Use Cases

- **Primary use**: Mark a task run as completed successfully. Calculates duration and records result, tokens, and cost.
- **Integration**: Works with task category tools
- **Requirements**: Needs dataDir

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `run_path` | string | Path to the task run file |


### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `result` | string | - | Optional result summary or output |
| `tokens` | number | - | Optional total tokens used |
| `cost` | number | - | Optional total cost in USD |


## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import completeTaskRun from './implementation'

const result = await completeTaskRun(
  {
    // Add parameters here
  },
  dataDir
)

console.log(result)
```


## Examples


### Example 1: Complete a task run with metrics

```typescript
const result = await completeTaskRun(
  {
  "run_path": "data/spaces/education/tasks/tutor/lesson_plan/runs/2025-10-17.json",
  "result": "Generated 5 lesson plans successfully",
  "tokens": 12500,
  "cost": 0.15
},
  dataDir
)

// Expected: Task run marked as completed with duration calculated
```



## Error Handling

The function returns structured error responses when issues occur.

## Related Tools

- See other task category tools
