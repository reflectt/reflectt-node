# List Tool Categories

## Description

List all tool categories (data, agent, task, time, web, tools, workflows, storage, creative_utils, etc.)

## Purpose and Use Cases

- **Primary use**: List all tool categories (data, agent, task, time, web, tools, workflows, storage, creative_utils, etc.)
- **Integration**: Works with tools category tools
- **Requirements**: Needs dataDir, globalDir

## Input Parameters



### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `target_space` | string | - | Optional target space to include space-specific categories |
| `include_counts` | boolean | - | Include count of tools in each category |


## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import listToolCategories from './implementation'

const result = await listToolCategories(
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
