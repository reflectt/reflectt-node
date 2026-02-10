# List Workflows

## Description

List all available workflows with optional filters

## Purpose and Use Cases

- **Primary use**: List all available workflows with optional filters
- **Integration**: Works with workflows category tools
- **Requirements**: Needs dataDir, globalDir

## Input Parameters



### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `target_space` | string | - | Optional target space |
| `filter_tags` | array | - | Filter by tags |
| `include_steps` | boolean | - | Include step details |


## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import listWorkflows from './implementation'

const result = await listWorkflows(
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
