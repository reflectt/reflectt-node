# Delete From Storage

## Description

Delete a file from storage/[category]/[filename]. Removes unstructured content from S3-style object storage. Automatically cleans up empty category directories.

## Purpose and Use Cases

- **Primary use**: Delete a file from storage/[category]/[filename]. Removes unstructured content from S3-style object storage. Automatically cleans up empty category directories.
- **Integration**: Works with storage category tools
- **Requirements**: Needs dataDir, globalDir

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `category` | string | Storage category/bucket (e.g., 'stories', 'characters', 'images', 'audio') |
| `filename` | string | Filename with extension to delete (e.g., 'my-story.md', 'hero.json') |


### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `target_space` | string | - | Optional: Delete from a specific named space (e.g., 'creative', 'education'). Defaults to current space. |


## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import deleteStorageFile from './implementation'

const result = await deleteStorageFile(
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
