# List Tools

## Description

List all available tools with optional filter by category

## Purpose and Use Cases

- **Primary use**: List all available tools with optional filter by category
- **Integration**: Works with tools category tools
- **Requirements**: Needs dataDir, globalDir

## Input Parameters



### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `category` | string | - | Optional category filter (data, agent, task, time, web, tools, workflows, storage, creative_utils) |
| `target_space` | string | - | Optional target space to list space-specific tools |
| `include_implementations` | boolean | - | Include implementation file paths |


## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import listTools from './implementation'

const result = await listTools(
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
