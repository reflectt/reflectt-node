# Get Tool

## Description

Get a tool's definition and implementation by name

## Purpose and Use Cases

- **Primary use**: Get a tool's definition and implementation by name
- **Integration**: Works with tools category tools
- **Requirements**: Needs dataDir, globalDir

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `tool_name` | string | The function_name of the tool to retrieve |


### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `target_space` | string | - | Optional target space to search for space-specific tools |
| `include_source` | boolean | - | Include the TypeScript implementation source code |


## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import getTool from './implementation'

const result = await getTool(
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

- See other tools category tools
