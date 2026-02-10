# Delete Record

## Description

Delete a record from tables/[table]/rows/[id].json. Permanently removes structured data from PostgreSQL-style table storage.

## Purpose and Use Cases

- **Primary use**: Delete a record from tables/[table]/rows/[id].json. Permanently removes structured data from PostgreSQL-style table storage.
- **Integration**: Works with data category tools
- **Requirements**: Needs dataDir, globalDir

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `table` | string | Table name (e.g., 'stories', 'characters', 'worlds', 'users') |
| `id` | string | Record ID to delete |


### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `target_space` | string | - | Optional: Delete from a specific named space (e.g., 'creative', 'education'). Defaults to current space. |


## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import deleteRecord from './implementation'

const result = await deleteRecord(
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
