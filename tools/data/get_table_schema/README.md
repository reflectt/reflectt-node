# Get Table Schema

## Description

Get the schema.json for a table. Returns the auto-generated or manually defined schema that describes the table structure and field types.

## Purpose and Use Cases

- **Primary use**: Get the schema.json for a table. Returns the auto-generated or manually defined schema that describes the table structure and field types.
- **Integration**: Works with data category tools
- **Requirements**: Needs dataDir, globalDir

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `table` | string | Table name (e.g., 'stories', 'characters', 'worlds', 'users') |


### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `target_space` | string | - | Optional: Get schema from a specific named space (e.g., 'creative', 'education'). Defaults to current space. |


## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import getTableSchema from './implementation'

const result = await getTableSchema(
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

- See other data category tools
