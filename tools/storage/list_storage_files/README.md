# List Storage

## Description

List all files in a storage category with optional pattern filtering. Returns file metadata including size and modification date.

## Purpose and Use Cases

- **Primary use**: List all files in a storage category with optional pattern filtering. Returns file metadata including size and modification date.
- **Integration**: Works with storage category tools
- **Requirements**: Needs dataDir, globalDir

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `category` | string | Storage category/bucket to list (e.g., 'stories', 'characters', 'images', 'audio') |


### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `pattern` | string | - | Optional: Filter files by pattern (substring match on filename) |
| `target_space` | string | - | Optional: List from a specific named space (e.g., 'creative', 'education'). Defaults to current space. |


## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import listStorageFiles from './implementation'

const result = await listStorageFiles(
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

- See other storage category tools
