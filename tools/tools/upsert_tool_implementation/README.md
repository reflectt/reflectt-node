# Upsert Tool Implementation

## Description

Create or update a tool's TypeScript implementation in implementations/[category]/[name].ts

## Purpose and Use Cases

- **Primary use**: Create or update a tool's TypeScript implementation in implementations/[category]/[name].ts
- **Integration**: Works with tools category tools
- **Requirements**: Needs dataDir, globalDir

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `tool_name` | string | The function_name for this tool (must match definition) |
| `category` | string | Tool category (must match definition) |
| `implementation` | string | TypeScript source code for the tool implementation |


### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `target_space` | string | - | Optional target space for space-specific tool |


## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import upsertToolImplementation from './implementation'

const result = await upsertToolImplementation(
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
