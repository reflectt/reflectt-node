# Start Task Run

## Description

Mark a task run as started and record the agent model being used. Updates status from 'pending' to 'running'.

## Purpose and Use Cases

- **Primary use**: Mark a task run as started and record the agent model being used. Updates status from 'pending' to 'running'.
- **Integration**: Works with task category tools
- **Requirements**: Needs dataDir

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `run_path` | string | Path to the task run file (returned from create_task_run) |


### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `agent_model` | string | - | Optional model identifier (e.g., 'claude-sonnet-4') |


## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import startTaskRun from './implementation'

const result = await startTaskRun(
  {
    // Add parameters here
  },
  dataDir
)

console.log(result)
```


## Examples


### Example 1: Start a task run with Claude Sonnet

```typescript
const result = await startTaskRun(
  {
  "run_path": "data/spaces/education/tasks/tutor/lesson_plan/runs/2025-10-17.json",
  "agent_model": "claude-sonnet-4"
},
  dataDir
)

// Expected: Task run marked as running with model recorded
```



## Error Handling

The function returns structured error responses when issues occur.

## Related Tools

- See other task category tools
