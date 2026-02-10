# Get Workflow Status

## Description

Get current status of a running workflow execution

## Purpose and Use Cases

- **Primary use**: Get current status of a running workflow execution
- **Integration**: Works with workflows category tools
- **Requirements**: Needs dataDir, globalDir

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `execution_id` | string | Workflow execution ID |


### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `target_space` | string | - | Optional target space |
| `include_step_details` | boolean | - | Include detailed step information |


## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import getWorkflowStatus from './implementation'

const result = await getWorkflowStatus(
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

- See other workflows category tools
