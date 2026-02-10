# Create Task Run

## Description

Create a new task run instance for tracking task execution. Returns run ID and path for subsequent operations.

## Purpose and Use Cases

- **Primary use**: Create a new task run instance for tracking task execution. Returns run ID and path for subsequent operations.
- **Integration**: Works with task category tools
- **Requirements**: Needs dataDir

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `agent_name` | string | Name of the agent executing the task |
| `task_id` | string | ID of the task being executed |
| `task_title` | string | Title of the task |


### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `description` | string | - | Optional description of what this task run will do |
| `prompt` | string | - | Optional inline prompt for the task |
| `prompt_file` | string | - | Optional path to prompt file |
| `context` | object | - | Optional context data for the task execution |
| `steps` | array | - | Optional array of steps to track |


## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import createTaskRun from './implementation'

const result = await createTaskRun(
  {
    // Add parameters here
  },
  dataDir
)

console.log(result)
```


## Examples


### Example 1: Create a new task run for documentation generation

```typescript
const result = await createTaskRun(
  {
  "agent_name": "doc_generator",
  "task_id": "generate_api_docs",
  "task_title": "Generate API Documentation",
  "description": "Generate comprehensive API documentation from code"
},
  dataDir
)

// Expected: Returns run_id and run_path for tracking execution
```



## Error Handling

The function returns structured error responses when issues occur.

## Related Tools

- See other task category tools
