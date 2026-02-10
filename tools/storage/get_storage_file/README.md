# Get From Storage

## Description

Get a file from storage/[category]/[filename]. Retrieves unstructured content like documents, images, audio, etc. from S3-style object storage.

## Purpose and Use Cases

- **Primary use**: Get a file from storage/[category]/[filename]. Retrieves unstructured content like documents, images, audio, etc. from S3-style object storage.
- **Integration**: Works with storage category tools
- **Requirements**: Needs dataDir, globalDir

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `category` | string | Storage category/bucket (e.g., 'stories', 'characters', 'images', 'audio') |
| `filename` | string | Filename with extension (e.g., 'my-story.md', 'hero.json', 'map.png') |


### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `target_space` | string | - | Optional: Get from a specific named space (e.g., 'creative', 'education'). Defaults to current space. |


## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import getStorageFile from './implementation'

const result = await getStorageFile(
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
