# Update Table Schema

## Description

Update schema.json for a table. Creates or modifies the schema that describes table structure, field types, and indexes. Automatically creates table directory if needed.

## Purpose and Use Cases

- **Primary use**: Update schema.json for a table. Creates or modifies the schema that describes table structure, field types, and indexes. Automatically creates table directory if needed.
- **Integration**: Works with data category tools
- **Requirements**: Needs dataDir, globalDir

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `table` | string | Table name (e.g., 'stories', 'characters', 'worlds', 'users') |
| `schema` | object | Schema definition with fields and optional indexes |


### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `target_space` | string | - | Optional: Update schema in a specific named space (e.g., 'creative', 'education'). Defaults to current space. |


## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import upsertTableSchema from './implementation'

const result = await upsertTableSchema(
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
