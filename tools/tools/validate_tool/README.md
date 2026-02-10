# Validate Tool

## Description

Validate that tool definition matches implementation by checking parameter names, types, and context_requirements

## Purpose and Use Cases

- **Primary use**: Validate that tool definition matches implementation by checking parameter names, types, and context_requirements
- **Integration**: Works with tools category tools
- **Requirements**: Needs dataDir, globalDir

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `tool_name` | string | The function_name of the tool to validate |


### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `target_space` | string | - | Optional target space for space-specific tools |
| `strict` | boolean | - | Enable strict validation (check for all best practices) |


## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import validateTool from './implementation'

const result = await validateTool(
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
