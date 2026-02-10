# Record Tool Use

## Description

Record a tool invocation during task execution. Captures tool name, input, output, and timestamp for debugging and analytics.

## Purpose and Use Cases

- **Primary use**: Record a tool invocation during task execution. Captures tool name, input, output, and timestamp for debugging and analytics.
- **Integration**: Works with task category tools
- **Requirements**: Needs dataDir

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `run_path` | string | Path to the task run file |
| `tool_name` | string | Name of the tool that was invoked |
| `tool_input` | object | Input parameters passed to the tool |


### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `tool_output` | object | - | Optional output returned by the tool (truncated to 500 chars) |


## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import recordToolUse from './implementation'

const result = await recordToolUse(
  {
    // Add parameters here
  },
  dataDir
)

console.log(result)
```


## Examples


### Example 1: Record a file read operation

```typescript
const result = await recordToolUse(
  {
  "run_path": "data/spaces/education/tasks/tutor/lesson_plan/runs/2025-10-17.json",
  "tool_name": "read_data_file",
  "tool_input": {
    "path": "templates/lesson.md",
    "scope": "global"
  },
  "tool_output": {
    "content": "# Lesson Plan Template..."
  }
},
  dataDir
)

// Expected: Tool use recorded with timestamp in task run
```



## Error Handling

The function returns structured error responses when issues occur.

## Related Tools

- See other task category tools
