# List Records

## Description

List/query records from a table with optional pagination. Returns records sorted by created_at (newest first). Use query_table for advanced filtering.

## Purpose and Use Cases

- **Primary use**: List/query records from a table with optional pagination. Returns records sorted by created_at (newest first). Use query_table for advanced filtering.
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
| `limit` | number | - | Optional: Maximum number of records to return |
| `offset` | number | 0 | Optional: Number of records to skip (for pagination) |
| `target_space` | string | - | Optional: List from a specific named space (e.g., 'creative', 'education'). Defaults to current space. |


## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import listRecords from './implementation'

const result = await listRecords(
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
