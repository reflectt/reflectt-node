# Query Table

## Description

Advanced querying with filters, sorting, and pagination. Supports nested field access (e.g., 'user.name') and multiple filter operators.

## Purpose and Use Cases

- **Primary use**: Advanced querying with filters, sorting, and pagination. Supports nested field access (e.g., 'user.name') and multiple filter operators.
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
| `where` | array | - | Optional: Array of filter conditions (all must match) |
| `orderBy` | object | - | Optional: Sort order |
| `limit` | number | - | Optional: Maximum number of records to return |
| `offset` | number | 0 | Optional: Number of records to skip (for pagination) |
| `target_space` | string | - | Optional: Query from a specific named space (e.g., 'creative', 'education'). Defaults to current space. |


## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import queryTable from './implementation'

const result = await queryTable(
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
