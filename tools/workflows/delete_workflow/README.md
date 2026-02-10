# Delete Workflow

## Description

Delete a workflow definition. Does not delete execution history.

## Purpose and Use Cases

- **Primary use**: Delete a workflow definition. Does not delete execution history.
- **Integration**: Works with workflows category tools
- **Requirements**: Needs dataDir, globalDir

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Workflow ID to delete |


### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `target_space` | string | - | Optional target space |


## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import deleteWorkflow from './implementation'

const result = await deleteWorkflow(
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
