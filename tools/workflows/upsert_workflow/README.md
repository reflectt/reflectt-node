# Create Workflow

## Description

Create a workflow definition with steps in dependency tree format

## Purpose and Use Cases

- **Primary use**: Create a workflow definition with steps in dependency tree format
- **Integration**: Works with workflows category tools
- **Requirements**: Needs dataDir, globalDir

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Unique workflow identifier |
| `name` | string | Human-readable workflow name |
| `description` | string | What this workflow does |
| `steps` | array | Array of workflow steps |


### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `target_space` | string | - | Optional target space |
| `tags` | array | - |  |


## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import upsertWorkflow from './implementation'

const result = await upsertWorkflow(
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
