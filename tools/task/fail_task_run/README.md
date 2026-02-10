# Fail Task Run

## Description

Mark a task run as failed and record the error message. Calculates duration for debugging.

## Purpose and Use Cases

- **Primary use**: Mark a task run as failed and record the error message. Calculates duration for debugging.
- **Integration**: Works with task category tools
- **Requirements**: Needs dataDir

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `run_path` | string | Path to the task run file |
| `error` | string | Error message describing what went wrong |




## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import failTaskRun from './implementation'

const result = await failTaskRun(
  {
    // Add parameters here
  },
  dataDir
)

console.log(result)
```


## Examples


### Example 1: Mark a task run as failed due to validation error

```typescript
const result = await failTaskRun(
  {
  "run_path": "data/spaces/education/tasks/tutor/lesson_plan/runs/2025-10-17.json",
  "error": "Validation failed: Missing required field 'grade_level'"
},
  dataDir
)

// Expected: Task run marked as failed with error recorded
```



## Error Handling

The function returns structured error responses when issues occur.

## Related Tools

- See other task category tools
