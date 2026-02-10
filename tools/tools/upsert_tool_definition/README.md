# Upsert Tool Definition

## Description

Create or update a tool's JSON definition file in definitions/[category]/[name].json

## Purpose and Use Cases

- **Primary use**: Create or update a tool's JSON definition file in definitions/[category]/[name].json
- **Integration**: Works with tools category tools
- **Requirements**: Needs dataDir, globalDir

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `tool_name` | string | The function_name for this tool (snake_case) |
| `category` | string | Tool category (data, agent, task, time, web, tools, workflows, storage, etc.) |
| `description` | string | Human-readable description of what this tool does |
| `parameters` | object | JSON Schema for tool parameters (must have type: 'object') |


### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `target_space` | string | - | Optional target space for space-specific tool |
| `tags` | array | - | Optional tags for categorization |


## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import upsertToolDefinition from './implementation'

const result = await upsertToolDefinition(
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
