# Save to Storage

## Description

Save a file to the storage/ directory in a space. Enforces clean structure with storage/[category]/[filename]. Mimics S3-style object storage for unstructured content like documents, images, audio, etc.

## Purpose and Use Cases

- **Primary use**: Save a file to the storage/ directory in a space. Enforces clean structure with storage/[category]/[filename]. Mimics S3-style object storage for unstructured content like documents, images, audio, etc.
- **Integration**: Works with storage category tools
- **Requirements**: Needs dataDir, globalDir

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `category` | string | Storage category/bucket (e.g., 'stories', 'characters', 'worlds', 'images', 'audio') |
| `filename` | string | Filename with extension (e.g., 'my-story.md', 'hero.json', 'map.png') |
| `content` | string | File content to save |


### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `target_space` | string | - | Optional: Save to a specific named space (e.g., 'creative', 'education'). Defaults to current space. |


## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import upsertStorageFile from './implementation'

const result = await upsertStorageFile(
  {
    // Add parameters here
  },
  dataDir,
  globalDir
)

console.log(result)
```


## Examples


### Example 1: Save a story to storage

```typescript
const result = await upsertStorageFile(
  {
  "category": "stories",
  "filename": "time-traveler.md",
  "content": "# The Time Traveler\n\nOnce upon a time...",
  "target_space": "creative"
},
  dataDir,
  globalDir
)

// Expected: File saved to storage/stories/time-traveler.md in the creative space
```


### Example 2: Save a character profile

```typescript
const result = await upsertStorageFile(
  {
  "category": "characters",
  "filename": "hero-001.json",
  "content": "{\"name\": \"John\", \"age\": 30}"
},
  dataDir,
  globalDir
)

// Expected: File saved to storage/characters/hero-001.json in current space
```



## Error Handling

The function returns structured error responses when issues occur.

## Related Tools

- See other storage category tools
